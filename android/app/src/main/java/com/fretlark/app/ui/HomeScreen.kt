package com.fretlark.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyHorizontalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.FileUpload
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fretlark.app.data.Song
import java.time.Instant
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.absoluteValue

/**
 * Home: a minimal top row, an aurora wash drawn from the newest cover, a big
 * cover pager, Brink-style setlist folders, and a two-row library strip.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(model: AppModel, onOpenTab: (Tab) -> Unit) {
    val actions = LocalAppActions.current
    val songs = model.songs
    val hero = remember(songs) { songs.sortedByDescending { sortTime(it.updatedAt) }.take(5) }
    val glowSong = remember(songs) { songs.maxByOrNull { sortTime(it.updatedAt) } }
    val library = remember(songs) { songs.sortedByDescending { sortTime(it.updatedAt) } }
    var enter by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        delay(650)
        enter = false
    }

    Box(Modifier.fillMaxSize().background(Fret.colors.background)) {
        if (glowSong != null) {
            AuroraGlow(glowSong, Modifier.fillMaxWidth().height(440.dp).align(Alignment.TopCenter))
        }
        PullToRefreshBox(
            isRefreshing = model.loading,
            onRefresh = { model.refresh() },
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize().statusBarsPadding(),
                contentPadding = PaddingValues(bottom = Space.navClearance),
            ) {
                item(key = "top") {
                    Row(
                        Modifier.fillMaxWidth()
                            .padding(horizontal = Space.gutter, vertical = 8.dp)
                            .animateItem(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircleIconButton(Icons.Rounded.Search, "Search", onClick = { onOpenTab(Tab.Songs) })
                        Spacer(Modifier.weight(1f))
                        HomeAvatar(model.session?.email.orEmpty()) { onOpenTab(Tab.Settings) }
                    }
                }

                if (hero.isNotEmpty()) {
                    item(key = "hero") {
                        Box(
                            Modifier.animateItem()
                                .enterReveal(0, enter)
                                .fillMaxWidth()
                                .padding(top = 4.dp),
                        ) {
                            HeroPager(
                                hero = hero,
                                onOpen = { model.openSong(it) },
                                onPlay = { actions.openPlayer(it) },
                            )
                        }
                    }
                } else {
                    item(key = "empty") {
                        Column(
                            Modifier.animateItem()
                                .enterReveal(0, enter)
                                .fillMaxWidth()
                                .padding(horizontal = Space.gutter, vertical = 56.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Box(
                                Modifier.size(88.dp).clip(CircleShape).background(Fret.colors.surface),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    Icons.Rounded.MusicNote,
                                    contentDescription = null,
                                    tint = Fret.colors.textMuted,
                                    modifier = Modifier.size(40.dp),
                                )
                            }
                            Spacer(Modifier.height(20.dp))
                            PrimaryButton("Upload a song", { actions.importSong() }, icon = Icons.Rounded.FileUpload)
                        }
                    }
                }

                if (library.isNotEmpty()) {
                    item(key = "library") {
                        Column(Modifier.animateItem()) {
                            SectionHeader(
                                title = "Library",
                                modifier = Modifier.enterReveal(1, enter),
                                action = "See all",
                                onAction = { onOpenTab(Tab.Songs) },
                            )
                            LazyHorizontalGrid(
                                rows = GridCells.Fixed(2),
                                modifier = Modifier.fillMaxWidth().height(152.dp).enterReveal(2, enter),
                                contentPadding = PaddingValues(horizontal = Space.gutter),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                items(library, key = { it.id }) { song ->
                                    LibraryTile(
                                        song = song,
                                        onClick = { model.openSong(song) },
                                        modifier = Modifier.animateItem(),
                                    )
                                }
                            }
                        }
                    }
                }

                item(key = "setlists") {
                    Column(Modifier.animateItem()) {
                        SectionHeader(
                            title = "Setlists",
                            modifier = Modifier.enterReveal(3, enter),
                            action = "See all",
                            onAction = { onOpenTab(Tab.Setlists) },
                        )
                        if (model.setlists.isEmpty()) {
                            LazyRow(
                                contentPadding = PaddingValues(horizontal = Space.gutter),
                                horizontalArrangement = Arrangement.spacedBy(14.dp),
                            ) {
                                item(key = "new") {
                                    NewFolderTile(
                                        onClick = { onOpenTab(Tab.Setlists) },
                                        modifier = Modifier.enterReveal(4, enter).animateItem(),
                                    )
                                }
                            }
                        } else {
                            LazyRow(
                                contentPadding = PaddingValues(horizontal = Space.gutter),
                                horizontalArrangement = Arrangement.spacedBy(14.dp),
                            ) {
                                items(model.setlists, key = { it.id }) { s ->
                                    val covers = remember(s.id, model.setlistSongIds) { model.setlistSongs(s.id) }
                                    FolderCard(
                                        title = s.title.ifBlank { "Untitled setlist" },
                                        songCount = s.songCount,
                                        songs = covers,
                                        onClick = { model.pendingSetlistId = s.id; onOpenTab(Tab.Setlists) },
                                        modifier = Modifier.enterReveal(4, enter).animateItem(),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Aurora wash behind the top of the page, drifting slowly on the GPU. */
@Composable
private fun AuroraGlow(song: Song, modifier: Modifier = Modifier) {
    val infinite = rememberInfiniteTransition(label = "aurora")
    val dx by infinite.animateFloat(
        initialValue = -22f, targetValue = 22f,
        animationSpec = infiniteRepeatable(tween(7000, easing = LinearEasing), RepeatMode.Reverse),
        label = "dx",
    )
    val dy by infinite.animateFloat(
        initialValue = -12f, targetValue = 14f,
        animationSpec = infiniteRepeatable(tween(9000, easing = LinearEasing), RepeatMode.Reverse),
        label = "dy",
    )
    val strength = if (Fret.colors.isDark) 0.55f else 0.42f
    val page = Fret.colors.background
    Box(modifier.clipToBounds()) {
        // The drifting colour wash; the fade is drawn on top, outside the drift, so the
        // bottom edge always melts into the page instead of showing a hard line.
        CoverBackdrop(
            song,
            Modifier.fillMaxSize().graphicsLayer {
                translationX = dx
                translationY = dy
                scaleX = 1.3f
                scaleY = 1.3f
                alpha = strength
            },
            fadeToPage = false,
        )
        Box(
            Modifier.fillMaxSize().background(
                androidx.compose.ui.graphics.Brush.verticalGradient(
                    0f to page.copy(alpha = 0.15f),
                    0.45f to page.copy(alpha = 0.55f),
                    1f to page,
                ),
            ),
        )
    }
}

/** Big square covers in a peeking pager; the active title sits below with dots. */
@Composable
private fun HeroPager(hero: List<Song>, onOpen: (Song) -> Unit, onPlay: (Song) -> Unit) {
    if (hero.isEmpty()) return
    val pager = rememberPagerState(pageCount = { hero.size })
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val cardW = maxWidth * 0.78f
        val side = (maxWidth - cardW) / 2
        Column(Modifier.fillMaxWidth()) {
            HorizontalPager(
                state = pager,
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = side),
                pageSpacing = 12.dp,
                key = { hero[it].id },
            ) { page ->
                val song = hero[page]
                val off = ((pager.currentPage - page) + pager.currentPageOffsetFraction).absoluteValue.coerceIn(0f, 1f)
                Box(
                    Modifier.fillMaxWidth().graphicsLayer {
                        val s = 1f - 0.1f * off
                        scaleX = s
                        scaleY = s
                        alpha = 1f - 0.3f * off
                    },
                ) {
                    Box(Modifier.width(cardW).padding(bottom = 26.dp)) {
                        Cover(
                            song, cardW, corner = Space.radius,
                            modifier = Modifier.pressable(onClick = { onOpen(song) }),
                        )
                        Box(
                            Modifier.align(Alignment.BottomEnd)
                                .offset(x = (-14).dp, y = 26.dp)
                                .size(52.dp)
                                .shadow(12.dp, CircleShape)
                                .clip(CircleShape)
                                .background(Fret.colors.text)
                                .pressable(onClick = { onPlay(song) }),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Rounded.PlayArrow,
                                contentDescription = "Play",
                                tint = Fret.colors.background,
                                modifier = Modifier.size(26.dp),
                            )
                        }
                    }
                }
            }
            val active = hero.getOrNull(pager.currentPage)
            if (active != null) {
                androidx.compose.animation.AnimatedContent(
                    active,
                    transitionSpec = { androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(220)) togetherWith androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(140)) },
                    contentKey = { it.id },
                    label = "heroTitle",
                ) { active ->
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = 32.dp).padding(top = 14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        active.displayTitle,
                        style = MaterialTheme.typography.headlineMedium,
                        color = Fret.colors.text,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        active.artist.ifBlank { "Unknown artist" },
                        style = MaterialTheme.typography.bodyLarge,
                        color = Fret.colors.textSecondary,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                }
            }
            if (hero.size > 1) {
                Row(
                    Modifier.fillMaxWidth().padding(top = 10.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    hero.forEachIndexed { i, _ ->
                        val on = i == pager.currentPage
                        Box(
                            Modifier.padding(horizontal = 3.dp)
                                .size(width = if (on) 18.dp else 6.dp, height = 6.dp)
                                .clip(CircleShape)
                                .background(if (on) Fret.colors.text else Fret.colors.textMuted.copy(alpha = 0.35f)),
                        )
                    }
                }
            }
        }
    }
}

/** Brink-style folder: the collage peeks out of a rounded folder body. */
@Composable
private fun FolderCard(title: String, songCount: Int, songs: List<Song>, onClick: () -> Unit, modifier: Modifier = Modifier) {
    // Brink-style folder: the collage sits inside, the tinted front panel covers its lower half.
    val tint = songs.firstOrNull()?.let(::coverTint) ?: Fret.colors.textMuted
    val shape = RoundedCornerShape(Space.radius)
    Column(modifier.width(160.dp).pressable(onClick = onClick)) {
        Box(Modifier.width(160.dp).height(136.dp)) {
            Box(
                Modifier.fillMaxWidth().height(112.dp).align(Alignment.BottomCenter)
                    .clip(shape).background(tint.copy(alpha = if (Fret.colors.isDark) 0.30f else 0.20f)),
            )
            SetlistCover(
                songs, 104.dp, corner = Space.radiusSmall,
                modifier = Modifier.align(Alignment.TopCenter).shadow(8.dp, RoundedCornerShape(Space.radiusSmall)),
            )
            Box(
                Modifier.fillMaxWidth().height(62.dp).align(Alignment.BottomCenter)
                    .clip(shape)
                    .background(
                        androidx.compose.ui.graphics.Brush.verticalGradient(
                            listOf(
                                lerp(Fret.colors.surface, tint, 0.28f).copy(alpha = 0.94f),
                                lerp(Fret.colors.surface, tint, 0.42f),
                            ),
                        ),
                    )
                    .border(0.6.dp, Color.White.copy(alpha = if (Fret.colors.isDark) 0.10f else 0.45f), shape),
            )
        }
        Spacer(Modifier.height(8.dp))
        Text(
            title,
            style = MaterialTheme.typography.titleSmall,
            color = Fret.colors.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            if (songCount > 0) plural(songCount, "song") else "Empty",
            style = MaterialTheme.typography.bodySmall,
            color = Fret.colors.textMuted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun NewFolderTile(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val edge = Fret.colors.textMuted.copy(alpha = 0.5f)
    Column(modifier.width(160.dp).pressable(onClick = onClick)) {
        Box(
            Modifier.width(160.dp).height(136.dp)
                .drawBehind {
                    val r = Space.radius.toPx()
                    drawRoundRect(
                        color = edge,
                        cornerRadius = CornerRadius(r, r),
                        style = Stroke(width = 2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f), 0f)),
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Rounded.Add, contentDescription = null, tint = Fret.colors.textSecondary, modifier = Modifier.size(26.dp))
                Spacer(Modifier.height(6.dp))
                Text(
                    "New setlist",
                    style = MaterialTheme.typography.titleSmall,
                    color = Fret.colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(
            "New setlist",
            style = MaterialTheme.typography.titleSmall,
            color = Fret.colors.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            "Empty",
            style = MaterialTheme.typography.bodySmall,
            color = Fret.colors.textMuted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** One compact library cell: 56dp cover plus two lines. */
@Composable
private fun LibraryTile(song: Song, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.width(236.dp).height(68.dp)
            .clip(RoundedCornerShape(Space.radiusSmall))
            .pressable(onClick = onClick)
            .padding(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(song, 56.dp, corner = 10.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                song.displayTitle,
                style = MaterialTheme.typography.titleSmall,
                color = Fret.colors.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                song.artist.ifBlank { "Unknown artist" },
                style = MaterialTheme.typography.bodySmall,
                color = Fret.colors.textMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun HomeAvatar(email: String, onClick: () -> Unit) {
    val letter = email.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    Box(
        Modifier.size(40.dp).clip(CircleShape).background(Fret.colors.accentSoft).pressable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(letter, style = MaterialTheme.typography.titleMedium, color = Fret.colors.accent, maxLines = 1)
    }
}

/** First-visit stagger: items fade in and rise 16dp, ~30ms apart, capped at 8. Runs once. */
private fun Modifier.enterReveal(index: Int, enabled: Boolean): Modifier = composed {
    if (!enabled) return@composed this
    val risePx = with(LocalDensity.current) { 16.dp.toPx() }
    val alpha = remember { Animatable(0f) }
    val rise = remember { Animatable(risePx) }
    LaunchedEffect(Unit) {
        delay((minOf(index, 8) * 30).toLong())
        launch { alpha.animateTo(1f, tween(220)) }
        rise.animateTo(0f, spring(stiffness = Spring.StiffnessMedium, dampingRatio = Spring.DampingRatioNoBouncy))
    }
    graphicsLayer {
        this.alpha = alpha.value
        translationY = rise.value
    }
}

/** Timestamps arrive as ISO strings (or epoch millis); sorting newest first needs a number. */
private fun sortTime(value: String?): Long {
    if (value.isNullOrBlank()) return 0L
    value.toLongOrNull()?.let { return it }
    return runCatching { Instant.parse(value).toEpochMilli() }.getOrDefault(0L)
}
