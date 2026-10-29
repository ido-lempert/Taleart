import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

kotlin {
    val xcFramework = XCFramework("TaleartSDK")
    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "TaleartSDK"
            isStatic = true
            export(project(":mobile-sdk"))
            xcFramework.add(this)
        }
    }

    sourceSets {
        iosMain.dependencies {
            api(project(":mobile-sdk"))
            // ComposeUIViewController hosts the shared TaleartZone.
            implementation(libs.compose.ui)
        }
    }
}

// The release XCFramework for SwiftPM (Package.swift at the repository root). The release workflow runs these
// on macOS and attaches the zip to the GitHub release: build/release/TaleartSDK.xcframework.zip, and its
// checksum (what Package.swift names) in build/release/TaleartSDK.xcframework.zip.checksum.
val releaseXcframeworkZip = tasks.register<Zip>("releaseXcframeworkZip") {
    group = "distribution"
    description = "Zips the release TaleartSDK XCFramework into build/release/TaleartSDK.xcframework.zip."
    dependsOn("assembleTaleartSDKReleaseXCFramework")
    from(layout.buildDirectory.dir("XCFrameworks/release/TaleartSDK.xcframework")) {
        into("TaleartSDK.xcframework")
    }
    archiveFileName.set("TaleartSDK.xcframework.zip")
    destinationDirectory.set(rootProject.layout.buildDirectory.dir("release"))
}

val releaseXcframeworkChecksum = tasks.register("releaseXcframeworkChecksum") {
    group = "distribution"
    description = "Writes the SwiftPM checksum of the release zip (swift package compute-checksum) next to it."
    dependsOn(releaseXcframeworkZip)
    val zip = releaseXcframeworkZip.flatMap { it.archiveFile }
    val checksumFile = rootProject.layout.buildDirectory.file("release/TaleartSDK.xcframework.zip.checksum")
    inputs.file(zip)
    outputs.file(checksumFile)
    doLast {
        val process = ProcessBuilder("swift", "package", "compute-checksum", zip.get().asFile.absolutePath)
            .redirectError(ProcessBuilder.Redirect.INHERIT)
            .start()
        val checksum = process.inputStream.bufferedReader().readText().trim()
        if (process.waitFor() != 0 || checksum.isEmpty()) throw GradleException("swift package compute-checksum failed")
        checksumFile.get().asFile.writeText(checksum + "\n")
    }
}
