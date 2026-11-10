plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose.compiler)
    alias(libs.plugins.ksp)
}

android {
    namespace = "dev.agenthive.watch"
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

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    buildFeatures {
        compose = true
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

dependencies {
    implementation(libs.core.ktx)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.wear.compose.material3)
    implementation(libs.wear.compose.foundation)
    implementation(libs.wear)
    implementation(libs.okhttp)
    implementation("net.java.dev.jna:jna:5.17.0@aar")
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.wear.tiles)
    implementation(libs.protolayout.material)
    implementation(libs.concurrent.futures)
    implementation(libs.health.services)
    implementation(libs.watchface.complications.datasource)
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation(libs.play.services.wearable)
    implementation(libs.appfunctions)
    ksp(libs.appfunctions.compiler)
}
