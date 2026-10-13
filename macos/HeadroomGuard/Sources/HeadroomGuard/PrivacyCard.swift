import SwiftUI
import Charts
import AppKit

/// Dashboard column: alerts, today's traffic per watched app, a 7-day upload chart, risky browser
/// extensions and apps holding sensitive macOS permissions.
struct PrivacyCard: View {
    @ObservedObject var privacy: PrivacyStore
    @State private var showAllExtensions = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            alertsSection
            trafficSection
            extensionsSection
            accessSection
        }
    }

    // MARK: Alerts

    private var alertsSection: some View {
        let open = privacy.alerts.filter { !$0.reviewed }
        let tint: Color = privacy.openRed > 0 ? .red : privacy.openAmber > 0 ? .orange : .green
        return VStack(alignment: .leading, spacing: 8) {
            CardHeader(title: "Data leaving your Mac", icon: privacy.openRed > 0 ? "exclamationmark.shield.fill" : "checkmark.shield",
                       tint: tint, trailing: open.isEmpty ? "All clear" : "\(open.count) to review")
            if let err = privacy.networkError {
                Text(err).font(.system(size: 11)).foregroundStyle(.orange)
            }
            if open.isEmpty {
                Text("No uploads above your thresholds and no new risky extensions or permissions.")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            } else {
                ForEach(Array(open.prefix(4))) { a in
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(a.severity == .red ? Color.red : .orange).frame(width: 8, height: 8).padding(.top, 4)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(a.title).font(.system(size: 11.5, weight: .semibold)).lineLimit(2)
                            Text(a.detail).font(.system(size: 10.5)).foregroundStyle(.secondary).lineLimit(3)
                            Text(a.time.formatted(date: .abbreviated, time: .shortened)).font(.system(size: 10)).foregroundStyle(.tertiary)
                        }
                    }
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 8).fill((a.severity == .red ? Color.red : .orange).opacity(0.12)))
                }
                if open.count > 4 {
                    Text("+\(open.count - 4) more in the evidence log").font(.system(size: 10.5)).foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 10) {
                if !open.isEmpty { Button("Mark reviewed", action: privacy.markReviewed) }
                Button("Evidence log", action: privacy.revealLog).help("Every alert with time, size and destination (JSON lines)")
                Button("Export CSV", action: privacy.exportCSV).help("Daily bytes per watched app, saved to Downloads")
            }
            .buttonStyle(.borderless).font(.system(size: 11))
        }
        .padding(12)
        .background(CardBackground())
    }

    // MARK: Traffic

    private var trafficSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            CardHeader(title: "Watched apps today", icon: "arrow.up.arrow.down", tint: .blue,
                       trailing: privacy.traffic.isEmpty ? nil : "↑ \(Bytes.short(privacy.traffic.reduce(0) { $0 + $1.bytesOutToday }))")
            if privacy.traffic.isEmpty {
                Text("Nothing from AI apps, browsers or apps with sensitive access yet today.")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            } else {
                Grid(alignment: .leading, horizontalSpacing: 8, verticalSpacing: 4) {
                    GridRow {
                        Text("App"); Text("↑ Sent").gridColumnAlignment(.trailing); Text("↓ Received").gridColumnAlignment(.trailing); Text("Hosts").gridColumnAlignment(.trailing)
                    }
                    .font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
                    ForEach(Array(privacy.traffic.prefix(8))) { t in
                        GridRow {
                            HStack(spacing: 4) {
                                Image(systemName: t.category.symbol).foregroundStyle(.secondary).frame(width: 12)
                                Text(t.app).lineLimit(1)
                            }
                            .help(t.category.label)
                            Text(Bytes.short(t.bytesOutToday)).monospacedDigit()
                                .foregroundStyle(t.bytesOut15m >= PrivacyPrefs.fgThreshold ? Color.red : .primary)
                            Text(Bytes.short(t.bytesInToday)).monospacedDigit().foregroundStyle(.secondary)
                            Text("\(t.hosts.count)").monospacedDigit().foregroundStyle(.secondary)
                                .help(t.hosts.isEmpty ? "No open connections seen yet" : t.hosts.prefix(15).joined(separator: "\n"))
                        }
                        .font(.system(size: 11))
                    }
                }
            }
            if !privacy.weekly.isEmpty {
                Text("Sent per day, last 7 days (MB)").font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
                Chart(privacy.weekly) { b in
                    BarMark(x: .value("Day", b.day, unit: .day), y: .value("MB", b.megabytes))
                        .foregroundStyle(by: .value("App", b.app))
                }
                .chartXAxis { AxisMarks(values: .stride(by: .day)) { _ in AxisValueLabel(format: .dateTime.weekday(.narrow)) } }
                .chartLegend(position: .bottom, spacing: 4)
                .frame(height: 110)
            }
        }
        .padding(12)
        .background(CardBackground())
    }

    // MARK: Extensions

    private var extensionsSection: some View {
        let risky = privacy.extensions.filter { $0.level >= .medium }
        let shown = showAllExtensions ? privacy.extensions : Array(risky.prefix(5))
        return VStack(alignment: .leading, spacing: 8) {
            CardHeader(title: "Browser extensions", icon: "puzzlepiece.extension", tint: risky.isEmpty ? .green : .orange,
                       trailing: "\(privacy.extensions.filter { $0.level == .high }.count) high · \(privacy.extensions.count) total")
            if privacy.extensions.isEmpty {
                Text(privacy.lastScan == nil ? "Scanning…" : "No Chromium or Firefox extensions found.")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
            ForEach(shown) { e in
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(e.level.label.uppercased()).font(.system(size: 9, weight: .bold))
                            .padding(.horizontal, 4).padding(.vertical, 1)
                            .background(Capsule().fill(color(e.level).opacity(0.2)))
                            .foregroundStyle(color(e.level))
                        Text(e.name).font(.system(size: 11.5, weight: .medium)).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(e.browser).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    if !e.reasons.isEmpty {
                        Text(e.reasons.prefix(3).joined(separator: " · ")).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
                .help("\(e.extID) v\(e.version)\nPermissions: \(e.permissions.joined(separator: ", "))\nSites: \(e.hosts.prefix(10).joined(separator: ", "))")
            }
            HStack {
                if privacy.extensions.count > shown.count || showAllExtensions {
                    Button(showAllExtensions ? "Show risky only" : "Show all \(privacy.extensions.count)") { showAllExtensions.toggle() }
                }
                Spacer()
                Button(action: privacy.rescan) { Image(systemName: "arrow.clockwise") }.help("Rescan extensions and permissions")
            }
            .buttonStyle(.borderless).font(.system(size: 11))
            Text("Extension traffic is counted under its browser; macOS cannot split it per extension. Risk is what an extension is allowed to do, not proof of misuse.")
                .font(.system(size: 9.5)).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .background(CardBackground())
    }

    // MARK: macOS permissions

    private var accessSection: some View {
        let sensitive = privacy.grants.filter { AccessScanner.watchedServices.contains($0.service) }
        let byApp = Dictionary(grouping: sensitive, by: \.app).sorted { $0.key < $1.key }
        return VStack(alignment: .leading, spacing: 8) {
            CardHeader(title: "Apps you gave access", icon: "hand.raised", tint: .purple,
                       trailing: privacy.accessReadable == true ? "\(byApp.count) apps" : nil)
            if privacy.accessReadable == false {
                Text("Give Headroom Guard Full Disk Access to list which apps can record your screen, read all files or watch your keyboard.")
                    .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Button("Open Full Disk Access settings") {
                    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!)
                }
                .buttonStyle(.borderless).font(.system(size: 11))
            } else {
                ForEach(Array(byApp.prefix(8)), id: \.key) { pair in
                    HStack(alignment: .firstTextBaseline) {
                        Text(pair.key).font(.system(size: 11.5, weight: .medium)).lineLimit(1)
                        Spacer(minLength: 6)
                        Text(pair.value.map(\.service).joined(separator: ", ")).font(.system(size: 10)).foregroundStyle(.secondary)
                            .lineLimit(2).multilineTextAlignment(.trailing)
                    }
                }
                if byApp.count > 8 {
                    Text("+\(byApp.count - 8) more").font(.system(size: 10.5)).foregroundStyle(.secondary)
                }
            }
        }
        .padding(12)
        .background(CardBackground())
    }

    private func color(_ l: RiskLevel) -> Color {
        switch l {
        case .high: return .red
        case .medium: return .orange
        case .low: return .secondary
        }
    }
}
