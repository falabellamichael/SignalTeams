plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose.compiler)
}

android {
    namespace = "dev.agenthive.phone"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "dev.agenthive.phone"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
    }

    sourceSets["main"].apply {
        // share the watch's mesh client + data layer — Nexus.kt edits apply to
        // both apps. The shared sources live under dev.agenthive.watch.* and are
        // self-contained (JNA + okhttp + org.json only).
        kotlin.srcDir("../app/src/main/kotlin/dev/agenthive/watch/nexus")
        kotlin.srcDir("../app/src/main/kotlin/dev/agenthive/watch/data")
        jniLibs.srcDir("../app/src/main/jniLibs")
        assets.srcDir("../app/src/main/assets")
        // phone's own sources/resources (src/main/kotlin + src/main/res are
        // already conventional defaults for the android sourceSet)
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}

dependencies {
    implementation(libs.core.ktx)
    implementation(libs.activity)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("io.coil-kt:coil-compose:2.6.0")
    implementation("io.getstream:stream-webrtc-android:1.3.8")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.ui:ui")
    implementation(libs.okhttp)
    implementation("net.java.dev.jna:jna:5.17.0@aar")
    implementation(libs.kotlinx.coroutines.android)
}
