package com.fretlark.app

import android.annotation.SuppressLint
import android.content.Context
import android.util.Base64
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import org.json.JSONObject

/**
 * Reads a song file's title, artist, track and bar counts and tempo, the details the server stores
 * with an upload. It uses the same score reader as the website (alphaTab, packed in the APK), run in
 * a hidden web view, so the app and the site always agree on what a file contains.
 */
class ScoreReader(private val context: Context, private val site: AppAssets) {
    private var web: WebView? = null
    private var ready: CompletableDeferred<Unit>? = null
    private var readerHtml = ""

    @SuppressLint("SetJavaScriptEnabled")
    private suspend fun page(): WebView {
        web?.let { view ->
            try { withTimeout(15_000) { ready?.await() }; return view }
            catch (e: Exception) { destroy(); throw IllegalStateException("This file could not be read as a song.") }
        }
        val loaded = CompletableDeferred<Unit>()
        ready = loaded
        val view = WebView(context)
        view.settings.javaScriptEnabled = true
        view.settings.allowFileAccess = false
        view.webViewClient = object : WebViewClient() {
            // The reader page lives on a made-up origin, so a hostile file can never reach the
            // account's cookies or the site's API. Only the score library itself is served to it.
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url
                if (url.host == READER_HOST && (url.path ?: "/") == "/") {
                    return WebResourceResponse("text/html", "utf-8", java.io.ByteArrayInputStream(readerHtml.toByteArray()))
                }
                if (url.host == READER_HOST && url.path == "/editor/vendor/alphaTab.js") {
                    return try {
                        WebResourceResponse("text/javascript", "utf-8", context.assets.open("editor/vendor/alphaTab.js"))
                    } catch (_: java.io.IOException) { null }
                }
                return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)))
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            override fun onPageFinished(view: WebView, url: String?) { loaded.complete(Unit) }
        }
        readerHtml = """<!doctype html><meta charset="utf-8"><script src="/editor/vendor/alphaTab.js"></script>
            <script>
            window.readScore = function (b64, name) {
              try {
                var raw = atob(b64), bytes = new Uint8Array(raw.length);
                for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
                var settings = new alphaTab.Settings();
                var score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
                if (!score.tracks.length || !score.masterBars.length) return JSON.stringify({error: name + ' contains no playable tabs.'});
                return JSON.stringify({title: score.title || name.replace(/\.[^.]+$/, ''), artist: score.artist || '',
                  track_count: score.tracks.length, bar_count: score.masterBars.length, tempo: score.tempo});
              } catch (e) { return JSON.stringify({error: 'This file could not be read as a song.'}); }
            };
            </script>"""
        view.loadUrl("https://$READER_HOST/")
        web = view
        try { withTimeout(15_000) { loaded.await() } } catch (e: Exception) { destroy(); throw IllegalStateException("This file could not be read as a song.") }
        return view
    }

    /** Returns the metadata, or throws with a message for people. */
    suspend fun read(bytes: ByteArray, name: String): JSONObject {
        val view = page()
        val result = CompletableDeferred<String>()
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        view.evaluateJavascript("readScore('$b64', ${JSONObject.quote(name)})") { result.complete(it ?: "null") }
        val text = withTimeout(30_000) { result.await() }
        // evaluateJavascript hands back a JSON-encoded string.
        val json = JSONObject(org.json.JSONTokener(text).nextValue() as? String ?: throw IllegalStateException("This file could not be read as a song."))
        json.optString("error").takeIf { it.isNotEmpty() }?.let { throw IllegalStateException(it) }
        return json
    }

    fun destroy() { web?.destroy(); web = null; ready = null }

    private companion object { const val READER_HOST = "reader.fretlark.invalid" }
}
