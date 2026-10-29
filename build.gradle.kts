plugins {
    id("dev.nx.gradle.project-graph") version("0.1.25")
    // this is necessary to avoid the plugins to be loaded multiple times
    // in each subproject's classloader
    alias(libs.plugins.androidApplication) apply false
    alias(libs.plugins.androidLibrary) apply false
    alias(libs.plugins.androidMultiplatformLibrary) apply false
    alias(libs.plugins.composeMultiplatform) apply false
    alias(libs.plugins.composeCompiler) apply false
    alias(libs.plugins.kotlinMultiplatform) apply false
    alias(libs.plugins.kotlinSerialization) apply false
    alias(libs.plugins.mavenPublish) apply false
}

allprojects {
    apply {
        plugin("dev.nx.gradle.project-graph")
    }
}

// The SDKs' versions must agree: gradle.properties (taleartVersion), TaleartSdk.VERSION, the Web SDK's
// package.json and the release URL in Package.swift. Run by `check` and by every publish task of the SDKs.
val verifyTaleartVersions = tasks.register("verifyTaleartVersions") {
    group = "verification"
    description = "Fails when the SDK versions differ between gradle.properties, TaleartSdk.VERSION, the Web SDK and Package.swift."
    val expected = providers.gradleProperty("taleartVersion")
    val sdkVersionFile = layout.projectDirectory.file("libs/mobile-sdk/src/commonMain/kotlin/site/lempert/taleart/sdk/TaleartSdk.kt")
    val webPackageFile = layout.projectDirectory.file("libs/web-sdk/package.json")
    val swiftPackageFile = layout.projectDirectory.file("Package.swift")
    inputs.property("taleartVersion", expected)
    inputs.files(sdkVersionFile, webPackageFile, swiftPackageFile)
    doLast {
        val version = expected.get()
        val problems = mutableListOf<String>()
        val sdkVersion = Regex("""const val VERSION = "([^"]+)"""").find(sdkVersionFile.asFile.readText())?.groupValues?.get(1)
        if (sdkVersion != version) problems += "TaleartSdk.VERSION is '$sdkVersion' (libs/mobile-sdk), gradle.properties taleartVersion is '$version'"
        val webVersion = (groovy.json.JsonSlurper().parseText(webPackageFile.asFile.readText()) as Map<*, *>)["version"]
        if (webVersion != version) problems += "libs/web-sdk/package.json version is '$webVersion', gradle.properties taleartVersion is '$version'"
        if (!swiftPackageFile.asFile.readText().contains("/releases/download/v$version/TaleartSDK.xcframework.zip")) {
            problems += "Package.swift's binaryTarget url does not point at release v$version"
        }
        if (problems.isNotEmpty()) throw GradleException("Versions differ:\n  " + problems.joinToString("\n  "))
    }
}

subprojects {
    if (name == "mobile-sdk" || name == "android-sdk") {
        tasks.matching { it.name == "check" || it.name.startsWith("publish") }.configureEach {
            dependsOn(rootProject.tasks.named("verifyTaleartVersions"))
        }
    }
}
