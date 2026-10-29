import com.vanniktech.maven.publish.AndroidSingleVariantLibrary
import com.vanniktech.maven.publish.JavadocJar
import com.vanniktech.maven.publish.SourcesJar

plugins {
    alias(libs.plugins.androidLibrary)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.mavenPublish)
}

android {
    namespace = "site.lempert.taleart.sdk.android"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    defaultConfig {
        minSdk = libs.versions.android.minSdk.get().toInt()
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

// Robolectric reaches into JDK internals on JDK 17+.
tasks.withType<Test>().configureEach {
    jvmArgs("--add-exports=java.base/jdk.internal.access=ALL-UNNAMED", "--add-opens=java.base/java.io=ALL-UNNAMED")
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11
    }
}

dependencies {
    // The shared SDK brings the Compose UI (ComposeView) that TaleartView hosts.
    api(project(":mobile-sdk"))

    testImplementation(libs.junit)
    testImplementation(libs.kotlin.test)
    testImplementation(libs.robolectric)
    testImplementation(libs.ktor.client.mock)
    // ComponentActivity, declared in a test manifest, hosts the view with a lifecycle owner.
    testImplementation(libs.androidx.activity.compose)
    testImplementation(libs.androidx.compose.uiTestManifest)
    // The viewer test taps the bar and finds the viewer in its dialog window (story 9.4).
    testImplementation(libs.androidx.compose.uiTestJunit4)
}

// Maven Central (group site.lempert.taleart). Its api(project(":mobile-sdk")) is published as the
// mobile-sdk coordinates. Local builds need no credentials or key (see libs/mobile-sdk/build.gradle.kts).
group = "site.lempert.taleart"
version = providers.gradleProperty("taleartVersion").get()

mavenPublishing {
    // Central requires a javadoc jar; the SDK has no Javadoc, so it is empty (as the mobile-sdk's).
    configure(AndroidSingleVariantLibrary(javadocJar = JavadocJar.Empty(), sourcesJar = SourcesJar.Sources(), variant = "release"))
    publishToMavenCentral()
    if (providers.gradleProperty("signingInMemoryKey").isPresent) signAllPublications()
    pom {
        name.set("TaleArt Android SDK")
        description.set("The TaleArt SDK for Android: the TaleartView that shows a zone's tales in an Android app.")
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
