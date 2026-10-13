// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "HeadroomGuard",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "HeadroomGuard",
            path: "Sources/HeadroomGuard",
            linkerSettings: [
                .linkedFramework("IOKit"),
                .linkedFramework("ServiceManagement"),
                .linkedFramework("UserNotifications"),
            ]
        )
    ]
)
