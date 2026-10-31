// swift-tools-version:5.9
// The TaleArt iOS SDK as a Swift package: the TaleartSDK XCFramework built from libs/ios-sdk (Kotlin
// Multiplatform) and attached to each GitHub release. The checksum is a placeholder in the repository; the release
// workflow (.github/workflows/release.yml) sets the url and checksum on the release tag's commit.
import PackageDescription

let package = Package(
    name: "TaleartSDK",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "TaleartSDK", targets: ["TaleartSDK"]),
    ],
    targets: [
        .binaryTarget(
            name: "TaleartSDK",
            url: "https://github.com/ido-lempert/Taleart/releases/download/v0.1.1/TaleartSDK.xcframework.zip",
            checksum: "0000000000000000000000000000000000000000000000000000000000000000"
        ),
    ]
)
