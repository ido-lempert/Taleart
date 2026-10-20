import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework

plugins {
    alias(libs.plugins.kotlin.multiplatform)
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
        }
    }
}
