import Foundation
import AppKit
import Darwin

// MARK: - Types

enum WatchCategory: String, Codable {
    case ai, browser, access, custom

    var symbol: String {
        switch self {
        case .ai: return "sparkles"
        case .browser: return "globe"
        case .access: return "lock.open"
        case .custom: return "eye"
        }
    }

    var label: String {
        switch self {
        case .ai: return "AI / LLM app"
        case .browser: return "Browser (extensions run inside it)"
        case .access: return "Has sensitive macOS access"
        case .custom: return "On your watchlist"
        }
    }
}

enum Severity: String, Codable {
    case red, amber
}

struct PrivacyAlert: Codable, Identifiable, Hashable {
    var id = UUID()
    var time: Date
    var severity: Severity
    var app: String
    var title: String
    var detail: String
    var reviewed = false
}

struct AppTraffic: Identifiable {
    var id: String { app }
    var app: String
    var category: WatchCategory
    var bytesOutToday: UInt64
    var bytesInToday: UInt64
    var bytesOut15m: UInt64
    var hosts: [String]
}

struct DayBar: Identifiable {
    var id: String { "\(day.timeIntervalSince1970)-\(app)" }
    var day: Date
    var app: String
    var megabytes: Double
}

enum RiskLevel: Int, Codable, Comparable {
    case low, medium, high
    static func < (a: RiskLevel, b: RiskLevel) -> Bool { a.rawValue < b.rawValue }
    var label: String { ["Low", "Medium", "High"][rawValue] }
}

struct ExtensionInfo: Identifiable, Hashable {
    var id: String { "\(browser)|\(profile)|\(extID)" }
    var browser: String
    var profile: String
    var extID: String
    var name: String
    var version: String
    var permissions: [String]
    var hosts: [String]
    var score: Int
    var level: RiskLevel
    var reasons: [String]

    /// Changes when the extension updates or its permissions change.
    var fingerprint: String { (permissions + hosts).sorted().joined(separator: ",") }
}

struct AccessGrant: Identifiable, Hashable {
    var id: String { "\(service)|\(client)" }
    var service: String
    var client: String
    var app: String
}

// MARK: - Preferences

enum PrivacyPrefs {
    static let enabled = "privacy.enabled"
    static let notify = "privacy.notify"
    static let alertBrowsers = "privacy.alertBrowsers"
    static let fgThresholdMB = "privacy.fgThresholdMB"
    static let bgThresholdMB = "privacy.bgThresholdMB"
    /// Comma-separated extra app names to watch, e.g. "Notion, Grammarly".
    static let extraApps = "privacy.extraApps"

    static func register() {
        UserDefaults.standard.register(defaults: [
            enabled: true, notify: true, alertBrowsers: false,
            fgThresholdMB: 5.0, bgThresholdMB: 1.0, extraApps: "",
        ])
    }

    static var fgThreshold: UInt64 { UInt64(max(0.1, UserDefaults.standard.double(forKey: fgThresholdMB)) * 1_000_000) }
    static var bgThreshold: UInt64 { UInt64(max(0.1, UserDefaults.standard.double(forKey: bgThresholdMB)) * 1_000_000) }
    static var extra: [String] {
        (UserDefaults.standard.string(forKey: extraApps) ?? "")
            .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
    }
}

// MARK: - Watchlist

/// Decides which apps are watched. Matching is on whole words of the app name, so "Claude" matches
/// "Claude" and "Claude Helper" but "arc" does not match "Search".
enum Watchlist {
    static let ai = [
        "kimi", "chatgpt", "openai", "claude", "perplexity", "comet", "deepseek", "gemini", "copilot", "cursor",
        "windsurf", "ollama", "lm studio", "msty", "poe", "grok", "mistral", "le chat", "qwen", "doubao",
        "manus", "monica", "jan", "chatbox", "anythingllm", "gpt4all", "raycast", "granola", "otter", "fireflies",
        "superwhisper", "macwhisper", "notion ai", "grammarly",
    ]
    static let browsers = [
        "google chrome", "chrome", "brave browser", "microsoft edge", "arc", "firefox", "safari", "opera",
        "vivaldi", "chromium", "dia", "orion", "zen", "com.apple.webkit.networking",
    ]

    static func category(app: String, bundleID: String?, accessClients: Set<String>) -> WatchCategory? {
        let lower = app.lowercased()
        let tokens = Set(lower.split { !$0.isLetter && !$0.isNumber && $0 != "." }.map(String.init))
        func hit(_ p: String) -> Bool { p.contains(" ") || p.contains(".") ? lower.contains(p) : tokens.contains(p) }

        if PrivacyPrefs.extra.contains(where: hit) { return .custom }
        if ai.contains(where: hit) { return .ai }
        if browsers.contains(where: hit) { return .browser }
        if let bundleID, accessClients.contains(bundleID) { return .access }
        if accessClients.contains(app) { return .access }
        return nil
    }
}

// MARK: - App identity

/// App name and bundle id for a pid: the outermost .app bundle in its path (so helpers fold into their app),
/// else the binary's tool folder or process name. Same rule as the hover panels.
enum AppIdentity {
    private static var cache: [String: (name: String, bundleID: String?)] = [:]

    static func resolve(_ pid: pid_t, process: String) -> (name: String, bundleID: String?) {
        let key = "\(pid):\(process)"
        if let c = cache[key] { return c }
        var buf = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
        var result: (name: String, bundleID: String?) = (process, nil)
        if proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 {
            let path = String(cString: buf)
            if let r = path.range(of: ".app/") {
                let appPath = String(path[..<r.lowerBound]) + ".app"
                let name = (appPath as NSString).lastPathComponent.replacingOccurrences(of: ".app", with: "")
                result = (name, Bundle(path: appPath)?.bundleIdentifier)
            } else if path.contains("com.apple.WebKit.Networking") {
                result = ("Safari / WebKit", "com.apple.Safari")
            } else {
                let parts = path.split(separator: "/").map(String.init)
                let n = parts.reversed().first { p in
                    !(p.first?.isNumber ?? false) && !["versions", "bin", "libexec", "current"].contains(p)
                } ?? process
                result = (n, nil)
            }
        }
        if cache.count > 4000 { cache.removeAll() }
        cache[key] = result
        return result
    }
}

// MARK: - Store

/// What the dashboard shows. Written on the main thread by PrivacyMonitor.
final class PrivacyStore: ObservableObject {
    @Published var traffic: [AppTraffic] = []
    @Published var alerts: [PrivacyAlert] = []
    @Published var extensions: [ExtensionInfo] = []
    @Published var grants: [AccessGrant] = []
    @Published var weekly: [DayBar] = []
    /// nil until the first scan; false when Full Disk Access has not been granted.
    @Published var accessReadable: Bool?
    @Published var networkError: String?
    @Published var lastScan: Date?

    var rescan: () -> Void = {}
    var markReviewed: () -> Void = {}
    var exportCSV: () -> Void = {}
    var revealLog: () -> Void = {}

    var openRed: Int { alerts.filter { $0.severity == .red && !$0.reviewed }.count }
    var openAmber: Int { alerts.filter { $0.severity == .amber && !$0.reviewed }.count }
}

enum Bytes {
    static func short(_ b: UInt64) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(clamping: b), countStyle: .file)
    }
}
