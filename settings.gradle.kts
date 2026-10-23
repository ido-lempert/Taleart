rootProject.name = "taleart"

pluginManagement {
    repositories {
        google {
            mavenContent {
                includeGroupAndSubgroups("androidx")
                includeGroupAndSubgroups("com.android")
                includeGroupAndSubgroups("com.google")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google {
            mavenContent {
                includeGroupAndSubgroups("androidx")
                includeGroupAndSubgroups("com.android")
                includeGroupAndSubgroups("com.google")
            }
        }
        mavenCentral()
    }
}

// Gradle project name == Nx project name; directories follow the Nx apps/libs layout.
fun includeProject(name: String, dir: String) {
    include(":$name")
    project(":$name").projectDir = file(dir)
}

includeProject("mobile-sdk", "libs/mobile-sdk")
includeProject("android-sdk", "libs/android-sdk")
includeProject("ios-sdk", "libs/ios-sdk")
includeProject("taller", "apps/taller")
includeProject("taller-android", "apps/taller/androidApp")
