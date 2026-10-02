plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.qala.design"
    compileSdk {
        version = release(37)
    }
    buildToolsVersion = "36.1.0"

    defaultConfig {
        minSdk = 34
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

dependencies {
    // Foundation only. No Material 3: it fights the Beamer look (docs/android-native.md section 2).
    api(platform("androidx.compose:compose-bom:2026.09.00"))
    api("androidx.compose.animation:animation-core")
    api("androidx.compose.foundation:foundation")
    api("androidx.compose.runtime:runtime")
    api("androidx.compose.ui:ui")
    api("androidx.compose.ui:ui-graphics")
    api("androidx.compose.ui:ui-unit")

    testImplementation("junit:junit:4.13.2")
}
