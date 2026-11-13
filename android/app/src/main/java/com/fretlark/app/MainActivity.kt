package com.fretlark.app

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.print.PrintAttributes
import android.print.PrintManager
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.PathInterpolator
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.activity.OnBackPressedCallback
import androidx.compose.runtime.CompositionLocalProvider
import com.fretlark.app.data.Api
import com.fretlark.app.data.Song
import com.fretlark.app.ui.AppActions
import com.fretlark.app.ui.AppModel
import com.fretlark.app.ui.AppRoot
import com.fretlark.app.ui.FretlarkTheme
import com.fretlark.app.ui.LocalAppActions
import com.fretlark.app.ui.Upload
import kotlinx.coroutines.launch

/**
 * One screen. The library, setlists, account and sign-in are native (Compose, see `ui/`). The song
 * player, the editor and shared setlists are the site's own pages: they open in `detail`, a web
 * view that slides in over the native tabs and slides away again on Back.
 */
class MainActivity : ComponentActivity() {
    private lateinit var site: AppAssets
    private lateinit var exporter: Exporter
    private lateinit var content: FrameLayout
    private lateinit var topBar: View
    private lateinit var bottomBar: View
    private lateinit var home: ComposeView
    private lateinit var detailHolder: FrameLayout
    private lateinit var model: AppModel
    private lateinit var reader: ScoreReader
    private val backFromDetail = object : OnBackPressedCallback(false) { override fun handleOnBackPressed() = handleBack() }
    private var detail: WebView? = null
    private var closing = false

    private var homeReady = false
    private var fullscreen: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var appBackground = Color.WHITE

    private val ease = PathInterpolator(0.2f, 0.8f, 0.2f, 1f)
    private val main = Handler(Looper.getMainLooper())

    private val pickSong = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) uploadSong(uri) }

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        val data = result.data
        val uris = ArrayList<Uri>()
        if (result.resultCode == RESULT_OK && data != null) {
            val clip = data.clipData
            if (clip != null) for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris.add(it) }
            else data.data?.let { uris.add(it) }
        }
        callback.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.isNavigationBarContrastEnforced = false
        splash.setKeepOnScreenCondition { !homeReady }
        main.postDelayed({ homeReady = true }, 2500)

        site = AppAssets(this, BuildConfig.SITE_URL)
        exporter = Exporter(this)
        appBackground = getColor(R.color.app_background)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().setAcceptCookie(true)

        model = ViewModelProvider(this)[AppModel::class.java]
        val prefs = getSharedPreferences("app", MODE_PRIVATE)
        model.appearance = runCatching { com.fretlark.app.ui.Appearance.valueOf(prefs.getString("appearance", null) ?: "System") }.getOrDefault(com.fretlark.app.ui.Appearance.System)
        lifecycleScope.launch {
            androidx.compose.runtime.snapshotFlow { model.appearance }.collect {
                prefs.edit().putString("appearance", it.name).apply()
                applyNightMode(it)
            }
        }
        reader = ScoreReader(this, site)

        // Native tabs fill the window edge to edge and pad themselves for the system bars. The web
        // page in `detailHolder` sits between two strips that take the colour of the page's edges.
        val root = FrameLayout(this)
        root.setBackgroundColor(appBackground)
        home = ComposeView(this).apply {
            setContent {
                val systemDark = androidx.compose.foundation.isSystemInDarkTheme()
                FretlarkTheme(dark = when (model.appearance) { com.fretlark.app.ui.Appearance.Light -> false; com.fretlark.app.ui.Appearance.Dark -> true; else -> systemDark }) {
                    CompositionLocalProvider(LocalAppActions provides actions) { AppRoot(model) }
                }
            }
        }
        content = FrameLayout(this)
        detailHolder = FrameLayout(this)
        topBar = View(this).apply { setBackgroundColor(appBackground); visibility = View.GONE }
        bottomBar = View(this).apply { setBackgroundColor(appBackground); visibility = View.GONE }
        content.addView(home, FrameLayout.LayoutParams(MATCH, MATCH))
        content.addView(detailHolder, FrameLayout.LayoutParams(MATCH, MATCH))
        root.addView(content, FrameLayout.LayoutParams(MATCH, MATCH))
        root.addView(topBar, FrameLayout.LayoutParams(MATCH, 0, android.view.Gravity.TOP))
        root.addView(bottomBar, FrameLayout.LayoutParams(MATCH, 0, android.view.Gravity.BOTTOM))
        setContentView(root)
        homeReady = true

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            val full = fullscreen != null
            (detailHolder.layoutParams as FrameLayout.LayoutParams).apply {
                if (full) setMargins(0, 0, 0, 0)
                else setMargins(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            }.also { detailHolder.layoutParams = it }
            topBar.layoutParams = topBar.layoutParams.apply { height = if (full) 0 else bars.top }
            bottomBar.layoutParams = bottomBar.layoutParams.apply { height = if (full) 0 else bars.bottom }
            insets // Compose reads the same insets for the native screens.
        }

        onBackPressedDispatcher.addCallback(this, backFromDetail)

        val restored = savedInstanceState?.getString(STATE_DETAIL)
        val files = if (savedInstanceState == null) incomingFiles(intent) else emptyList()
        val link = intent?.data?.takeIf { files.isEmpty() }
        if (files.isNotEmpty()) enqueueUploads(files)
        else if (savedInstanceState == null && link != null) openLink(link, animate = false)
        else if (restored != null) openDetail(restored, animate = false)
        // Files shared before sign-in are added as soon as the account is ready.
        lifecycleScope.launch {
            var wasSignedIn = false
            androidx.compose.runtime.snapshotFlow { model.signedIn }.collect { signedIn ->
                if (signedIn) drainUploads()
                // After signing out, leave nothing of the account behind for the next person:
                // editor drafts, local songs and cached pages live in the web views' storage.
                if (wasSignedIn && !signedIn) {
                    android.webkit.WebStorage.getInstance().deleteAllData()
                    WebView(this@MainActivity).apply { clearCache(true); destroy() }
                }
                wasSignedIn = signedIn
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Pick up changes made on the website or in another app session.
        if (detail == null && this::model.isInitialized && model.signedIn) model.refresh()
    }

    // ---------- what native screens can ask for ----------

    private val actions = object : AppActions {
        override fun openPlayer(song: Song) = openDetail(Api.playerUrl(song.id), animate = true)
        override fun openEditor(song: Song) = openDetail(Api.editorUrl(song.id), animate = true)
        override fun openVideo(song: Song) = openDetail(Api.videoUrl(song.id), animate = true)
        override fun newSong() = openDetail(Api.newSongUrl(), animate = true)
        override fun importSong() {
            try { pickSong.launch(arrayOf("*/*")) } catch (_: Exception) { toast(getString(R.string.no_app_for_link)) }
        }
        override fun openSharedSetlist(url: String) = openDetail(url, animate = true)
        override fun openWebPage(url: String) = openDetail(url, animate = true)
        override fun openOutside(url: String) = this@MainActivity.openOutside(Uri.parse(url))
        override fun copy(text: String, label: String) {
            val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
            // Android 13+ shows its own confirmation.
            if (Build.VERSION.SDK_INT < 33) toast("$label copied")
        }
        override fun share(text: String, title: String?) {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
            title?.let { send.putExtra(Intent.EXTRA_SUBJECT, it) }
            startActivity(Intent.createChooser(send, null))
        }
        override fun toast(message: String) = Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show()
        override fun haptic() { home.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP) }
    }

    // ---------- adding songs: the picker, "Open with" and the share sheet ----------

    private val uploadQueue = ArrayDeque<Uri>()
    private var uploading = false

    private fun uploadSong(uri: Uri) = enqueueUploads(listOf(uri))

    /** Files waiting for sign-in are kept until the account is ready, then added in order. */
    private fun enqueueUploads(uris: List<Uri>) {
        uploadQueue.addAll(uris)
        if (detail != null) closeDetail()
        if (!model.signedIn) {
            if (model.sessionChecked) actions.toast(if (uris.size == 1) "Sign in to add this song" else "Sign in to add these songs")
            return
        }
        drainUploads()
    }

    private fun drainUploads() {
        if (uploading || uploadQueue.isEmpty() || !model.signedIn) return
        uploading = true
        lifecycleScope.launch {
            var last: Upload? = null
            while (uploadQueue.isNotEmpty()) {
                val uri = uploadQueue.removeFirst()
                last = uploadOne(uri, left = uploadQueue.size)
            }
            uploading = false
            model.refresh()
            // The pill stays a moment so the result can be seen (and tapped), then slides away.
            kotlinx.coroutines.delay(if (last?.phase == Upload.Phase.Failed) 5000 else 3500)
            if (model.upload == last) model.upload = null
        }
    }

    /** Reads one file, works out its details the way the website does, and uploads it. */
    private suspend fun uploadOne(uri: Uri, left: Int): Upload {
        var name = "song.gp"
        return try {
            name = runCatching {
                contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                    if (it.moveToFirst()) it.getString(0) else null
                }
            }.getOrNull() ?: uri.lastPathSegment?.substringAfterLast('/') ?: name
            model.upload = Upload(name, Upload.Phase.Reading, left = left)
            if (Regex("\\.(mid|midi)$", RegexOption.IGNORE_CASE).containsMatchIn(name))
                throw IllegalStateException("MIDI files are converted in the editor. Open the editor and use Import.")
            if (!Regex("\\.(gp|gp3|gp4|gp5|gp6|gp7|gp8|gpx|xml|musicxml|mxl|atex)$", RegexOption.IGNORE_CASE).containsMatchIn(name))
                throw IllegalStateException("Fretlark opens GP, MusicXML and alphaTex files.")
            val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                contentResolver.openInputStream(uri)?.use { input ->
                    val out = java.io.ByteArrayOutputStream(64 * 1024)
                    val buf = ByteArray(64 * 1024)
                    var total = 0
                    while (true) {
                        val n = input.read(buf); if (n < 0) break
                        total += n
                        if (total > 30 * 1024 * 1024) throw IllegalStateException("Use a file smaller than 30 MB.")
                        out.write(buf, 0, n)
                    }
                    out.toByteArray()
                } ?: throw IllegalStateException("The file could not be opened.")
            }
            val meta = reader.read(bytes, name)
            model.upload = Upload(name, Upload.Phase.Uploading, left = left)
            val song = Api.uploadSong(bytes, name, meta)
            model.addSong(song)
            Upload(name, Upload.Phase.Done, song = song, left = left).also { model.upload = it }
        } catch (e: Exception) {
            Upload(name, Upload.Phase.Failed, error = e.message ?: getString(R.string.save_failed), left = left).also { model.upload = it }
        }
    }

    /** Files handed over by another app, from "Open with" or the share sheet. Returns true if there were any. */
    private fun incomingFiles(intent: Intent?): List<Uri> {
        intent ?: return emptyList()
        @Suppress("DEPRECATION")
        return when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(
                if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra(Intent.EXTRA_STREAM),
            )
            Intent.ACTION_SEND_MULTIPLE ->
                (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)).orEmpty()
            Intent.ACTION_VIEW -> listOfNotNull(intent.data?.takeIf { it.scheme == "content" })
            else -> emptyList()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val files = incomingFiles(intent)
        if (files.isNotEmpty()) enqueueUploads(files) else intent.data?.let { openLink(it, animate = true) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        detail?.url?.takeIf { site.isSite(Uri.parse(it)) }?.let { outState.putString(STATE_DETAIL, it) }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        leaveFullscreen(notifyPage = false)
        exporter.close()
        main.removeCallbacksAndMessages(null)
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        detail?.let { detailHolder.removeView(it); it.destroy() }
        detail = null
        reader.destroy()
        super.onDestroy()
    }

    // ---------- web views ----------

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        val web = WebView(this)
        web.setBackgroundColor(appBackground)
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString FretlarkAndroid/${BuildConfig.VERSION_NAME}"
        }
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.setDownloadListener { url, _, disposition, mime, _ -> download(url, disposition, mime) }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            // Only pages from the site itself get the bridge; a frame from anywhere else cannot see it.
            WebViewCompat.addWebMessageListener(web, "FretlarkApp", setOf(site.origin)) { view, message, _, isMainFrame, _ ->
                val text = message.data ?: return@addWebMessageListener
                try {
                    onBridge(view, JSONObject(text), isMainFrame)
                } catch (_: Exception) {
                }
            }
        }
        return web
    }

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            site.intercept(request)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            return route(view, request.url)
        }

        override fun onPageCommitVisible(view: WebView, url: String?) {
            homeReady = true
        }

        override fun onRenderProcessGone(view: WebView, gone: RenderProcessGoneDetail?): Boolean {
            // The page's renderer died (memory pressure or a graphics fault, often while leaving
            // fullscreen). Reload just that page instead of restarting the whole app.
            main.post { recoverPage(view) }
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val pick = Intent(Intent.ACTION_GET_CONTENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*")
                .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
            return try {
                pickFiles.launch(Intent.createChooser(pick, getString(R.string.choose_files)))
                true
            } catch (_: Exception) {
                fileCallback = null
                false
            }
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (fullscreen != null) {
                callback.onCustomViewHidden()
                return
            }
            fullscreen = view
            fullscreenCallback = callback
            // Inside the app's own layout (above the page and the bar strips), not on the window's
            // decor view: tearing a video/canvas surface off the decor view crashes some GPUs.
            (content.parent as ViewGroup).addView(view, ViewGroup.LayoutParams(MATCH, MATCH))
            view.setBackgroundColor(Color.BLACK)
            WindowInsetsControllerCompat(window, window.decorView).apply {
                systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                hide(WindowInsetsCompat.Type.systemBars())
            }
            ViewCompat.requestApplyInsets(content.rootView)
        }

        override fun onHideCustomView() = leaveFullscreen(notifyPage = true)
    }

    // ---------- navigation ----------

    private fun isDetailPath(path: String) = detailPath.matches(path)

    /** Decides where a link in the detail page goes. Returns true when the web view should not follow it. */
    private fun route(from: WebView, uri: Uri): Boolean {
        if (!site.isSite(uri)) {
            if (uri.scheme == "blob" || uri.scheme == "data" || uri.scheme == "about") return false
            openOutside(uri)
            return true
        }
        val path = uri.path ?: "/"
        if (isDetailPath(path)) {
            val player = site.playerUrl(uri) ?: return false
            from.loadUrl(player)
            return true
        }
        // The page is heading back to the dashboard: that is the native app now.
        if (path == "/" || path.startsWith("/admin")) {
            if (uri.fragment == "account" || uri.query?.contains("account") == true) return false
            closeDetail()
            return true
        }
        return false
    }

    private fun openLink(uri: Uri, animate: Boolean) {
        if (!site.isSite(uri)) return
        val path = uri.path ?: "/"
        if (isDetailPath(path)) openDetail(uri.toString(), animate)
    }

    private fun openOutside(uri: Uri) {
        // Only ordinary links leave the app; anything else a page tries to launch is ignored.
        if (uri.scheme?.lowercase() !in setOf("https", "http", "mailto", "tel")) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
        }
    }

    private fun openDetail(rawUrl: String, animate: Boolean) {
        val url = site.playerUrl(Uri.parse(rawUrl)) ?: rawUrl
        val existing = detail
        if (existing != null && !closing) {
            existing.loadUrl(url)
            return
        }
        val web = createWebView()
        detail = web
        closing = false
        detailHolder.addView(web, FrameLayout.LayoutParams(MATCH, MATCH))
        topBar.visibility = View.VISIBLE
        bottomBar.visibility = View.VISIBLE
        // Re-adding puts this callback above the native screens' own Back handlers.
        backFromDetail.remove()
        onBackPressedDispatcher.addCallback(this, backFromDetail)
        backFromDetail.isEnabled = true
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web.loadUrl(url)
        val width = content.width.toFloat()
        if (!animate || width <= 0f) {
            home.visibility = View.INVISIBLE
            return
        }
        web.translationX = width
        web.animate().translationX(0f).setDuration(SLIDE_MS).setInterpolator(ease).withLayer().start()
        home.animate().translationX(-width * 0.24f).setDuration(SLIDE_MS).setInterpolator(ease).withLayer().withEndAction {
            if (detail === web && !closing) home.visibility = View.INVISIBLE
        }.start()
    }

    /** Takes the fullscreen view down and brings the system bars back. Safe to call any time. */
    private fun leaveFullscreen(notifyPage: Boolean) {
        val view = fullscreen ?: return
        fullscreen = null
        val callback = fullscreenCallback
        fullscreenCallback = null
        (view.parent as? ViewGroup)?.removeView(view)
        if (notifyPage) try { callback?.onCustomViewHidden() } catch (_: Exception) {}
        WindowInsetsControllerCompat(window, window.decorView).show(WindowInsetsCompat.Type.systemBars())
        ViewCompat.requestApplyInsets(content.rootView)
    }

    /** A page whose renderer died: drop it and open the same address again in a fresh web view. */
    private fun recoverPage(view: WebView) {
        leaveFullscreen(notifyPage = false)
        val url = view.url?.takeIf { site.isSite(Uri.parse(it)) }
        (view.parent as? ViewGroup)?.removeView(view)
        runCatching { view.destroy() }
        if (view !== detail) return
        detail = null
        closing = false
        if (url != null) {
            openDetail(url, animate = false)
        } else {
            home.translationX = 0f
            home.visibility = View.VISIBLE
            backFromDetail.isEnabled = false
            topBar.visibility = View.GONE
            bottomBar.visibility = View.GONE
            resetBars()
        }
    }

    private fun closeDetail() {
        val web = detail ?: return
        if (closing) return
        leaveFullscreen(notifyPage = true)
        closing = true
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        home.animate().cancel()
        home.visibility = View.VISIBLE
        // Let the dashboard pick up anything saved in the editor and repaint the bars for itself.
        backFromDetail.isEnabled = false
        resetBars()
        // Pick up anything saved in the editor.
        model.refresh()
        val width = content.width.toFloat()
        val finish = Runnable {
            detailHolder.removeView(web)
            topBar.visibility = View.GONE
            bottomBar.visibility = View.GONE
            web.stopLoading()
            web.loadUrl("about:blank")
            web.destroy()
            if (detail === web) detail = null
            closing = false
        }
        if (width <= 0f) {
            home.translationX = 0f
            finish.run()
            return
        }
        if (home.translationX == 0f) home.translationX = -width * 0.24f
        home.animate().translationX(0f).setDuration(SLIDE_MS).setInterpolator(ease).withLayer().start()
        web.animate().translationX(width).setDuration(SLIDE_MS).setInterpolator(ease).withLayer().withEndAction(finish).start()
    }

    private fun handleBack() {
        val web = detail
        if (fullscreen != null) {
            leaveFullscreen(notifyPage = true)
            return
        }
        if (web == null || closing) return
        // The page gets the first say: it closes an open sheet, menu or song before the app moves on.
        web.evaluateJavascript("(function(){try{return !!(window.FretlarkShell&&window.FretlarkShell.back())}catch(e){return false}})()") { handled ->
            if (handled == "true" || detail !== web) return@evaluateJavascript
            if (web.canGoBack()) web.goBack() else closeDetail()
        }
    }

    /**
     * Tells Android which theme the app uses, so the player and editor pages (whose CSS follows
     * prefers-color-scheme) match the app's Appearance setting instead of the phone's.
     */
    private fun applyNightMode(appearance: com.fretlark.app.ui.Appearance) {
        if (Build.VERSION.SDK_INT < 31) return
        val ui = getSystemService(android.app.UiModeManager::class.java) ?: return
        val mode = when (appearance) {
            com.fretlark.app.ui.Appearance.Light -> android.app.UiModeManager.MODE_NIGHT_NO
            com.fretlark.app.ui.Appearance.Dark -> android.app.UiModeManager.MODE_NIGHT_YES
            else -> android.app.UiModeManager.MODE_NIGHT_AUTO
        }
        runCatching { ui.setApplicationNightMode(mode) }
    }

    private fun resetBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            val dark = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    // ---------- bridge: what pages may ask the app to do ----------

    private fun onBridge(view: WebView, msg: JSONObject, isMainFrame: Boolean) {
        val type = msg.optString("t")
        // Embedded frames (songs inside a shared setlist) may only ask for harmless things.
        if (!isMainFrame && type !in setOf("haptic", "copy", "share")) return
        if (view !== detail && type != "ready") return
        when (type) {
            "ready" -> homeReady = true
            "chrome" -> if (isMainFrame && view === detail && !closing) {
                paintBars(msg.optString("top"), msg.optString("bottom"))
            }
            "open" -> {
                val uri = Uri.parse(msg.optString("url"))
                if (!route(view, uri) && site.isSite(uri)) view.loadUrl(uri.toString())
            }
            "close" -> if (view === detail) closeDetail()
            "signed-out" -> { closeDetail(); model.checkSession() }
            "copy" -> {
                val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("Fretlark", msg.optString("text")))
            }
            "share" -> {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, msg.optString("text"))
                msg.optString("title").takeIf { it.isNotEmpty() }?.let { send.putExtra(Intent.EXTRA_SUBJECT, it) }
                startActivity(Intent.createChooser(send, null))
            }
            "print" -> {
                val name = getString(R.string.print_job, msg.optString("title").ifEmpty { getString(R.string.app_name) })
                val manager = getSystemService(PRINT_SERVICE) as PrintManager
                manager.print(name, view.createPrintDocumentAdapter(name), PrintAttributes.Builder().build())
            }
            "haptic" -> view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            "save-begin" -> exporter.begin(msg.getString("id"), msg.optString("name"), msg.optString("mime"))
            "save-chunk" -> exporter.chunk(msg.getString("id"), msg.getString("data"))
            "save-end" -> exporter.end(msg.getString("id"))
            "save-abort" -> exporter.abort(msg.getString("id"))
        }
    }

    private fun paintBars(top: String, bottom: String) {
        val topColor = parseColor(top) ?: return
        val bottomColor = parseColor(bottom) ?: topColor
        topBar.setBackgroundColor(topColor)
        bottomBar.setBackgroundColor(bottomColor)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !isDark(topColor)
            isAppearanceLightNavigationBars = !isDark(bottomColor)
        }
    }

    private fun parseColor(value: String): Int? = try {
        if (value.matches(Regex("^#[0-9a-fA-F]{6}$"))) Color.parseColor(value) else null
    } catch (_: Exception) {
        null
    }

    private fun isDark(color: Int): Boolean =
        (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) < 140

    /** Plain links to files on the site (not the in-memory ones the page builds itself). */
    private fun download(url: String, disposition: String?, mime: String?) {
        val uri = Uri.parse(url)
        if (uri.scheme != "https") return
        try {
            val request = DownloadManager.Request(uri)
            if (site.isSite(uri)) CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
            request.setMimeType(mime)
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, disposition, mime))
            (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
        } catch (_: Exception) {
            Toast.makeText(this, R.string.save_failed, Toast.LENGTH_LONG).show()
        }
    }

    private companion object {
        const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        const val SLIDE_MS = 340L
        const val STATE_DETAIL = "detail"
        val detailPath = Regex("^/(editor(/.*)?|(view|embed|set)/[^/]+/?)$")
    }
}
