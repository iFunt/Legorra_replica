import Foundation
import Darwin
import IOKit

enum SegmentKind {
    case cpu, gpu, memory, battery, claude, grok
}

struct Consumer: Identifiable {
    var id: String { name }
    var name: String
    var value: Double
    var label: String
}

/// Per-app resource use straight from the kernel (libproc rusage) and the GPU driver's per-client
/// accounting in the IORegistry. Only runs while a hover panel is visible.
/// Helper processes are folded into their owning .app; root-owned daemons are not readable without sudo.
final class ConsumerSampler {
    private struct Snapshot {
        var time: UInt64 = 0
        var cpu: [pid_t: UInt64] = [:]
        var energy: [pid_t: UInt64] = [:]
        var gpu: [pid_t: UInt64] = [:]
    }

    private var previous: Snapshot?
    private var names: [pid_t: String] = [:]
    private let timebase: (numer: UInt64, denom: UInt64) = {
        var tb = mach_timebase_info_data_t()
        mach_timebase_info(&tb)
        return (UInt64(tb.numer), UInt64(tb.denom))
    }()

    func reset() {
        previous = nil
        names = [:]
    }

    /// Top consumers for `kind`. Rates need two samples, so the first call for CPU/GPU/battery returns [].
    func top(_ kind: SegmentKind, limit: Int = 6) -> [Consumer] {
        var pids = [pid_t](repeating: 0, count: 4096)
        let count = Int(proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size)))
        var snap = Snapshot(time: mach_absolute_time())
        var footprint: [pid_t: UInt64] = [:]

        for pid in pids.prefix(max(count, 0)) where pid > 0 {
            var ri = rusage_info_v6()
            let r = withUnsafeMutablePointer(to: &ri) {
                $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V6, $0) }
            }
            guard r == 0 else { continue }
            snap.cpu[pid] = ri.ri_user_time &+ ri.ri_system_time
            snap.energy[pid] = ri.ri_energy_nj
            footprint[pid] = ri.ri_phys_footprint
        }
        if kind == .gpu { snap.gpu = gpuTimes() }
        defer { previous = snap }

        var totals: [String: Double] = [:]
        switch kind {
        case .memory:
            for (pid, bytes) in footprint { totals[name(pid), default: 0] += Double(bytes) }
        case .cpu, .gpu, .battery:
            guard let prev = previous, snap.time > prev.time else { return [] }
            let wallNs = Double(snap.time - prev.time) * Double(timebase.numer) / Double(timebase.denom)
            let (now, before) = kind == .cpu ? (snap.cpu, prev.cpu) : kind == .gpu ? (snap.gpu, prev.gpu) : (snap.energy, prev.energy)
            for (pid, v) in now {
                guard let old = before[pid], v > old else { continue }
                let delta = Double(v - old)
                switch kind {
                case .cpu: totals[name(pid), default: 0] += delta * Double(timebase.numer) / Double(timebase.denom) / wallNs * 100
                case .gpu: totals[name(pid), default: 0] += delta / wallNs * 100
                default: totals[name(pid), default: 0] += delta
                }
            }
        default:
            return []
        }

        if kind == .battery {
            // Energy counters have no documented unit, so show each app's share of energy used (like Energy Impact).
            let sum = totals.values.reduce(0, +)
            guard sum > 0 else { return [] }
            totals = totals.mapValues { $0 / sum * 100 }
        }
        return totals.sorted { $0.value > $1.value }.prefix(limit).map { n, v in
            switch kind {
            case .memory: return Consumer(name: n, value: v, label: Fmt.gb(UInt64(v)))
            case .battery: return Consumer(name: n, value: v, label: String(format: "%.0f%%", v))
            default: return Consumer(name: n, value: v, label: String(format: "%.1f%%", v))
            }
        }
    }

    /// Accumulated GPU nanoseconds per pid from the AGX driver's user clients.
    private func gpuTimes() -> [pid_t: UInt64] {
        var result: [pid_t: UInt64] = [:]
        // User clients are children of the accelerator entry; they are not reachable by global matching.
        var accelerators: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOAccelerator"), &accelerators) == KERN_SUCCESS
        else { return result }
        defer { IOObjectRelease(accelerators) }
        var clients: [io_registry_entry_t] = []
        while true {
            let acc = IOIteratorNext(accelerators)
            if acc == 0 { break }
            var children: io_iterator_t = 0
            if IORegistryEntryGetChildIterator(acc, kIOServicePlane, &children) == KERN_SUCCESS {
                while true {
                    let c = IOIteratorNext(children)
                    if c == 0 { break }
                    clients.append(c)
                }
                IOObjectRelease(children)
            }
            IOObjectRelease(acc)
        }
        for entry in clients {
            defer { IOObjectRelease(entry) }
            guard let creator = IORegistryEntryCreateCFProperty(entry, "IOUserClientCreator" as CFString, kCFAllocatorDefault, 0)?
                    .takeRetainedValue() as? String,
                  let pidText = creator.split(separator: ",").first?.split(separator: " ").last,
                  let pid = pid_t(pidText),
                  let usage = IORegistryEntryCreateCFProperty(entry, "AppUsage" as CFString, kCFAllocatorDefault, 0)?
                    .takeRetainedValue() as? [[String: Any]] else { continue }
            let ns = usage.reduce(UInt64(0)) { $0 + ((($1["accumulatedGPUTime"]) as? NSNumber)?.uint64Value ?? 0) }
            result[pid, default: 0] += ns
        }
        return result
    }

    /// App name for a pid: the outermost .app bundle in its path, else the process name.
    private func name(_ pid: pid_t) -> String {
        if let n = names[pid] { return n }
        var buf = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
        var result = ""
        if proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 {
            let path = String(cString: buf)
            if let r = path.range(of: ".app/") {
                result = String(path[..<r.lowerBound].split(separator: "/").last ?? "")
            } else {
                // Versioned binaries (e.g. ~/.local/share/claude/versions/2.1.296) are named by their tool folder.
                let parts = path.split(separator: "/").map(String.init)
                result = parts.reversed().first { p in
                    !(p.first?.isNumber ?? false) && !["versions", "bin", "libexec", "current"].contains(p)
                } ?? parts.last ?? ""
            }
        }
        if result.isEmpty {
            var nb = [CChar](repeating: 0, count: 256)
            proc_name(pid, &nb, UInt32(nb.count))
            result = String(cString: nb)
        }
        if result.isEmpty { result = "pid \(pid)" }
        names[pid] = result
        return result
    }
}
