import Foundation
import AppKit
import UserNotifications

/// Watches AI apps, browsers and apps holding sensitive macOS permissions for outbound data, and raises
/// red alerts when one uploads more than a threshold, gains a risky permission, or a browser extension
/// is installed or widens its permissions. All work runs on one background queue; results go to `store`.
///
/// Alerts are evidence that data left, with size, time and destination. They cannot show what the data
/// was: payloads are encrypted and never read.
final class PrivacyMonitor {
    let store: PrivacyStore
    var onChange: () -> Void = {}

    private let queue = DispatchQueue(label: "headroomguard.privacy", qos: .utility)
    private let net = NetworkMonitor()
    private var timers: [Timer] = []
    private var state = State()
    private var window: [String: [(t: Date, out: UInt64, background: Bool)]] = [:]
    private var hosts: [String: Set<String>] = [:]
    private var appPids: [String: Set<pid_t>] = [:]
    private var categories: [String: WatchCategory] = [:]
    private var accessClients: Set<String> = []
    private var tick = 0

    private static let dir: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("HeadroomGuard", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    private static let stateURL = dir.appendingPathComponent("privacy-state.json")
    static let logURL = dir.appendingPathComponent("privacy-events.jsonl")

    /// Persisted between launches.
    private struct State: Codable {
        /// day (yyyy-MM-dd) -> app -> [bytesOut, bytesIn]
        var days: [String: [String: [UInt64]]] = [:]
        var categories: [String: WatchCategory] = [:]
        var alerts: [PrivacyAlert] = []
        /// nil until the first scan, which sets the baseline without alerting.
        var knownExtensions: [String: String]?
        var knownGrants: [String]?
        var lastAlert: [String: Date] = [:]
    }

    init(store: PrivacyStore) {
        self.store = store
        if let d = try? Data(contentsOf: Self.stateURL), let s = try? Self.decoder.decode(State.self, from: d) {
            state = s
            categories = s.categories
        }
        store.rescan = { [weak self] in self?.queue.async { self?.scan() } }
        store.markReviewed = { [weak self] in self?.queue.async { self?.reviewAll() } }
        store.exportCSV = { [weak self] in self?.queue.async { self?.export() } }
        store.revealLog = {
            if !FileManager.default.fileExists(atPath: Self.logURL.path) {
                FileManager.default.createFile(atPath: Self.logURL.path, contents: nil)
            }
            NSWorkspace.shared.activateFileViewerSelecting([Self.logURL])
        }
    }

    func start() {
        guard UserDefaults.standard.bool(forKey: PrivacyPrefs.enabled) else { return }
        requestNotificationPermission()
        queue.async { self.scan(); self.sample(frontmost: nil) }
        let t = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            // Frontmost app must be read on the main thread.
            let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
            self?.queue.async { self?.sample(frontmost: front) }
        }
        let s = Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { [weak self] _ in
            self?.queue.async { self?.scan() }
        }
        timers = [t, s]
        timers.forEach { $0.tolerance = 2 }
        publish()
    }

    func flush() {
        queue.sync { save() }
    }

    // MARK: Network

    private func sample(frontmost: String?) {
        guard let deltas = net.sample() else {
            DispatchQueue.main.async { self.store.networkError = "nettop is unavailable, so traffic cannot be measured." }
            return
        }
        DispatchQueue.main.async { self.store.networkError = nil }
        let now = Date()
        let day = Self.dayKey(now)
        for d in deltas.values {
            guard let cat = Watchlist.category(app: d.app, bundleID: d.bundleID, accessClients: accessClients) else { continue }
            categories[d.app] = cat
            var t = state.days[day, default: [:]][d.app] ?? [0, 0]
            t[0] += d.bytesOut
            t[1] += d.bytesIn
            state.days[day, default: [:]][d.app] = t
            appPids[d.app, default: []].formUnion(d.pids)
            let background = frontmost != nil && d.bundleID != nil && d.bundleID != frontmost
            if d.bytesOut > 0 { window[d.app, default: []].append((now, d.bytesOut, background)) }
        }
        for k in window.keys { window[k]?.removeAll { now.timeIntervalSince($0.t) > 900 } }

        tick += 1
        if tick % 3 == 1 { refreshEndpoints() }
        evaluateTraffic(now: now)
        if tick % 30 == 0 { prune(); save() }
        publish()
    }

    private func refreshEndpoints() {
        let watchedPids = appPids.values.reduce(into: Set<pid_t>()) { $0.formUnion($1) }
        let byPid = net.endpoints(for: watchedPids)
        for (app, pids) in appPids {
            let found = pids.compactMap { byPid[$0] }.reduce(into: Set<String>()) { $0.formUnion($1) }
            if !found.isEmpty { hosts[app, default: []].formUnion(found) }
            // Drop pids that no longer have connections so the set does not grow forever.
            appPids[app] = pids.filter { byPid[$0] != nil }
        }
    }

    private func evaluateTraffic(now: Date) {
        let alertBrowsers = UserDefaults.standard.bool(forKey: PrivacyPrefs.alertBrowsers)
        for (app, samples) in window {
            guard let cat = categories[app], cat != .browser || alertBrowsers else { continue }
            let total = samples.reduce(UInt64(0)) { $0 + $1.out }
            let bg = samples.filter { $0.background }.reduce(UInt64(0)) { $0 + $1.out }
            let dest = (hosts[app] ?? []).sorted().prefix(5).joined(separator: ", ")
            let destText = dest.isEmpty ? "" : " Destinations: \(dest)."
            if bg >= PrivacyPrefs.bgThreshold {
                alert(.red, app: app, rule: "bg",
                      title: "\(app) sent \(Bytes.short(bg)) in the background",
                      detail: "Uploaded in the last 15 minutes while you were using another app.\(destText)")
            } else if total >= PrivacyPrefs.fgThreshold {
                alert(.red, app: app, rule: "fg",
                      title: "\(app) sent \(Bytes.short(total)) in 15 minutes",
                      detail: "Outbound data above your \(Bytes.short(PrivacyPrefs.fgThreshold)) threshold.\(destText)")
            }
        }
    }

    // MARK: Extensions and permissions

    private func scan() {
        let exts = ExtensionScanner.scan()
        let current = Dictionary(exts.map { ($0.id, $0.fingerprint) }, uniquingKeysWith: { a, _ in a })
        if let known = state.knownExtensions {
            for e in exts {
                if known[e.id] == nil {
                    if e.level >= .medium {
                        alert(e.level == .high ? .red : .amber, app: e.browser, rule: "ext-new-\(e.id)",
                              title: "New \(e.level.label.lowercased())-risk extension: \(e.name)",
                              detail: "\(e.browser) (\(e.profile)): \(e.reasons.joined(separator: "; ")).")
                    }
                } else if let old = known[e.id], old != e.fingerprint {
                    let before = Set(old.split(separator: ",").map(String.init))
                    let added = Set(e.permissions + e.hosts).subtracting(before)
                    if !added.isEmpty {
                        alert(e.level == .high ? .red : .amber, app: e.browser, rule: "ext-perm-\(e.id)-\(e.fingerprint.hashValue)",
                              title: "\(e.name) gained permissions",
                              detail: "\(e.browser) (\(e.profile)) added: \(added.sorted().joined(separator: ", ")). "
                                + "Extensions that change owner often do this before collecting data.")
                    }
                }
            }
        }
        state.knownExtensions = current

        let (grants, readable) = AccessScanner.scan()
        if readable {
            let keys = grants.map(\.id)
            if let known = state.knownGrants.map({ Set($0) }) {
                for g in grants where !known.contains(g.id) && AccessScanner.watchedServices.contains(g.service) {
                    alert(.red, app: g.app, rule: "tcc-\(g.id)",
                          title: "\(g.app) was given \(g.service)",
                          detail: "New macOS permission. Its network use is now watched. Revoke in System Settings > Privacy & Security if unexpected.")
                }
            }
            state.knownGrants = keys
            accessClients = Set(grants.filter { AccessScanner.watchedServices.contains($0.service) }.flatMap { [$0.client, $0.app] })
        }
        save()
        DispatchQueue.main.async {
            self.store.extensions = exts
            self.store.grants = grants
            self.store.accessReadable = readable
            self.store.lastScan = Date()
        }
        publish()
    }

    // MARK: Alerts

    private func alert(_ severity: Severity, app: String, rule: String, title: String, detail: String) {
        let key = "\(app)|\(rule)"
        // One alert per app and rule per 30 minutes; extension and permission rules carry unique keys.
        if let last = state.lastAlert[key], Date().timeIntervalSince(last) < 1800 { return }
        state.lastAlert[key] = Date()
        let a = PrivacyAlert(time: Date(), severity: severity, app: app, title: title, detail: detail)
        state.alerts.insert(a, at: 0)
        if state.alerts.count > 300 { state.alerts.removeLast(state.alerts.count - 300) }
        appendLog(a)
        if UserDefaults.standard.bool(forKey: PrivacyPrefs.notify) { notify(a) }
    }

    private func reviewAll() {
        for i in state.alerts.indices { state.alerts[i].reviewed = true }
        save()
        publish()
    }

    private func requestNotificationPermission() {
        guard Bundle.main.bundleIdentifier != nil else { return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    private func notify(_ a: PrivacyAlert) {
        // UNUserNotificationCenter needs an app bundle; a bare `swift run` binary falls back to AppleScript.
        guard Bundle.main.bundleIdentifier != nil else {
            let esc = { (s: String) in s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") }
            _ = Shell.run("/usr/bin/osascript", ["-e", "display notification \"\(esc(a.detail))\" with title \"Headroom Guard\" subtitle \"\(esc(a.title))\""])
            return
        }
        let c = UNMutableNotificationContent()
        c.title = a.severity == .red ? "🔴 \(a.title)" : a.title
        c.body = a.detail
        c.sound = .default
        c.interruptionLevel = a.severity == .red ? .timeSensitive : .active
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: a.id.uuidString, content: c, trigger: nil))
    }

    // MARK: Persistence and export

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()
    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    /// Append-only, one JSON object per line: a timestamped record you can attach to a complaint or DSAR.
    private func appendLog(_ a: PrivacyAlert) {
        guard var line = try? Self.encoder.encode(a) else { return }
        line.append(0x0A)
        if let h = try? FileHandle(forWritingTo: Self.logURL) {
            h.seekToEndOfFile()
            h.write(line)
            try? h.close()
        } else {
            try? line.write(to: Self.logURL)
        }
    }

    private func save() {
        state.categories = categories
        if let d = try? Self.encoder.encode(state) { try? d.write(to: Self.stateURL, options: .atomic) }
    }

    private func prune() {
        let cutoff = Self.dayKey(Date().addingTimeInterval(-90 * 86400))
        state.days = state.days.filter { $0.key >= cutoff }
        state.lastAlert = state.lastAlert.filter { Date().timeIntervalSince($0.value) < 86400 }
    }

    private func export() {
        var csv = "date,app,category,bytes_out,bytes_in\n"
        for day in state.days.keys.sorted() {
            for (app, t) in state.days[day]!.sorted(by: { $0.key < $1.key }) {
                let name = app.contains(",") ? "\"\(app)\"" : app
                csv += "\(day),\(name),\(categories[app]?.rawValue ?? ""),\(t[0]),\(t[1])\n"
            }
        }
        let url = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("headroom-guard-traffic-\(Self.dayKey(Date())).csv")
        try? csv.write(to: url, atomically: true, encoding: .utf8)
        DispatchQueue.main.async { NSWorkspace.shared.activateFileViewerSelecting([url]) }
    }

    // MARK: Publishing

    private func publish() {
        let today = state.days[Self.dayKey(Date())] ?? [:]
        let traffic = today.compactMap { app, t -> AppTraffic? in
            guard let cat = categories[app] else { return nil }
            let recent = window[app]?.reduce(UInt64(0)) { $0 + $1.out } ?? 0
            return AppTraffic(app: app, category: cat, bytesOutToday: t[0], bytesInToday: t[1],
                              bytesOut15m: recent, hosts: (hosts[app] ?? []).sorted())
        }.sorted { $0.bytesOutToday > $1.bytesOutToday }

        // Last 7 days of uploads: the four biggest apps by name, the rest as "Other".
        let cal = Calendar.current
        let days = (0..<7).reversed().compactMap { cal.date(byAdding: .day, value: -$0, to: cal.startOfDay(for: Date())) }
        var totals: [String: UInt64] = [:]
        for d in days { for (app, t) in state.days[Self.dayKey(d)] ?? [:] { totals[app, default: 0] += t[0] } }
        let top = Set(totals.sorted { $0.value > $1.value }.prefix(4).map(\.key))
        var bars: [DayBar] = []
        for d in days {
            var other: UInt64 = 0
            for (app, t) in state.days[Self.dayKey(d)] ?? [:] {
                if top.contains(app) { bars.append(DayBar(day: d, app: app, megabytes: Double(t[0]) / 1e6)) } else { other += t[0] }
            }
            if other > 0 { bars.append(DayBar(day: d, app: "Other", megabytes: Double(other) / 1e6)) }
        }
        let alerts = state.alerts
        DispatchQueue.main.async {
            self.store.traffic = traffic
            self.store.weekly = bars
            self.store.alerts = alerts
            self.onChange()
        }
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func dayKey(_ d: Date) -> String { dayFormatter.string(from: d) }
}
