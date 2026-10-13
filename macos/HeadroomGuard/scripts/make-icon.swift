// Renders the Headroom app icon (a gauge with headroom left) into Resources/AppIcon.icns.
// Usage: swift scripts/make-icon.swift
import AppKit

let out = URL(fileURLWithPath: "Resources/AppIcon.iconset")
try? FileManager.default.removeItem(at: out)
try! FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func draw(_ px: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px)
    // macOS icon grid: the rounded square fills about 80% of the canvas.
    let inset = s * 0.1
    let tile = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
    let shape = NSBezierPath(roundedRect: tile, xRadius: tile.width * 0.225, yRadius: tile.width * 0.225)
    NSGradient(starting: NSColor(srgbRed: 0.16, green: 0.17, blue: 0.21, alpha: 1),
               ending: NSColor(srgbRed: 0.07, green: 0.07, blue: 0.09, alpha: 1))!.draw(in: shape, angle: -90)

    let center = NSPoint(x: tile.midX, y: tile.minY + tile.height * 0.36)
    let radius = tile.width * 0.33
    let width = tile.width * 0.085
    func arc(from: CGFloat, to: CGFloat, color: NSColor) {
        let p = NSBezierPath()
        p.appendArc(withCenter: center, radius: radius, startAngle: from, endAngle: to, clockwise: true)
        p.lineWidth = width
        p.lineCapStyle = .round
        color.setStroke()
        p.stroke()
    }
    // Track, then the used portion; the gap on the right is the headroom.
    arc(from: 180, to: 0, color: NSColor.white.withAlphaComponent(0.14))
    arc(from: 180, to: 62, color: NSColor(srgbRed: 0.85, green: 0.47, blue: 0.34, alpha: 1))

    // Needle pointing at the end of the used portion.
    let angle = CGFloat(62) * .pi / 180
    let tip = NSPoint(x: center.x + cos(angle) * radius * 0.78, y: center.y + sin(angle) * radius * 0.78)
    let needle = NSBezierPath()
    needle.move(to: center)
    needle.line(to: tip)
    needle.lineWidth = width * 0.45
    needle.lineCapStyle = .round
    NSColor.white.setStroke()
    needle.stroke()
    NSColor.white.setFill()
    let hub = width * 0.75
    NSBezierPath(ovalIn: NSRect(x: center.x - hub, y: center.y - hub, width: hub * 2, height: hub * 2)).fill()

    // Small live sparkline under the gauge.
    let base = tile.minY + tile.height * 0.17
    let values: [CGFloat] = [0.3, 0.45, 0.35, 0.6, 0.4, 0.75, 0.5, 0.65, 0.42, 0.55]
    let left = tile.minX + tile.width * 0.22, span = tile.width * 0.56, h = tile.height * 0.08
    let line = NSBezierPath()
    for (i, v) in values.enumerated() {
        let p = NSPoint(x: left + span * CGFloat(i) / CGFloat(values.count - 1), y: base + h * v)
        i == 0 ? line.move(to: p) : line.line(to: p)
    }
    line.lineWidth = width * 0.3
    line.lineJoinStyle = .round
    line.lineCapStyle = .round
    NSColor(srgbRed: 0.33, green: 0.74, blue: 0.98, alpha: 1).setStroke()
    line.stroke()

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
    try! draw(size).write(to: out.appendingPathComponent("icon_\(size)x\(size).png"))
    try! draw(size * 2).write(to: out.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
let p = Process()
p.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
p.arguments = ["-c", "icns", out.path, "-o", "Resources/AppIcon.icns"]
try! p.run(); p.waitUntilExit()
try? FileManager.default.removeItem(at: out)
print(p.terminationStatus == 0 ? "wrote Resources/AppIcon.icns" : "iconutil failed")
