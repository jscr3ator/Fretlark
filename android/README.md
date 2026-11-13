# Fretlark for Android

The Android app: the library, setlists, account settings, the editor and the player, in one app with a floating tab bar.

## How it works

- **Native screens** (Kotlin + Jetpack Compose, `app/src/main/java/com/fretlark/app/ui/`): sign-in, Home, Songs, Setlists and Settings. They talk to the same API as the website (`data/Api.kt`).
  - A floating tab bar. Tap a tab, swipe between pages, or drag along the bar: the selection follows your finger and the pages scrub with it, then it snaps to the nearest tab. It hides while you scroll down a list and comes back on the way up.
  - Songs: search, All / Shared / Private filters, and a sheet per song to play, edit, share, rename or delete it.
  - Setlists: create, rename, write notes, share as one link, add songs, and drag the handle to reorder.
  - Upload reads the file with the same score reader as the website (alphaTab, run in a hidden web view), so title, artist, tracks and tempo are right.
  - Light and dark follow the system.
- **Web pages** for what is drawn as sheet music: the player, the editor and shared setlists. The pages in `../public` are packed into the APK and served under their real address (`AppAssets.kt`), so they open instantly and share the native sign-in (one cookie jar). They slide in over the tabs and slide away on Back.
  - `app-shell/app.js` and `app.css` are injected into those pages: a back button, saving exports to `Downloads/Fretlark`, printing, the share sheet, and system bars that match the page.
  - Account security (password, two-factor, recovery key, email, deleting the account) opens the website's account sheet on its own.
- Shared links (`fretlark.com/view/...` and `/set/...`) can open in the app.

Not included: an offline library. Songs need a connection.

## Build

You need JDK 17 and the Android SDK (Android Studio installs both). Then:

```bash
cd android
```

```bash
./gradlew assembleRelease
```

The APK is in `app/build/outputs/apk/release/`. Or open the `android` folder in Android Studio and press Run.

To point the app at your own server (self-hosting), add `-PsiteUrl=https://tabs.example.com`. The server must use HTTPS.

### Signing

Without a key, the release build is signed with the debug key. That is fine for installing by hand, but the key differs between machines, so an update from another machine needs the old app uninstalled first.

To sign with your own key, set these as environment variables or Gradle properties: `FRETLARK_KEYSTORE` (path to the `.jks` file), `FRETLARK_KEYSTORE_PASSWORD`, `FRETLARK_KEY_ALIAS`, `FRETLARK_KEY_PASSWORD`.

## GitHub builds

`.github/workflows/android.yml` builds the APK when the app changes, or by hand (Actions → Android app → Run workflow). Download the `fretlark-android` artifact from the run, unzip it and install the `.apk`.

- For a stable signature, add the secrets `ANDROID_KEYSTORE_BASE64` (the `.jks` file, base64-encoded), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`.
- Push an `android-vX.Y.Z` tag to also attach the APK to a draft release in the public repo (needs `RELEASE_TOKEN`, as for the desktop app).

## Run it against a local server

```bash
npm run dev
```

```bash
adb reverse tcp:8787 tcp:8787
```

```bash
./gradlew installDebug -PsiteUrl=http://localhost:8787
```

Plain http is only allowed in builds pointed at an http address.

## Work on the injected web layer without a phone

```bash
npm run dev
```

```bash
node android/tools/preview.mjs
```

Open `http://127.0.0.1:8790/admin` with the browser's phone emulation on. It serves the site with the same script and stylesheet the app injects. Native-only actions (saving files, the share sheet, the sliding second screen) fall back to the web there.

`node verify-android-shell.cjs` (part of `npm test`) checks that the website still has every control the phone layer relies on.
