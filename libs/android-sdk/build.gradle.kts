plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "com.taleart.sdk.android"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    defaultConfig {
        minSdk = libs.versions.android.minSdk.get().toInt()
    }
}

dependencies {
    api(project(":mobile-sdk"))
}
