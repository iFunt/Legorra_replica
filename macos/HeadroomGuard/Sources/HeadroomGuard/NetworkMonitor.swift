import Foundation
import Darwin

/// Runs a system tool and returns its stdout, or nil if it could not start or failed.
enum Shell {
    static func run(_ path: String, _ args: [String]) -> (out: String, status: Int32)? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        let out = Pipe()
        p.standardOutput = out
        p.standardError = Pipe()
        do { try p.run() } catch { return nil }
        // Read before waiting so a large output cannot fill the pipe and block the child.
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (String(decoding: data, as: UTF8.self), p.terminationStatus)
    }
}

/// Per-process network byte counters from `nettop` and remote endpoints from `lsof`, both shipped with macOS.
/// Neither needs root for your own processes. Payload contents are never read: macOS does not expose them
/// and TLS hides them anyway, so this measures how much left and where it went, not what it was.
final class NetworkMonitor {
    struct Reading {
        var pid: pid_t
        var process: String
        var bytesIn: UInt64
        var bytesOut: UInt64
    }

    struct AppDelta {
        var app: String
        var bundleID: String?
        var bytesIn: UInt64 = 0
        var bytesOut: UInt64 = 0
        var pids: Set<pid_t> = []
    }

    private var previous: [String: (rx: UInt64, tx: UInt64)] = [:]
    private var primed = false
    private var dnsCache: [String: String] = [:]

    /// Bytes moved per app since the last call. The first call only sets the baseline and returns zeros,
    /// so traffic from before launch is not counted as new. nil if nettop could not be run.
    func sample() -> [String: AppDelta]? {
        guard let r = Shell.run("/usr/bin/nettop", ["-P", "-L", "1", "-x", "-J", "bytes_in,bytes_out"]), r.status == 0 else {
            return nil
        }
        let readings = Self.parseNettop(r.out)
        if readings.isEmpty { return nil }

        var next: [String: (rx: UInt64, tx: UInt64)] = [:]
        var result: [String: AppDelta] = [:]
        for rd in readings {
            let key = "\(rd.pid):\(rd.process)"
            next[key] = (rd.bytesIn, rd.bytesOut)
            guard primed else { continue }
            let old = previous[key] ?? (0, 0)
            // Counters only grow for a live process; a drop means the pid was reused, so count from zero.
            let dIn = rd.bytesIn >= old.rx ? rd.bytesIn - old.rx : rd.bytesIn
            let dOut = rd.bytesOut >= old.tx ? rd.bytesOut - old.tx : rd.bytesOut
            guard dIn > 0 || dOut > 0 else { continue }
            let id = AppIdentity.resolve(rd.pid, process: rd.process)
            var d = result[id.name] ?? AppDelta(app: id.name, bundleID: id.bundleID)
            d.bytesIn += dIn
            d.bytesOut += dOut
            d.pids.insert(rd.pid)
            result[id.name] = d
        }
        previous = next
        primed = true
        return result
    }

    /// Remote addresses (reverse-resolved where possible) of established connections, per pid.
    func endpoints(for pids: Set<pid_t>) -> [pid_t: Set<String>] {
        guard !pids.isEmpty,
              let r = Shell.run("/usr/sbin/lsof", ["-nP", "-iTCP", "-sTCP:ESTABLISHED", "-iUDP", "-F", "pn"])
        else { return [:] }
        var out: [pid_t: Set<String>] = [:]
        var lookups = 0
        for (pid, ips) in Self.parseLsof(r.out) where pids.contains(pid) {
            out[pid] = Set(ips.map { ip in
                if let h = dnsCache[ip] { return h }
                guard lookups < 25 else { return ip }
                lookups += 1
                let h = Self.reverseDNS(ip) ?? ip
                dnsCache[ip] = h
                return h
            })
        }
        if dnsCache.count > 5000 { dnsCache.removeAll() }
        return out
    }

    // MARK: Parsing

    /// `nettop -P -L 1 -x -J bytes_in,bytes_out` prints a CSV header, then one row per process
    /// whose second column is `name.pid`.
    static func parseNettop(_ text: String) -> [Reading] {
        var inIdx = -1, outIdx = -1, procIdx = 1
        var result: [Reading] = []
        for line in text.split(whereSeparator: \.isNewline) {
            let cols = line.split(separator: ",", omittingEmptySubsequences: false)
                .map { $0.trimmingCharacters(in: .whitespaces) }
            if let i = cols.firstIndex(of: "bytes_in"), let o = cols.firstIndex(of: "bytes_out") {
                inIdx = i
                outIdx = o
                procIdx = cols.firstIndex(of: "") ?? 1
                continue
            }
            guard inIdx >= 0, cols.count > max(inIdx, outIdx, procIdx) else { continue }
            let proc = cols[procIdx]
            guard let dot = proc.lastIndex(of: "."), let pid = pid_t(proc[proc.index(after: dot)...]) else { continue }
            result.append(Reading(pid: pid, process: String(proc[..<dot]),
                                  bytesIn: bytes(cols[inIdx]), bytesOut: bytes(cols[outIdx])))
        }
        return result
    }

    /// Raw integers with -x; tolerates "12 KiB"-style values in case a macOS version ignores -x.
    static func bytes(_ s: String) -> UInt64 {
        if let v = UInt64(s) { return v }
        let parts = s.split(separator: " ")
        guard parts.count == 2, let n = Double(parts[0]) else { return 0 }
        let mult: Double = ["B": 1, "KiB": 1024, "MiB": 1_048_576, "GiB": 1_073_741_824,
                            "KB": 1e3, "MB": 1e6, "GB": 1e9][String(parts[1])] ?? 1
        return UInt64(n * mult)
    }

    /// `lsof -F pn` prints `p<pid>` then `n<local>-><remote>` lines for that pid.
    static func parseLsof(_ text: String) -> [pid_t: Set<String>] {
        var pid: pid_t = 0
        var out: [pid_t: Set<String>] = [:]
        for line in text.split(whereSeparator: \.isNewline) {
            guard let c = line.first else { continue }
            let v = line.dropFirst()
            if c == "p" {
                pid = pid_t(v) ?? 0
            } else if c == "n", pid > 0, let arrow = v.range(of: "->") {
                let host = stripPort(String(v[arrow.upperBound...]))
                if host.hasPrefix("127.") || host == "::1" || host == "localhost" { continue }
                out[pid, default: []].insert(host)
            }
        }
        return out
    }

    static func stripPort(_ s: String) -> String {
        if s.hasPrefix("["), let end = s.firstIndex(of: "]") { return String(s[s.index(after: s.startIndex)..<end]) }
        if let colon = s.lastIndex(of: ":") { return String(s[..<colon]) }
        return s
    }

    static func reverseDNS(_ ip: String) -> String? {
        var hints = addrinfo()
        hints.ai_flags = AI_NUMERICHOST
        var res: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(ip, nil, &hints, &res) == 0, let ai = res else { return nil }
        defer { freeaddrinfo(res) }
        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        guard getnameinfo(ai.pointee.ai_addr, ai.pointee.ai_addrlen, &host, socklen_t(host.count), nil, 0, NI_NAMEREQD) == 0
        else { return nil }
        return String(cString: host)
    }
}
