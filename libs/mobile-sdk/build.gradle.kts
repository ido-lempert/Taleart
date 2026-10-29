import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Shared TaleArt SDK: client, models and the Compose Multiplatform UI.
plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidMultiplatformLibrary)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.kotlinSerialization)
    alias(libs.plugins.mavenPublish)
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
            // The tale viewer (story 9.4) waits while the app is in the background.
            implementation(libs.androidx.lifecycle.runtimeCompose)
            // The Delivery client: hosts get the client, its results and the models.
            api(libs.ktor.client.core)
            api(libs.kotlinx.coroutines.core)
            api(libs.kotlinx.serialization.json)
        }
        androidMain.dependencies {
            implementation(libs.ktor.client.okhttp)
            // The tale viewer's video (story 9.4), and its full-screen dialog's system bars.
            implementation(libs.media3.exoplayer)
            implementation(libs.media3.ui)
            implementation(libs.androidx.core.ktx)
            // The analytics queue is sent when the process goes to the background (ProcessLifecycleOwner).
            implementation(libs.androidx.lifecycle.process)
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

// Maven Central (group site.lempert.taleart). Local builds and tests need neither credentials nor a key:
// the Central Portal upload reads mavenCentralUsername and mavenCentralPassword (in CI, the
// ORG_GRADLE_PROJECT_ variables), and signing runs only when signingInMemoryKey is set.
group = "site.lempert.taleart"
version = providers.gradleProperty("taleartVersion").get()

mavenPublishing {
    publishToMavenCentral()
    if (providers.gradleProperty("signingInMemoryKey").isPresent) signAllPublications()
    pom {
        name.set("TaleArt Mobile SDK")
        description.set("The shared TaleArt SDK for Kotlin Multiplatform: the Delivery client and the Compose UI that shows a zone's tales, for Android and iOS.")
        url.set("https://github.com/ido-lempert/Taleart")
        licenses {
            license {
                name.set("The Apache License, Version 2.0")
                url.set("https://www.apache.org/licenses/LICENSE-2.0.txt")
                distribution.set("repo")
            }
        }
        developers {
            developer {
                id.set("ido-lempert")
                name.set("Ido Lempert")
                url.set("https://github.com/ido-lempert")
            }
        }
        scm {
            url.set("https://github.com/ido-lempert/Taleart")
            connection.set("scm:git:git://github.com/ido-lempert/Taleart.git")
            developerConnection.set("scm:git:ssh://git@github.com/ido-lempert/Taleart.git")
        }
    }
}
