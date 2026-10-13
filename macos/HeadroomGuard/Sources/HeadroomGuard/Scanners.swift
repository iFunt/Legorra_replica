import Foundation
import AppKit

/// Lists installed browser extensions and scores what they are allowed to do.
///
/// macOS sees an extension's traffic only as its browser's traffic, so per-extension byte counts are not
/// available from outside the browser. What can be checked is each extension's declared capability
/// (manifest permissions) and when it changes, which is how a sold or hijacked extension usually shows up.
enum ExtensionScanner {
    private static let support = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support")

    static func scan() -> [ExtensionInfo] {
        (chromium() + firefox()).sorted { ($0.level, $0.score) > ($1.level, $1.score) }
    }

    // MARK: Chromium family (Chrome, Brave, Edge, Arc, Vivaldi, Opera, Comet, Dia, ...)

    /// Any folder up to three levels under Application Support holding `Preferences` and `Extensions`
    /// is a Chromium profile, which picks up new Chromium-based browsers without a hard-coded list.
    private static func chromium() -> [ExtensionInfo] {
        let fm = FileManager.default
        var profiles: [URL] = []
        func visit(_ dir: URL, depth: Int) {
            let ext = dir.appendingPathComponent("Extensions")
            if fm.fileExists(atPath: ext.path), fm.fileExists(atPath: dir.appendingPathComponent("Preferences").path) {
                profiles.append(dir)
                return
            }
            guard depth < 3, let kids = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey],
                                                                     options: [.skipsHiddenFiles]) else { return }
            for k in kids where (try? k.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
                visit(k, depth: depth + 1)
            }
        }
        visit(support, depth: 0)

        var result: [ExtensionInfo] = []
        for profile in profiles {
            let rel = profile.path.replacingOccurrences(of: support.path + "/", with: "")
            let parts = rel.split(separator: "/").map(String.init).filter { $0 != "User Data" }
            let folder = parts.count > 1 ? parts.dropLast().joined(separator: " ") : (parts.first ?? rel)
            let browser = browserNames[folder] ?? folder
            let profileName = parts.count > 1 ? parts.last! : "Default"
            let extDir = profile.appendingPathComponent("Extensions")
            for id in (try? fm.contentsOfDirectory(atPath: extDir.path)) ?? [] where !id.hasPrefix(".") && id != "Temp" {
                let versions = ((try? fm.contentsOfDirectory(atPath: extDir.appendingPathComponent(id).path)) ?? [])
                    .filter { !$0.hasPrefix(".") }
                    .sorted { $0.compare($1, options: .numeric) == .orderedAscending }
                guard let v = versions.last else { continue }
                let root = extDir.appendingPathComponent(id).appendingPathComponent(v)
                guard let data = try? Data(contentsOf: root.appendingPathComponent("manifest.json")),
                      let m = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                let rawName = m["name"] as? String ?? id
                let name = localized(rawName, root: root, defaultLocale: m["default_locale"] as? String)
                var perms: [String] = []
                var hosts: [String] = []
                for p in (m["permissions"] as? [Any] ?? []).compactMap({ $0 as? String }) {
                    if p.contains("://") || p == "<all_urls>" { hosts.append(p) } else { perms.append(p) }
                }
                hosts += (m["host_permissions"] as? [String]) ?? []
                for cs in (m["content_scripts"] as? [[String: Any]]) ?? [] { hosts += (cs["matches"] as? [String]) ?? [] }
                result.append(make(browser: browser, profile: profileName, id: id, name: name,
                                   version: m["version"] as? String ?? v, perms: perms, hosts: hosts))
            }
        }
        return result
    }

    /// Friendly names for browser data folders that are not already readable.
    private static let browserNames: [String: String] = [
        "com.operasoftware.Opera": "Opera",
        "com.operasoftware.OperaGX": "Opera GX",
        "com.operasoftware.OperaAir": "Opera Air",
        "BraveSoftware Brave-Browser": "Brave",
        "Google Chrome": "Chrome",
        "Google Chrome Beta": "Chrome Beta",
        "Google Chrome Canary": "Chrome Canary",
        "Microsoft Edge": "Edge",
    ]

    private static func localized(_ name: String, root: URL, defaultLocale: String?) -> String {
        guard name.hasPrefix("__MSG_"), name.hasSuffix("__") else { return name }
        let key = String(name.dropFirst(6).dropLast(2)).lowercased()
        for loc in [defaultLocale, "en", "en_US", "en_GB"].compactMap({ $0 }) {
            let url = root.appendingPathComponent("_locales/\(loc)/messages.json")
            guard let d = try? Data(contentsOf: url), let msgs = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { continue }
            for (k, v) in msgs where k.lowercased() == key {
                if let s = (v as? [String: Any])?["message"] as? String { return s }
            }
        }
        return name
    }

    // MARK: Firefox

    private static func firefox() -> [ExtensionInfo] {
        let dir = support.appendingPathComponent("Firefox/Profiles")
        var result: [ExtensionInfo] = []
        for profile in (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [] {
            let url = dir.appendingPathComponent(profile).appendingPathComponent("extensions.json")
            guard let d = try? Data(contentsOf: url),
                  let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let addons = j["addons"] as? [[String: Any]] else { continue }
            for a in addons where (a["type"] as? String) == "extension" && (a["location"] as? String) == "app-profile" {
                let up = a["userPermissions"] as? [String: Any] ?? [:]
                let name = (a["defaultLocale"] as? [String: Any])?["name"] as? String ?? (a["id"] as? String ?? "?")
                result.append(make(browser: "Firefox", profile: profile, id: a["id"] as? String ?? name, name: name,
                                   version: a["version"] as? String ?? "", perms: up["permissions"] as? [String] ?? [],
                                   hosts: up["origins"] as? [String] ?? []))
            }
        }
        return result
    }

    // MARK: Scoring

    private static let weights: [String: (Int, String)] = [
        "debugger": (25, "can attach a debugger to any tab"),
        "proxy": (20, "can route your traffic through a proxy"),
        "desktopCapture": (20, "can capture your screen"),
        "tabCapture": (20, "can capture tab audio and video"),
        "cookies": (15, "can read cookies (session logins)"),
        "history": (15, "can read your browsing history"),
        "clipboardRead": (15, "can read your clipboard"),
        "nativeMessaging": (15, "can talk to apps outside the browser"),
        "management": (15, "can manage other extensions"),
        "webRequest": (10, "can watch every network request"),
        "webRequestBlocking": (5, "can block or modify requests"),
        "scripting": (10, "can inject scripts into pages"),
        "pageCapture": (10, "can save full page contents"),
        "privacy": (10, "can change privacy settings"),
        "declarativeNetRequest": (5, "can filter requests"),
        "tabs": (5, "can see the URLs and titles of your tabs"),
        "webNavigation": (5, "can see where you navigate"),
        "downloads": (5, "can manage downloads"),
        "identity": (5, "can use your browser sign-in"),
        "geolocation": (5, "can read your location"),
        "bookmarks": (5, "can read your bookmarks"),
        "topSites": (5, "can see your most visited sites"),
    ]

    private static func make(browser: String, profile: String, id: String, name: String,
                             version: String, perms: [String], hosts: [String]) -> ExtensionInfo {
        var score = 0
        var reasons: [String] = []
        let uniqHosts = Array(Set(hosts)).sorted()
        if uniqHosts.contains(where: ExtensionInfo.allSites.contains) {
            score += 40
            reasons.append("can read and change data on all websites")
        } else if !uniqHosts.isEmpty {
            score += min(20, uniqHosts.count * 4)
            reasons.append("runs on \(uniqHosts.count) site pattern\(uniqHosts.count == 1 ? "" : "s")")
        }
        for p in Set(perms).sorted() {
            if case let (w, why)? = weights[p] { score += w; reasons.append(why) }
        }
        let level: RiskLevel = score >= 60 ? .high : score >= 30 ? .medium : .low
        return ExtensionInfo(browser: browser, profile: profile, extID: id, name: name, version: version,
                             permissions: Array(Set(perms)).sorted(), hosts: uniqHosts,
                             score: score, level: level, reasons: reasons)
    }
}

/// Apps you have granted sensitive macOS permissions (Screen Recording, Accessibility, Full Disk Access, ...),
/// read from the TCC databases. macOS only lets an app read these after you give it Full Disk Access;
/// without that the scan reports `readable == false` and the dashboard says how to enable it.
enum AccessScanner {
    static let services: [String: String] = [
        "kTCCServiceScreenCapture": "Screen Recording",
        "kTCCServiceAccessibility": "Accessibility",
        "kTCCServiceSystemPolicyAllFiles": "Full Disk Access",
        "kTCCServiceListenEvent": "Input Monitoring",
        "kTCCServicePostEvent": "Control input",
        "kTCCServiceMicrophone": "Microphone",
        "kTCCServiceCamera": "Camera",
        "kTCCServiceAddressBook": "Contacts",
        "kTCCServiceCalendar": "Calendars",
        "kTCCServicePhotos": "Photos",
        "kTCCServiceSystemPolicyDocumentsFolder": "Documents folder",
        "kTCCServiceSystemPolicyDesktopFolder": "Desktop folder",
        "kTCCServiceSystemPolicyDownloadsFolder": "Downloads folder",
        "kTCCServiceAppleEvents": "Automation",
    ]
    /// Grants that let an app see or take data from other apps; their holders are watched on the network.
    static let watchedServices: Set<String> = [
        "Screen Recording", "Accessibility", "Full Disk Access", "Input Monitoring", "Microphone", "Camera",
    ]

    static func scan() -> (grants: [AccessGrant], readable: Bool) {
        let dbs = [
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/com.apple.TCC/TCC.db").path,
            "/Library/Application Support/com.apple.TCC/TCC.db",
        ]
        var grants = Set<AccessGrant>()
        var readable = false
        for db in dbs {
            guard let r = Shell.run("/usr/bin/sqlite3", ["-readonly", "-separator", "|", db,
                                                          "SELECT service, client FROM access WHERE auth_value = 2;"]),
                  r.status == 0 else { continue }
            readable = true
            for line in r.out.split(whereSeparator: \.isNewline) {
                let cols = line.split(separator: "|", maxSplits: 1).map(String.init)
                guard cols.count == 2, let svc = services[cols[0]] else { continue }
                grants.insert(AccessGrant(service: svc, client: cols[1], app: appName(cols[1])))
            }
        }
        return (grants.sorted { ($0.app, $0.service) < ($1.app, $1.service) }, readable)
    }

    private static func appName(_ client: String) -> String {
        if client.hasPrefix("/") {
            if let r = client.range(of: ".app") {
                return (String(client[..<r.lowerBound]) as NSString).lastPathComponent
            }
            return (client as NSString).lastPathComponent
        }
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: client) {
            return url.deletingPathExtension().lastPathComponent
        }
        return client
    }
}
