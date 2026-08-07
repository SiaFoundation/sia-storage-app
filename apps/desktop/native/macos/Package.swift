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
        .library(name: "SiaFileProvider", targets: ["SiaFileProvider"]),
        .library(name: "SiaDomainAgent", targets: ["SiaDomainAgent"]),
    ],
    targets: [
        .target(name: "SiaShared", path: "Shared"),
        .target(name: "SiaFileProvider", dependencies: ["SiaShared"], path: "Ext"),
        // The entry point is excluded because top-level code cannot build into
        // a library; packaging compiles both files together as the executable.
        .target(name: "SiaDomainAgent", path: "Agent", exclude: ["main.swift"]),
        .testTarget(
            name: "SiaDesktopTests",
            dependencies: ["SiaShared", "SiaFileProvider", "SiaDomainAgent"], path: "Tests"),
    ]
)
