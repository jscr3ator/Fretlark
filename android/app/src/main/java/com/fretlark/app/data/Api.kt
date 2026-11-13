package com.fretlark.app.data

import android.webkit.CookieManager
import com.fretlark.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** A request the server refused. [message] is already written for people. */
class ApiError(message: String, val status: Int, val code: String? = null) : Exception(message)

data class Session(
    val authenticated: Boolean,
    val email: String,
    val contactEmail: String?,
    val contactEmailVerified: Boolean,
    val mailEnabled: Boolean,
    val registrationOpen: Boolean,
    val authType: String?,
)

data class StudentSettings(
    val notation: String,
    val showMixer: Boolean,
    val showTrackControls: Boolean,
    val metronome: Boolean,
    val countIn: Boolean,
    val allowPrint: Boolean,
    val allowDownload: Boolean,
    val raw: JSONObject,
)

data class Artwork(val url: String, val fallbackUrl: String?, val album: String, val source: String)

data class Song(
    val id: String,
    val title: String,
    val artist: String,
    val notes: String,
    val fileName: String,
    val fileSize: Long,
    val trackCount: Int,
    val barCount: Int,
    val tempo: Int,
    val shareToken: String?,
    val shared: Boolean,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
    val viewCount: Int,
    val lastViewedAt: String?,
    val settings: StudentSettings,
) {
    val displayTitle get() = title.ifBlank { "Untitled song" }
    val shareUrl get() = shareToken?.takeIf { shared }?.let { "${Api.origin}/view/$it" }
}

data class SetlistSummary(
    val id: String,
    val title: String,
    val songCount: Int,
    val shared: Boolean,
    val shareToken: String?,
    val updatedAt: Long,
) {
    val shareUrl get() = shareToken?.takeIf { shared }?.let { "${Api.origin}/set/$it" }
}

data class SetlistSong(val id: String, val title: String, val artist: String, val shared: Boolean)

data class Setlist(
    val id: String,
    val title: String,
    val notes: String,
    val shared: Boolean,
    val shareToken: String?,
    val songs: List<SetlistSong>,
) {
    val shareUrl get() = shareToken?.takeIf { shared }?.let { "${Api.origin}/set/$it" }
}

data class Storage(
    val songs: Int,
    val usedBytes: Long,
    val limitBytes: Long,
    val limitSongs: Int,
    val plan: String,
    val planUntil: String?,
)

/**
 * The Fretlark API, spoken natively. The session cookie lives in the system [CookieManager], the same
 * jar the song player's web view uses, so signing in here also signs the player in.
 */
object Api {
    val origin: String = BuildConfig.SITE_URL.trimEnd('/')
    private val cookies get() = CookieManager.getInstance()

    // ---------- account ----------

    suspend fun session(): Session = parseSession(call("GET", "session"))

    /** Returns null when signed in, or a challenge id when a two-factor code is needed. */
    suspend fun login(identifier: String, password: String): String? {
        val result = call("POST", "auth/login", JSONObject().put("email", identifier).put("password", password))
        return if (result.optBoolean("mfa_required")) result.optString("challenge") else null
    }

    suspend fun verifyCode(challenge: String, code: String) {
        call("POST", "auth/verify", JSONObject().put("challenge", challenge).put("code", code))
    }

    suspend fun register(email: String, password: String) {
        call("POST", "auth/register", JSONObject().put("email", email).put("password", password))
    }

    suspend fun forgotPassword(identifier: String) {
        call("POST", "auth/forgot-request", JSONObject().put("identifier", identifier))
    }

    suspend fun logout() {
        try { call("POST", "auth/logout") } finally {
            withContext(Dispatchers.Main) { cookies.removeAllCookies(null); cookies.flush() }
        }
    }

    suspend fun storage(): Storage = call("GET", "admin/storage").let {
        Storage(
            songs = it.optInt("songs"),
            usedBytes = it.optLong("used_bytes"),
            limitBytes = it.optLong("limit_bytes"),
            limitSongs = it.optInt("limit_songs"),
            plan = it.optString("plan", "free"),
            planUntil = it.optStringOrNull("plan_until"),
        )
    }

    // ---------- songs ----------

    /** Verified album art for a song (Apple Music, then Deezer), or null when the catalog has no match. */
    suspend fun artwork(songId: String): Artwork? = call("GET", "admin/lessons/${enc(songId)}/artwork").optJSONObject("artwork")?.let {
        val url = it.optString("url").takeIf { u -> u.startsWith("https://") } ?: return@let null
        Artwork(url, it.optString("fallbackUrl").takeIf { u -> u.startsWith("https://") }, it.optString("album"), it.optString("source"))
    }

    suspend fun songs(): List<Song> = call("GET", "admin/lessons").optJSONArray("lessons").map(::parseSong)

    suspend fun updateSong(song: Song, title: String = song.title, artist: String = song.artist, notes: String = song.notes): Song =
        parseSong(call("PATCH", "admin/lessons/${enc(song.id)}", JSONObject()
            .put("version", song.version).put("title", title).put("artist", artist).put("notes", notes)
            .put("student_settings", song.settings.raw)))

    suspend fun deleteSong(id: String) { call("DELETE", "admin/lessons/${enc(id)}") }

    /** Turns the song's link on or off. [rotate] makes a new link and retires the old one. */
    suspend fun setSongShared(id: String, shared: Boolean, rotate: Boolean = false): Song =
        parseSong(if (shared) call("POST", "admin/lessons/${enc(id)}/share", JSONObject().put("rotate", rotate))
        else call("DELETE", "admin/lessons/${enc(id)}/share"))

    /** Uploads a song file. [metadata] comes from reading the score (see ScoreReader). */
    suspend fun uploadSong(bytes: ByteArray, fileName: String, metadata: JSONObject): Song {
        val data = JSONObject(metadata.toString())
            .put("file_name", fileName.take(255)).put("file_size", bytes.size).put("source_format", "file")
        data.put("title", data.optString("title").take(180)).put("artist", data.optString("artist").take(180))
        return parseSong(call("POST", "admin/lessons", raw = bytes,
            headers = mapOf("Content-Type" to "application/octet-stream", "X-Fretphrase-Metadata" to enc(data.toString()))))
    }

    // ---------- setlists ----------

    suspend fun setlists(): List<SetlistSummary> = call("GET", "admin/setlists").optJSONArray("setlists").map {
        SetlistSummary(it.getString("id"), it.optString("title"), it.optInt("song_count"), it.optInt("shared") == 1,
            it.optStringOrNull("share_token"), it.optLong("updated_at"))
    }

    suspend fun setlist(id: String): Setlist = parseSetlist(call("GET", "admin/setlists/${enc(id)}"))
    suspend fun createSetlist(title: String): Setlist = parseSetlist(call("POST", "admin/setlists", JSONObject().put("title", title)))
    suspend fun deleteSetlist(id: String) { call("DELETE", "admin/setlists/${enc(id)}") }

    suspend fun updateSetlist(id: String, title: String? = null, notes: String? = null, songIds: List<String>? = null): Setlist {
        val body = JSONObject()
        title?.let { body.put("title", it) }
        notes?.let { body.put("notes", it) }
        songIds?.let { body.put("lesson_ids", JSONArray(it)) }
        return parseSetlist(call("PATCH", "admin/setlists/${enc(id)}", body))
    }

    suspend fun setSetlistShared(id: String, shared: Boolean, rotate: Boolean = false): Setlist =
        parseSetlist(if (shared) call("POST", "admin/setlists/${enc(id)}/share", JSONObject().put("rotate", rotate))
        else call("DELETE", "admin/setlists/${enc(id)}/share"))

    // ---------- pages shown in the song web view ----------

    fun playerUrl(songId: String) = "$origin/editor/player.html?lesson=${enc(songId)}"
    fun editorUrl(songId: String) = "$origin/editor/index.html?lesson=${enc(songId)}"
    fun newSongUrl() = "$origin/editor/index.html?new=1"
    fun videoUrl(songId: String) = "$origin/editor/video.html?lesson=${enc(songId)}"
    fun accountPageUrl() = "$origin/admin#account"

    // ---------- plumbing ----------

    internal suspend fun call(
        method: String,
        path: String,
        body: JSONObject? = null,
        raw: ByteArray? = null,
        headers: Map<String, String> = emptyMap(),
    ): JSONObject = withContext(Dispatchers.IO) {
        val url = "$origin/api/$path"
        val conn = URL(url).openConnection() as HttpURLConnection
        try { try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 60_000
            conn.useCaches = false
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("Origin", origin)
            conn.setRequestProperty("User-Agent", "FretlarkAndroid/${BuildConfig.VERSION_NAME}")
            cookies.getCookie(url)?.let { conn.setRequestProperty("Cookie", it) }
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            val payload = raw ?: body?.toString()?.toByteArray()
            if (payload != null) {
                if (raw == null) conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.setFixedLengthStreamingMode(payload.size)
                conn.outputStream.use { it.write(payload) }
            }
            val status = try { conn.responseCode } catch (e: java.io.IOException) {
                throw ApiError("Can't reach Fretlark. Check your connection and try again.", 0)
            }
            // A local dev server on plain http can't hold a Secure cookie; production is always https.
            conn.headerFields["Set-Cookie"]?.forEach {
                cookies.setCookie(origin, if (origin.startsWith("http://")) it.replace(Regex(";\\s*Secure", RegexOption.IGNORE_CASE), "") else it)
            }
            if (conn.headerFields.containsKey("Set-Cookie")) cookies.flush()
            val text = (if (status >= 400) conn.errorStream else conn.inputStream)?.use(InputStream::readTextSafely).orEmpty()
            val json = try { if (text.isBlank()) JSONObject() else JSONObject(text) } catch (_: Exception) { JSONObject() }
            if (status >= 400) {
                val message = json.optString("error").ifBlank {
                    when (status) {
                        401 -> "Sign in to continue."
                        429 -> "Too many requests. Wait a moment and try again."
                        else -> "Something went wrong. Please try again."
                    }
                }
                throw ApiError(message, status, json.optStringOrNull("code"))
            }
            json
        } catch (e: java.io.IOException) {
            throw ApiError("Can't reach Fretlark. Check your connection and try again.", 0)
        } catch (e: org.json.JSONException) {
            throw ApiError("Something went wrong. Please try again.", 0)
        } } finally {
            conn.disconnect()
        }
    }

    private fun parseSession(it: JSONObject) = Session(
        authenticated = it.optBoolean("authenticated"),
        email = it.optString("email"),
        contactEmail = it.optStringOrNull("contactEmailAddress"),
        contactEmailVerified = it.optBoolean("contactEmailVerified"),
        mailEnabled = it.optBoolean("mailEnabled"),
        registrationOpen = it.optBoolean("registrationOpen"),
        authType = it.optStringOrNull("authType"),
    )

    private fun parseSong(it: JSONObject): Song {
        val s = it.optJSONObject("student_settings") ?: JSONObject()
        return Song(
            id = it.getString("id"),
            title = it.optString("title"),
            artist = it.optString("artist"),
            notes = it.optString("notes"),
            fileName = it.optString("file_name"),
            fileSize = it.optLong("file_size"),
            trackCount = it.optInt("track_count"),
            barCount = it.optInt("bar_count"),
            tempo = it.optInt("tempo"),
            shareToken = it.optStringOrNull("share_token"),
            shared = it.optInt("shared") == 1,
            version = it.optInt("version"),
            createdAt = it.optString("created_at"),
            updatedAt = it.optString("updated_at"),
            viewCount = it.optInt("view_count"),
            lastViewedAt = it.optStringOrNull("last_viewed_at"),
            settings = StudentSettings(
                notation = s.optString("notation", "both"),
                showMixer = s.optBoolean("show_mixer", true),
                showTrackControls = s.optBoolean("show_track_controls", true),
                metronome = s.optBoolean("metronome", true),
                countIn = s.optBoolean("count_in", true),
                allowPrint = s.optBoolean("allow_print", true),
                allowDownload = s.optBoolean("allow_download", true),
                raw = s,
            ),
        )
    }

    private fun parseSetlist(it: JSONObject) = Setlist(
        id = it.getString("id"),
        title = it.optString("title"),
        notes = it.optString("notes"),
        shared = it.optInt("shared") == 1,
        shareToken = it.optStringOrNull("share_token"),
        songs = it.optJSONArray("songs").map { s -> SetlistSong(s.getString("id"), s.optString("title"), s.optString("artist"), s.optInt("shared") == 1) },
    )

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
}

private fun InputStream.readTextSafely(): String = bufferedReader().readText()
private fun JSONObject.optStringOrNull(key: String): String? = if (isNull(key) || !has(key)) null else optString(key).ifEmpty { null }
private fun <T> JSONArray?.map(transform: (JSONObject) -> T): List<T> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it)?.let(transform) }
