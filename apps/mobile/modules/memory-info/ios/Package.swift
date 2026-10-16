// swift-tools-version:5.9
// SPM manifest for the host test tier only: `MemoryReading.swift` has no
// ExpoModulesCore import, so it compiles and tests headlessly on the Mac via
// `swift test --package-path apps/mobile/modules/memory-info/ios`. The pod
// build ignores this file and the tests (excluded in the podspec).
import PackageDescription

let package = Package(
  name: "MemoryInfoCore",
  platforms: [.macOS(.v13), .iOS(.v16)],
  targets: [
    .target(
      name: "MemoryInfoCore",
      path: ".",
      exclude: ["MemoryInfo.podspec", "MemoryInfoModule.swift", "Tests"],
      sources: ["MemoryReading.swift"]
    ),
    .testTarget(
      name: "MemoryInfoCoreTests",
      dependencies: ["MemoryInfoCore"],
      path: "Tests/Host"
    ),
  ]
)
