plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// The site the app talks to. Self-hosters can build with -PsiteUrl=https://tabs.example.com
val siteUrl = (project.findProperty("siteUrl") as String?)?.trimEnd('/') ?: "https://fretlark.com"
val siteHost = siteUrl.substringAfter("://").substringBefore("/").substringBefore(":")
// A release that talks to its server over plain http would leak sessions: refuse to build one.
gradle.taskGraph.whenReady {
    if (siteUrl.startsWith("http://") && allTasks.any { it.name.contains("Release") }) {
        throw GradleException("Release builds need an https:// siteUrl (got $siteUrl).")
    }
}

// Release signing. Set these four (as environment variables or Gradle properties) to sign with your
// own key. Without them the release build is signed with the debug key, which is fine for
// installing by hand but changes between machines.
fun secret(name: String): String? = (project.findProperty(name) as String?) ?: System.getenv(name)
val keystorePath = secret("FRETLARK_KEYSTORE")

android {
    namespace = "com.fretlark.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.fretlark.app"
        minSdk = 26
        targetSdk = 35
        versionCode = (secret("FRETLARK_VERSION_CODE") ?: "1").toInt()
        versionName = "1.1.0"
        buildConfigField("String", "SITE_URL", "\"$siteUrl\"")
        manifestPlaceholders["siteHost"] = siteHost
        // Plain http is only allowed when the app is built against a local dev server.
        manifestPlaceholders["cleartext"] = siteUrl.startsWith("http://").toString()
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = secret("FRETLARK_KEYSTORE_PASSWORD")
                keyAlias = secret("FRETLARK_KEY_ALIAS")
                keyPassword = secret("FRETLARK_KEY_PASSWORD") ?: secret("FRETLARK_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    // The web app in ../public is packed into the APK and served to the WebView from there.
    sourceSets["main"].assets.srcDirs("src/main/assets", "../../public")

    androidResources {
        // Leave out what the app never loads (marketing pages, email art, type stubs, legacy fonts).
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~:email-assets:downloads:*.apk:*.d.ts:*.eot:*.otf:*.patch:Bravura.svg:sonivox.sf2"
        // Already compressed; storing them as they are lets the WebView read them faster.
        noCompress += listOf("woff2", "woff", "sf3", "webp", "png", "gp")
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    // Frosted-glass blur behind the floating tab bar.
    implementation("dev.chrisbanes.haze:haze:1.1.1")
}
