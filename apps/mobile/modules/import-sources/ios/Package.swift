// swift-tools-version:5.9
// SPM manifest for the host test tier only: the pure units (no
// ExpoModulesCore/Photos imports) compile and test headlessly on the mac via
// `swift test --package-path apps/mobile/modules/import-sources/ios`. The pod
// build ignores this file (excluded in the podspec); the Expo binding files
// are deliberately absent from the target.
import PackageDescription

let package = Package(
  name: "ImportSourcesCore",
  platforms: [.macOS(.v13), .iOS(.v16)],
  targets: [
    .target(
      name: "ImportSourcesCore",
      path: ".",
      exclude: [
        "ImportSources.podspec",
        "ImportSourcesException.swift",
        "ImportSourceRefsModule.swift",
        "MediaAssetReaderModule.swift",
        "AssetCopier.swift",
        "DocumentPickerPresenter.swift",
        "Tests",
      ],
      sources: [
        "CodedError.swift",
        "SourceRefCodec.swift",
        "Sha256Sink.swift",
        "ScopeRegistry.swift",
        "CopyRegistry.swift",
        "ProgressThrottle.swift",
        "MimeSniffer.swift",
        "StreamCopier.swift",
        "BytesPolicy.swift",
        "AuthClassification.swift",
        "GrantBudget.swift",
        "BookmarkEngine.swift",
      ]
    ),
    .testTarget(
      name: "ImportSourcesCoreTests",
      dependencies: ["ImportSourcesCore"],
      path: "Tests/Host"
    ),
  ]
)
