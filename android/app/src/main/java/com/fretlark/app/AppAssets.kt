package com.fretlark.app

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.IOException

/**
 * Serves the bundled web app to the WebView.
 *
 * Pages keep their real address (https://fretlark.com/...), so the sign-in cookie, saved songs and
 * API calls behave exactly as they do in a browser. Only the static files are answered from the
 * APK, which makes every screen open instantly. Anything not bundled (the API, cover art) goes to
 * the network untouched.
 */
class AppAssets(private val context: Context, site: String) {
    private val siteUri: Uri = Uri.parse(site)
    val host: String = siteUri.host ?: "fretlark.com"
    val origin: String = "${siteUri.scheme}://${siteUri.authority}"

    private val token = Regex("^/(view|embed|set)/[a-f0-9]{64}/?$")

    fun isSite(uri: Uri): Boolean = uri.scheme == siteUri.scheme && uri.authority == siteUri.authority

    /** The address the app loads for a shared song link: the player itself, without the web wrapper. */
    fun playerUrl(uri: Uri): String? {
        val match = token.find(uri.path ?: return null) ?: return null
        val kind = match.groupValues[1]
        if (kind == "set") return null
        val id = uri.pathSegments[1]
        return "$origin/editor/player.html?share=$id" + if (kind == "embed") "&embed=1" else ""
    }

    fun intercept(request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url
        if (!request.method.equals("GET", ignoreCase = true) || !isSite(uri)) return null
        val path = uri.path ?: "/"
        if (path.startsWith("/api/") || path.contains("..")) return null
        val file = when (path) {
            "/" -> return html("<!doctype html><meta charset=\"utf-8\"><script>location.replace('/admin')</script>")
            "/admin", "/admin/" -> "admin.html"
            "/editor", "/editor/", "/editor/index.html" -> "editor/index.html"
            "/setup", "/setup/" -> "setup.html"
            "/privacy", "/privacy/" -> "privacy.html"
            "/terms", "/terms/" -> "terms.html"
            else -> when {
                token.matches(path) && path.startsWith("/set/") -> "set.html"
                token.matches(path) -> return html(
                    "<!doctype html><meta charset=\"utf-8\"><script>location.replace(" +
                        "'/editor/player.html?share=${uri.pathSegments[1]}${if (path.startsWith("/embed/")) "&embed=1" else ""}')</script>"
                )
                else -> path.trimStart('/')
            }
        }
        if (file.isEmpty() || file.startsWith("app-shell/") && !file.matches(Regex("^app-shell/[a-z-]+\\.(js|css)$"))) return null
        val mime = mimeFor(file)
        return try {
            if (mime == "text/html") {
                val doc = context.assets.open(file).use { it.readBytes().toString(Charsets.UTF_8) }
                html(inject(doc))
            } else {
                val headers = HashMap<String, String>()
                headers["Cache-Control"] = "no-cache"
                if (file == "editor/video.html" || file == "editor/video-convert-worker.js") {
                    headers["Cross-Origin-Opener-Policy"] = "same-origin"
                    headers["Cross-Origin-Embedder-Policy"] = "credentialless"
                }
                WebResourceResponse(mime, if (isText(mime)) "utf-8" else null, 200, "OK", headers, context.assets.open(file))
            }
        } catch (_: IOException) {
            null // Not bundled: let the network answer.
        }
    }

    /** Tells the page it runs inside the app and loads the app's own styles and behaviour. */
    private fun inject(doc: String): String {
        val script = "<script>window.FRETLARK_ORIGIN=\"$origin\";window.FRETLARK_APP=\"android\";" +
            "window.FRETLARK_APP_VERSION=\"${BuildConfig.VERSION_NAME}\";</script>" +
            "<script src=\"/app-shell/app.js?v=${BuildConfig.VERSION_CODE}\"></script>"
        val style = "<link rel=\"stylesheet\" href=\"/app-shell/app.css?v=${BuildConfig.VERSION_CODE}\">"
        var out = doc
        val head = out.indexOf("<head>")
        out = if (head >= 0) out.substring(0, head + 6) + script + out.substring(head + 6) else out
        val end = out.indexOf("</head>")
        return if (head >= 0 && end >= 0) out.substring(0, end) + style + out.substring(end) else out
    }

    private fun html(doc: String): WebResourceResponse {
        val headers = HashMap<String, String>()
        headers["Cache-Control"] = "no-store"
        return WebResourceResponse("text/html", "utf-8", 200, "OK", headers, ByteArrayInputStream(doc.toByteArray(Charsets.UTF_8)))
    }

    private fun isText(mime: String) = mime.startsWith("text/") || mime == "application/json" || mime == "image/svg+xml"

    private fun mimeFor(file: String): String = when (file.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json", "map" -> "application/json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "gif" -> "image/gif"
        "ico" -> "image/x-icon"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        "ttf" -> "font/ttf"
        "wasm" -> "application/wasm"
        "txt", "md" -> "text/plain"
        else -> "application/octet-stream"
    }
}
