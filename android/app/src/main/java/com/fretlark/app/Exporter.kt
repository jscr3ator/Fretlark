package com.fretlark.app

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

/**
 * Saves files the web app produces (GP, MIDI, WAV, PDF, video...).
 *
 * A WebView cannot download the in-memory files a page creates, so the page sends them here in
 * pieces. They are written to a private temporary file, then moved into the Downloads folder. On
 * Android 9 and older, which would need a storage permission for that, the share sheet opens instead.
 */
class Exporter(private val activity: Activity) {
    private class Pending(val file: File, val name: String, val mime: String, val out: FileOutputStream, var bytes: Long = 0)

    private val io = Executors.newSingleThreadExecutor()
    private val pending = HashMap<String, Pending>()
    private val dir = File(activity.cacheDir, "exports")

    fun begin(id: String, rawName: String, mime: String) = io.execute {
        try {
            // A page can't open endless files at once.
            if (pending.size >= MAX_PENDING) { fail(); return@execute }
            dir.mkdirs()
            dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 24 * 3600 * 1000L }?.forEach { it.delete() }
            val name = rawName.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").trim().take(120).ifEmpty { "fretlark-file" }
            val file = File(dir, "${System.currentTimeMillis()}-$name")
            pending[id] = Pending(file, name, mime.ifEmpty { "application/octet-stream" }, FileOutputStream(file))
        } catch (_: Exception) {
            fail()
        }
    }

    fun chunk(id: String, base64: String) = io.execute {
        val item = pending[id] ?: return@execute
        try {
            val data = Base64.decode(base64, Base64.DEFAULT)
            item.bytes += data.size
            if (item.bytes > MAX_BYTES) throw IllegalStateException("too large")
            item.out.write(data)
        } catch (_: Exception) {
            abortNow(id)
            fail()
        }
    }

    fun abort(id: String) = io.execute { abortNow(id) }

    /** Drops unfinished files and stops the writer (the activity is going away). */
    fun close() {
        io.execute { pending.keys.toList().forEach(::abortNow) }
        io.shutdown()
    }

    private companion object {
        const val MAX_PENDING = 4
        const val MAX_BYTES = 1024L * 1024 * 1024 // 1 GB: long videos are big, but not this big.
    }

    fun end(id: String) = io.execute {
        val item = pending.remove(id) ?: return@execute
        try {
            item.out.close()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = activity.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, item.name)
                    put(MediaStore.Downloads.MIME_TYPE, item.mime)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Fretlark")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IllegalStateException("no target")
                resolver.openOutputStream(target)?.use { out -> item.file.inputStream().use { it.copyTo(out) } }
                    ?: throw IllegalStateException("no stream")
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(target, values, null, null)
                item.file.delete()
                activity.runOnUiThread {
                    Toast.makeText(activity, activity.getString(R.string.saved_to_downloads, item.name), Toast.LENGTH_LONG).show()
                }
            } else {
                val uri = FileProvider.getUriForFile(activity, activity.packageName + ".files", item.file)
                val send = Intent(Intent.ACTION_SEND).setType(item.mime).putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                activity.runOnUiThread { activity.startActivity(Intent.createChooser(send, item.name)) }
            }
        } catch (_: Exception) {
            item.file.delete()
            fail()
        }
    }

    private fun abortNow(id: String) {
        val item = pending.remove(id) ?: return
        try { item.out.close() } catch (_: Exception) {}
        item.file.delete()
    }

    private fun fail() = activity.runOnUiThread {
        Toast.makeText(activity, R.string.save_failed, Toast.LENGTH_LONG).show()
    }
}
