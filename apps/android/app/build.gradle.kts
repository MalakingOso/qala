plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.qala.app"
    // Compose 1.12.1 (BOM 2026.09.00) needs compileSdk 37.
    compileSdk {
        version = release(37)
    }
    buildToolsVersion = "36.1.0"

    defaultConfig {
        applicationId = "com.qala.app"
        minSdk = 34
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        ndk {
            // One phone, arm64 only. Compose ships a small native library, so an x86_64 emulator needs
            // ./gradlew assembleDebug -Pqala.abi=x86_64
            abiFilters += providers.gradleProperty("qala.abi").getOrElse("arm64-v8a")
        }
    }

    buildFeatures {
        compose = true
    }

    lint {
        // Both are decisions, not oversights: one phone on Android 16 (targetSdk 36 until Nothing OS 5.0 is
        // tested, docs/android-native.md section 2), and arm64-v8a only.
        disable += setOf("OldTargetApi", "ChromeOsAbiSupport")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

dependencies {
    implementation(project(":design"))
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.compose.ui:ui")

    testImplementation("junit:junit:4.13.2")
}
