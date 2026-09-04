// swift-tools-version:5.9
//
// SwiftPM builds and tests the library targets. The extension is assembled and
// signed as a bundle by the packaging script, because an .appex cannot be
// emitted as a SwiftPM product.

import PackageDescription

let package = Package(
    name: "SiaDesktop",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "SiaShared", targets: ["SiaShared"]),
    ],
    targets: [
        .target(name: "SiaShared", path: "Shared"),
        .testTarget(
            name: "SiaDesktopTests", dependencies: ["SiaShared"], path: "Tests"),
    ]
)
