package com.fretlark.app.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.snap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.QueueMusic
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.fretlark.app.data.Api
import com.fretlark.app.data.Artwork
import com.fretlark.app.data.Song
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlin.math.absoluteValue

/**
 * Album art for songs, from the same catalog lookup the website uses.
 * Results are kept for the life of the app; at most two lookups run at once, like the site.
 */
object Covers {
    private val results = mutableStateMapOf<String, Artwork?>()   // key -> art (null = no match)
    private val pending = HashSet<String>()
    private val gate = Semaphore(2)
    /** Art URLs already drawn once (so they're in the image memory cache). */
    val shown = java.util.Collections.synchronizedSet(HashSet<String>())

    fun key(song: Song) = "${song.id}|${song.title}|${song.artist}"

    fun peek(song: Song): Artwork? = results[key(song)]
    fun known(song: Song) = results.containsKey(key(song))

    suspend fun load(song: Song) {
        val k = key(song)
        if (results.containsKey(k) || !pending.add(k)) return
        try {
            val art = gate.withPermit { runCatching { Api.artwork(song.id) } }
            // A failed lookup is retried next time the cover is shown; a "no match" answer is kept.
            art.onSuccess { results[k] = it }
        } finally { pending.remove(k) }
    }
}

private val coverHues = listOf(
    listOf(Color(0xFF1E3A8A), Color(0xFF3B82F6), Color(0xFF93C5FD)),
    listOf(Color(0xFF7F1D1D), Color(0xFFE5484D), Color(0xFFFFB4A8)),
    listOf(Color(0xFF064E3B), Color(0xFF12A594), Color(0xFF8BF0D6)),
    listOf(Color(0xFF3B0764), Color(0xFF8E4EC6), Color(0xFFE2C6FF)),
    listOf(Color(0xFF7C2D12), Color(0xFFF76B15), Color(0xFFFFD29E)),
    listOf(Color(0xFF0C4A6E), Color(0xFF0EA5E9), Color(0xFFA5E8FF)),
    listOf(Color(0xFF831843), Color(0xFFD6409F), Color(0xFFFFC2E5)),
    listOf(Color(0xFF1C1917), Color(0xFF57534E), Color(0xFFD6D3D1)),
)

private fun huesFor(seed: String) = coverHues[seed.hashCode().absoluteValue % coverHues.size]

/** The dominant colour of a song's generated cover, for tinting headers when there's no art. */
fun coverTint(song: Song): Color = huesFor(song.title + song.artist)[1]

/**
 * A generated cover for songs the catalog doesn't know: a deep gradient with a soft light,
 * six faint strings across it like a fretboard, the first letter and (when big enough) the title.
 */
@Composable
private fun GeneratedCover(song: Song, size: Dp) {
    val (deep, mid, light) = huesFor(song.title + song.artist)
    val letter = song.displayTitle.trim().firstOrNull { it.isLetterOrDigit() }?.uppercase() ?: "♪"
    val px = with(LocalDensity.current) { size.toPx() }
    Box(
        Modifier.fillMaxSize()
            .background(Brush.linearGradient(listOf(mid, deep), start = androidx.compose.ui.geometry.Offset(0f, 0f), end = androidx.compose.ui.geometry.Offset(px, px)))
            .background(Brush.radialGradient(listOf(light.copy(alpha = 0.5f), Color.Transparent), center = androidx.compose.ui.geometry.Offset(px * 0.85f, px * 0.1f), radius = px * 0.9f))
            .drawBehind {
                // Strings: thicker at the bottom, like a guitar seen from above.
                for (i in 0 until 6) {
                    val y = this.size.height * (0.5f + i * 0.085f)
                    drawLine(Color.White.copy(alpha = 0.10f + i * 0.015f), androidx.compose.ui.geometry.Offset(0f, y), androidx.compose.ui.geometry.Offset(this.size.width, y), strokeWidth = (0.6f + i * 0.35f) * density)
                }
            },
    ) {
        val big = size >= 96.dp
        Text(
            letter,
            color = Color.White.copy(alpha = 0.95f),
            style = TextStyle(fontFamily = Inter, fontSize = sp(size.value * (if (big) 0.30f else 0.44f)), fontWeight = FontWeight.Black, letterSpacing = sp(-1f)),
            modifier = Modifier.align(if (big) Alignment.TopStart else Alignment.Center).then(if (big) Modifier.padding(size * 0.09f) else Modifier),
        )
        if (big) Text(
            song.displayTitle, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            color = Color.White.copy(alpha = 0.85f),
            style = TextStyle(fontFamily = Inter, fontSize = sp((size.value * 0.085f).coerceIn(10f, 15f)), fontWeight = FontWeight.SemiBold, lineHeight = sp((size.value * 0.105f).coerceIn(12f, 18f))),
            modifier = Modifier.align(Alignment.BottomStart).padding(size * 0.09f),
        )
    }
}

private fun sp(v: Float) = androidx.compose.ui.unit.TextUnit(v.coerceAtLeast(8f), androidx.compose.ui.unit.TextUnitType.Sp)

/**
 * A song's cover: verified album art when the catalog has it, otherwise a generated one.
 * The art fades in over the generated cover, so rows never jump.
 */
@Composable
fun Cover(song: Song, size: Dp, modifier: Modifier = Modifier, corner: Dp = size * 0.18f) {
    LaunchedEffect(Covers.key(song)) { Covers.load(song) }
    val art = Covers.peek(song)
    // Art that has been shown once is in Coil's memory cache: show it at once instead of fading again.
    var loaded by remember(art?.url) { mutableStateOf(art?.url in Covers.shown) }
    val fade by animateFloatAsState(if (loaded) 1f else 0f, if (art?.url in Covers.shown) snap() else tween(260), label = "cover")
    Box(modifier.size(size).clip(RoundedCornerShape(corner))) {
        GeneratedCover(song, size)
        if (art != null) {
            AsyncImage(
                model = coverRequest(if (size <= 36.dp && art.fallbackUrl != null) art.fallbackUrl else art.url),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                onSuccess = { loaded = true; Covers.shown.add(art.url) },
                modifier = Modifier.fillMaxSize().alpha(fade),
            )
        }
    }
}

/**
 * One request per URL whatever size it's drawn at, so the memory cache hits when the same art
 * shows up bigger or smaller (a carousel tile, then a page header) and nothing reloads mid-animation.
 */
@Composable
private fun coverRequest(url: String): coil.request.ImageRequest {
    val context = androidx.compose.ui.platform.LocalContext.current
    return remember(url) {
        coil.request.ImageRequest.Builder(context).data(url).size(coil.size.Size.ORIGINAL).memoryCacheKey(url).crossfade(false).build()
    }
}

/** A setlist cover: a 2x2 grid of its first songs' covers, or one cover when it has fewer than four. */
@Composable
fun SetlistCover(songs: List<Song>, size: Dp, modifier: Modifier = Modifier, corner: Dp = size * 0.16f) {
    Box(modifier.size(size).clip(RoundedCornerShape(corner)).background(Fret.colors.surfaceRaised), contentAlignment = Alignment.Center) {
        when {
            songs.isEmpty() -> Icon(Icons.Rounded.QueueMusic, null, tint = Fret.colors.textMuted, modifier = Modifier.size(size * 0.4f))
            songs.size < 4 -> Cover(songs[0], size, corner = 0.dp)
            else -> Column {
                val half = size / 2
                Row { Cover(songs[0], half, corner = 0.dp); Cover(songs[1], half, corner = 0.dp) }
                Row { Cover(songs[2], half, corner = 0.dp); Cover(songs[3], half, corner = 0.dp) }
            }
        }
    }
}

/**
 * A blurred, darkened wash of a song's art for page headers (the Apple Music look).
 * Falls back to the generated cover's colours.
 */
@Composable
fun CoverBackdrop(song: Song?, modifier: Modifier = Modifier, fadeToPage: Boolean = true) {
    BoxWithConstraints(modifier.clipToBounds()) {
        if (song == null) return@BoxWithConstraints
        LaunchedEffect(Covers.key(song)) { Covers.load(song) }
        val art = Covers.peek(song)
        val tint = coverTint(song)
        val (deep, mid, _) = huesFor(song.title + song.artist)
        if (fadeToPage) Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(tint.copy(alpha = 0.55f), Color.Transparent))))
        else Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(mid, deep))))
        if (art != null) {
            AsyncImage(
                model = art.fallbackUrl ?: art.url, contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = 1.4f; scaleY = 1.4f }.blur(if (fadeToPage) 60.dp else 40.dp).alpha(if (fadeToPage) 0.75f else 1f),
            )
        }
        if (fadeToPage) Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Fret.colors.background))))
    }
}
