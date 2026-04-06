plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

val enableDebugImages = true
val configuredCompileSdk = (rootProject.extra.properties["compileSdkVersion"] as? String)?.toIntOrNull()
    ?: 35
val configuredMinSdk = (rootProject.extra.properties["minSdkVersion"] as? String)?.toIntOrNull()
    ?: 26
val configuredNdkVersion = rootProject.extra.properties["ndkVersion"] as? String
    ?: "27.1.12297006"

android {
    namespace = "com.zheng.bulltrack.shared"
    compileSdk = configuredCompileSdk
    ndkVersion = configuredNdkVersion

    defaultConfig {
        minSdk = configuredMinSdk
        buildConfigField("boolean", "ENABLE_DEBUG_IMAGES", enableDebugImages.toString())

        externalNativeBuild {
            cmake {
                cppFlags += "-std=c++17"
                arguments += listOf(
                    "-DANDROID_STL=c++_shared",
                    "-DANDROID_TOOLCHAIN=clang",
                    "-DBT_ENABLE_DEBUG_IMAGES=${if (enableDebugImages) "ON" else "OFF"}"
                )
            }
        }

        ndk {
            abiFilters += listOf("armeabi-v7a", "arm64-v8a", "x86", "x86_64")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            consumerProguardFiles("consumer-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    buildFeatures {
        buildConfig = true
    }

    externalNativeBuild {
        cmake {
            path = file("../app/src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    sourceSets {
        getByName("main") {
            java.srcDirs(
                "../app/src/main/java/com/zheng/bulltrack/application",
                "../app/src/main/java/com/zheng/bulltrack/camera",
                "../app/src/main/java/com/zheng/bulltrack/debug",
                "../app/src/main/java/com/zheng/bulltrack/domain",
                "../app/src/main/java/com/zheng/bulltrack/vision",
            )
            assets.srcDirs("../app/src/main/assets")
            manifest.srcFile("src/main/AndroidManifest.xml")
            res.srcDirs("src/main/res")
            jniLibs.srcDirs("../app/src/main/jniLibs")
        }
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.6.1")
    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")
}
