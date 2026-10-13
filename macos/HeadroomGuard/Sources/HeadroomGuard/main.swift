import AppKit
import SwiftUI
import ServiceManagement

final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private let store = Store()
    private let sampler = SystemSampler()
    private let claudeClient = ClaudeLimitsClient()
    private let grokClient = GrokClient()
    private let ledger = Ledger()
    private lazy var privacyMonitor = PrivacyMonitor(store: store.privacy)

    private var statusItem: NSStatusItem!
    /// Separate item so it can turn red: the main strip is a template image that macOS always tints.
    private var shieldItem: NSStatusItem?
    private let popover = NSPopover()
    private var sampleTimer: Timer?
    private var timers: [Timer] = []
    private var tick = 0
    private var ledgerBusy = false
    private var claudeBackoffUntil = Date.distantPast
    private var currentInterval = 0.0
    private var snapshotDir: URL?
    private var hover: HoverController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Prefs.register()
        PrivacyPrefs.register()
        Pricing.shared.load()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.target = self
            button.action = #selector(togglePopover(_:))
            button.imagePosition = .imageOnly
            hover = HoverController(store: store, button: button)
        }
        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self

        if !UserDefaults.standard.bool(forKey: "didRegisterLoginItem") {
            UserDefaults.standard.set(true, forKey: "didRegisterLoginItem")
            try? SMAppService.mainApp.register()
        }

        if let i = CommandLine.arguments.firstIndex(of: "--snapshot"), i + 1 < CommandLine.arguments.count {
            snapshotDir = URL(fileURLWithPath: CommandLine.arguments[i + 1])
        }

        if UserDefaults.standard.bool(forKey: PrivacyPrefs.enabled) {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
            item.button?.target = self
            item.button?.action = #selector(togglePopover(_:))
            shieldItem = item
            privacyMonitor.onChange = { [weak self] in self?.redrawShield() }
            redrawShield()
            privacyMonitor.start()
        }

        startSampling()
        sample()
        refreshLimits()
        refreshUsage()
        timers = [
            Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.refreshLimits() },
            Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in self?.refreshUsage() },
        ]
        timers.forEach { $0.tolerance = 2 }
        if snapshotDir != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.writeSnapshots() }
        }

        NotificationCenter.default.addObserver(forName: UserDefaults.didChangeNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            if Prefs.sampleInterval != currentInterval { startSampling() }
            redraw()
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refreshLimits()
            self?.refreshUsage()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        ledger.flush()
        privacyMonitor.flush()
    }

    // MARK: Sampling

    private func startSampling() {
        sampleTimer?.invalidate()
        currentInterval = Prefs.sampleInterval
        let t = Timer(timeInterval: currentInterval, repeats: true) { [weak self] _ in self?.sample() }
        t.tolerance = currentInterval * 0.1
        RunLoop.main.add(t, forMode: .common)
        sampleTimer = t
    }

    private func sample() {
        store.record(cpu: sampler.cpu(), gpu: sampler.gpu(), memory: sampler.memory())
        // Battery changes slowly and reading the smart battery registry is the costliest probe.
        if tick % max(1, Int(5 / currentInterval)) == 0 { store.battery = sampler.battery() }
        tick += 1
        redraw()
    }

    private func redraw() {
        statusItem.button?.image = StatusRenderer.render(store)

    }

    // MARK: Limits and usage

    private func refreshLimits(force: Bool = false) {
        if force || Date() >= claudeBackoffUntil {
            Task { @MainActor in
                do {
                    store.claudeLimits = try await claudeClient.fetch()
                    store.claudeError = nil
                    store.claudeAvailable = true
                } catch ClientError.notConfigured {
                    store.claudeAvailable = false
                    store.claudeLimits = nil
                } catch {
                    store.claudeAvailable = true
                    store.claudeError = error.localizedDescription
                    if case ClientError.http(429) = error { claudeBackoffUntil = Date().addingTimeInterval(300) }
                }
                redraw()
            }
        }
        Task { @MainActor in
            do {
                store.grokPlan = try await grokClient.fetch()
                store.grokError = nil
                store.grokAvailable = true
            } catch ClientError.notConfigured {
                store.grokAvailable = false
                store.grokPlan = nil
            } catch {
                store.grokError = error.localizedDescription
            }
            redraw()
        }
    }

    private func refreshUsage() {
        guard !ledgerBusy else { return }
        ledgerBusy = true
        let windowStart = store.claudeLimits?.session?.resetsAt.map { $0.addingTimeInterval(-5 * 3600) }
        ledger.refresh(windowStart: windowStart, progress: { [weak self] msg in
            DispatchQueue.main.async { self?.store.indexing = msg }
        }, completion: { [weak self] claude, grok in
            DispatchQueue.main.async {
                guard let self else { return }
                self.store.claudeUsage = claude
                self.store.grokUsage = grok
                self.store.usageUpdated = Date()
                self.ledgerBusy = false
            }
        })
    }

    /// Shield in the menu bar: plain when clear, red with a count when an alert has not been reviewed.
    private func redrawShield() {
        guard let button = shieldItem?.button else { return }
        let red = store.privacy.openRed
        let amber = store.privacy.openAmber
        let name = red > 0 ? "exclamationmark.shield.fill" : amber > 0 ? "exclamationmark.shield" : "checkmark.shield"
        let image = NSImage(systemSymbolName: name, accessibilityDescription: "Privacy")?
            .withSymbolConfiguration(.init(pointSize: 13, weight: .medium))
        image?.isTemplate = true
        button.image = image
        button.contentTintColor = red > 0 ? .systemRed : amber > 0 ? .systemOrange : nil
        let count = red > 0 ? red : amber
        button.imagePosition = count > 0 ? .imageLeading : .imageOnly
        button.attributedTitle = count > 0
            ? NSAttributedString(string: "\(count)", attributes: [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 11.5, weight: .semibold),
                .foregroundColor: red > 0 ? NSColor.systemRed : NSColor.systemOrange,
            ])
            : NSAttributedString(string: "")
        button.toolTip = count > 0 ? "\(count) privacy alert\(count == 1 ? "" : "s") to review" : "No privacy alerts"
    }

    // MARK: Popover

    @objc private func togglePopover(_ sender: NSStatusBarButton?) {
        guard let button = sender ?? statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
            return
        }
        hover?.hide()
        let view = PopoverView(store: store, actions: PopoverActions(
            refresh: { [weak self] in
                self?.refreshLimits(force: true)
                self?.refreshUsage()
            },
            quit: { NSApp.terminate(nil) }))
        let host = NSHostingController(rootView: view)
        host.sizingOptions = .preferredContentSize
        popover.contentViewController = host
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        NSApp.activate(ignoringOtherApps: true)
    }

    func popoverDidClose(_ notification: Notification) {
        // Drop the SwiftUI tree so nothing renders while the popover is hidden.
        popover.contentViewController = nil
    }
}

// MARK: - Snapshot mode (`Headroom --snapshot <dir>`): renders the strip and popover to PNGs, then exits.

extension AppDelegate {
    @MainActor fileprivate func writeSnapshots() {
        guard let dir = snapshotDir else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let strip = StatusRenderer.render(store)
        for (name, appearance) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
            let scale: CGFloat = 4
            let size = NSSize(width: strip.size.width * scale, height: strip.size.height * scale)
            let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                                       bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                       colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
            NSAppearance(named: appearance)!.performAsCurrentDrawingAppearance {
                (appearance == .darkAqua ? NSColor(white: 0.16, alpha: 1) : NSColor(white: 0.93, alpha: 1)).setFill()
                NSRect(origin: .zero, size: size).fill()
                strip.draw(in: NSRect(origin: .zero, size: size))
            }
            NSGraphicsContext.restoreGraphicsState()
            try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("strip-\(name).png"))
        }
        print("strip width pt:", strip.size.width)

        let view = PopoverView(store: store, actions: PopoverActions(refresh: {}, quit: {}))
            .background(Color(nsColor: NSColor(white: 0.13, alpha: 1)))
            .environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        if let cg = renderer.cgImage {
            try? NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])?
                .write(to: dir.appendingPathComponent("popover.png"))
        }
        ledger.flush()
        exit(0)
    }
}

// `HeadroomGuard --privacy-selftest`: runs each privacy probe once, prints what it found, then exits.
if CommandLine.arguments.contains("--privacy-selftest") {
    let raw = Shell.run("/usr/bin/nettop", ["-P", "-L", "1", "-x", "-J", "bytes_in,bytes_out"])
    print("nettop status:", raw?.status ?? -1)
    print(raw?.out.split(separator: "\n").prefix(4).joined(separator: "\n") ?? "(no output)")
    let readings = NetworkMonitor.parseNettop(raw?.out ?? "")
    print("nettop processes parsed:", readings.count)
    for r in readings.sorted(by: { $0.bytesOut > $1.bytesOut }).prefix(5) {
        print("  \(AppIdentity.resolve(r.pid, process: r.process).name) [\(r.pid)] out=\(r.bytesOut) in=\(r.bytesIn)")
    }
    let net = NetworkMonitor()
    _ = net.sample()
    Thread.sleep(forTimeInterval: 2)
    print("apps with traffic in 2 s:", net.sample()?.count ?? -1)
    let pids = Set(readings.map(\.pid))
    let ends = net.endpoints(for: pids)
    print("lsof pids with remote endpoints:", ends.count, ends.values.first.map { Array($0.prefix(3)) } ?? [])
    let exts = ExtensionScanner.scan()
    print("extensions found:", exts.count, exts.prefix(3).map { "\($0.name) [\($0.level.label)]" })
    let access = AccessScanner.scan()
    print("TCC readable:", access.readable, "grants:", access.grants.count)
    exit(readings.isEmpty ? 1 : 0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
