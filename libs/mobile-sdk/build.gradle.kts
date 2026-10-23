import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Shared TaleArt SDK: client, models and the Compose Multiplatform UI.
plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidMultiplatformLibrary)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.kotlinSerialization)
}

kotlin {
    android {
        namespace = "site.lempert.taleart.sdk"
        compileSdk = libs.versions.android.compileSdk.get().toInt()
        minSdk = libs.versions.android.minSdk.get().toInt()

        compilerOptions {
            jvmTarget = JvmTarget.JVM_11
        }
        withHostTest {
            isIncludeAndroidResources = true
        }
    }
    iosArm64()
    iosSimulatorArm64()

    sourceSets {
        commonMain.dependencies {
            // The zone's displays (story 9.3): shared Compose UI, cover images through Coil over Ktor.
            api(libs.compose.runtime)
            api(libs.compose.foundation)
            api(libs.compose.ui)
            implementation(libs.coil.compose)
            implementation(libs.coil.network.ktor3)
            // The Delivery client: hosts get the client, its results and the models.
            api(libs.ktor.client.core)
            api(libs.kotlinx.coroutines.core)
            api(libs.kotlinx.serialization.json)
        }
        androidMain.dependencies {
            implementation(libs.ktor.client.okhttp)
        }
        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
            implementation(libs.ktor.client.mock)
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.compose.uiTest)
        }
        getByName("androidHostTest").dependencies {
            implementation(libs.robolectric)
            implementation(libs.androidx.compose.uiTestManifest)
        }
    }
}

kotlin.compilerOptions {
    freeCompilerArgs.add("-Xexpect-actual-classes")
}

tasks.withType<Test>().configureEach {
    // Robolectric (Compose UI tests on the Android host) reaches into JDK internals on JDK 17+.
    jvmArgs("--add-exports=java.base/jdk.internal.access=ALL-UNNAMED", "--add-opens=java.base/java.io=ALL-UNNAMED")
    // ContractModelsTest reads the contract's OpenAPI spec: a change to it reruns the host tests.
    inputs.file(layout.projectDirectory.file("../contract/openapi/openapi.yaml"))
        .withPropertyName("deliveryContract")
        .withPathSensitivity(PathSensitivity.RELATIVE)
}
