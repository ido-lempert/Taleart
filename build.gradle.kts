plugins {
    id("dev.nx.gradle.project-graph") version("0.1.25")
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.compose.compiler) apply false
    alias(libs.plugins.compose.multiplatform) apply false
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.android.kotlin.multiplatform.library) apply false
}

allprojects {
    apply {
        plugin("dev.nx.gradle.project-graph")
    }
}