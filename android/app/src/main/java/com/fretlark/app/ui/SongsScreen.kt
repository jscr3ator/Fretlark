package com.fretlark.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SwapVert
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fretlark.app.data.Song
import kotlinx.coroutines.delay

private enum class SongFilter { All, Shared, Private }
private enum class SongSort { Recent, Alpha }

private val SongRowHeight = 68.dp
private val SongCoverSize = 52.dp
private val SongTextStart = (20 + 52 + 14).dp

/**
 * The teacher's library, Apple Music style: a large title with a "+ sort" capsule, a quiet
 * search field, a segmented All/Shared/Private control, and edge-to-edge rows on the page.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun SongsScreen(model: AppModel) {
    val actions = LocalAppActions.current
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf(SongFilter.All) }
    var sort by rememberSaveable { mutableStateOf(SongSort.Recent) }
    var sortMenu by remember { mutableStateOf(false) }

    val songs = model.songs

    val filtered = remember(songs, query, filter, sort) {
        val q = query.trim()
        songs.filter { song ->
            val matches = q.isEmpty() ||
                song.title.contains(q, ignoreCase = true) ||
                song.artist.contains(q, ignoreCase = true)
            matches && when (filter) {
                SongFilter.All -> true
                SongFilter.Shared -> song.shared
                SongFilter.Private -> !song.shared
            }
        }.sortedWith(
            when (sort) {
                SongSort.Recent -> compareByDescending<Song> { sortTime(it.updatedAt) }.thenBy { it.displayTitle.lowercase() }
                SongSort.Alpha -> compareBy { it.displayTitle.lowercase() }
            }
        )
    }

    // The entrance wave plays once per visit; anything added afterwards just appears in place.
    var entered by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(songs.isNotEmpty()) {
        if (songs.isEmpty() || entered) return@LaunchedEffect
        delay(800)
        entered = true
    }

    Box(Modifier.fillMaxSize().background(Fret.colors.background)) {
        PullToRefreshBox(
            isRefreshing = model.loading && songs.isNotEmpty(),
            onRefresh = { model.refresh() },
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
        ) {
            LazyColumn(
                Modifier.fillMaxSize().imePadding(),
                contentPadding = PaddingValues(bottom = Space.navClearance),
            ) {
                item(key = "header") {
                    Column(Modifier.fillMaxWidth()) {
                        Row(
                            Modifier.fillMaxWidth()
                                .padding(start = Space.gutter, end = Space.gutter - 4.dp, top = 12.dp, bottom = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "Songs",
                                style = MaterialTheme.typography.displaySmall,
                                color = Fret.colors.text,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                            // Apple's "+ =" capsule: sort and add on one raised pill.
                            Box {
                                Row(
                                    Modifier.height(40.dp).clip(CircleShape).background(Fret.colors.surfaceRaised),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Box(
                                        Modifier.size(48.dp, 40.dp).tapDim(onClick = { sortMenu = true }),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Icon(Icons.Outlined.SwapVert, contentDescription = "Sort", tint = Fret.colors.text, modifier = Modifier.size(22.dp))
                                    }
                                    Box(Modifier.width(0.5.dp).height(20.dp).background(Fret.colors.outline))
                                    Box(
                                        Modifier.size(48.dp, 40.dp).tapDim(onClick = { actions.importSong() }),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Icon(Icons.Rounded.Add, contentDescription = "Add a song", tint = Fret.colors.text, modifier = Modifier.size(22.dp))
                                    }
                                }
                                DropdownMenu(
                                    expanded = sortMenu,
                                    onDismissRequest = { sortMenu = false },
                                    containerColor = Fret.colors.surface,
                                ) {
                                    SortChoice("Recently updated", sort == SongSort.Recent) {
                                        sort = SongSort.Recent
                                        sortMenu = false
                                    }
                                    SortChoice("Title A-Z", sort == SongSort.Alpha) {
                                        sort = SongSort.Alpha
                                        sortMenu = false
                                    }
                                }
                            }
                        }
                        SongSearch(
                            value = query,
                            onChange = { query = it },
                            modifier = Modifier.padding(horizontal = Space.gutter),
                        )
                        Spacer(Modifier.height(12.dp))
                        SongSegments(selected = filter, onSelect = { filter = it })
                        Spacer(Modifier.height(6.dp))
                    }
                }

                when {
                    model.loading && songs.isEmpty() -> item(key = "loading") {
                        Box(Modifier.fillMaxWidth().height(240.dp)) { LoadingState() }
                    }

                    model.loadError != null && songs.isEmpty() -> item(key = "error") {
                        EmptyState(
                            icon = Icons.Rounded.LibraryMusic,
                            title = "Couldn't load your songs",
                            message = model.loadError.orEmpty(),
                            action = { InkButton("Try again", { model.refresh() }) },
                        )
                    }

                    songs.isEmpty() -> item(key = "empty") {
                        EmptyState(
                            icon = Icons.Rounded.LibraryMusic,
                            title = "No songs yet",
                            message = "Upload or write a tab.",
                            action = {
                                Column(
                                    Modifier.fillMaxWidth(),
                                    verticalArrangement = Arrangement.spacedBy(10.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                ) {
                                    InkButton("Upload a song", { actions.importSong() }, Modifier.fillMaxWidth())
                                    QuietButton("Write one", { actions.newSong() }, Modifier.fillMaxWidth())
                                }
                            },
                        )
                    }

                    filtered.isEmpty() -> item(key = "noresults") {
                        NoResults(query, filter) {
                            if (query.isNotBlank()) query = "" else filter = SongFilter.All
                        }
                    }

                    else -> {
                        item(key = "count") {
                            Row(
                                Modifier.fillMaxWidth().padding(start = Space.gutter, end = Space.gutter, top = 10.dp, bottom = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    plural(filtered.size, "song"),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Fret.colors.textMuted,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                Text(
                                    if (sort == SongSort.Recent) "Recent" else "A–Z",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Fret.colors.textMuted,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                        itemsIndexed(filtered, key = { _, song -> song.id }) { index, song ->
                            SongRow(
                                song = song,
                                index = index,
                                animateIn = !entered,
                                last = index == filtered.lastIndex,
                                onOpen = { model.openSong(song) },
                                onLongPress = {
                                    actions.haptic()
                                    model.openSong(song)
                                },
                                modifier = Modifier.animateItem(),
                            )
                        }
                    }
                }
            }
        }
    }
}

/** 40dp quiet search field: raised fill, magnifier, no border. */
@Composable
private fun SongSearch(value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val focus = LocalFocusManager.current
    Row(
        modifier.fillMaxWidth().height(40.dp).clip(RoundedCornerShape(12.dp)).background(Fret.colors.surfaceRaised).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Search, contentDescription = null, tint = Fret.colors.textMuted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) {
                Text("Search", color = Fret.colors.textMuted, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            BasicTextField(
                value = value, onValueChange = onChange, singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = Fret.colors.text),
                cursorBrush = SolidColor(Fret.colors.text),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (value.isNotEmpty()) {
            Box(Modifier.size(24.dp).tapDim(onClick = { onChange("") }), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Close, contentDescription = "Clear search", tint = Fret.colors.textMuted, modifier = Modifier.size(16.dp))
            }
        }
    }
}

/** All / Shared / Private as a frosted sliding control. */
@Composable
private fun SongSegments(selected: SongFilter, onSelect: (SongFilter) -> Unit) {
    val options = listOf(SongFilter.All, SongFilter.Shared, SongFilter.Private)
    GlassSegmented(
        options = listOf("All", "Shared", "Private"),
        selected = options.indexOf(selected),
        onSelect = { onSelect(options[it]) },
        modifier = Modifier.padding(horizontal = Space.gutter),
        height = 36.dp,
    )
}

@Composable
private fun SortChoice(label: String, active: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = {
            Text(
                label,
                style = MaterialTheme.typography.bodyMedium,
                color = if (active) Fret.colors.text else Fret.colors.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        onClick = onClick,
        trailingIcon = {
            if (active) {
                Icon(Icons.Rounded.Check, contentDescription = null, tint = Fret.colors.text, modifier = Modifier.size(18.dp))
            }
        },
    )
}

@Composable
private fun SongRow(
    song: Song,
    index: Int,
    animateIn: Boolean,
    last: Boolean,
    onOpen: () -> Unit,
    onLongPress: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth().enterStagger(index, animateIn)) {
        Row(
            Modifier.fillMaxWidth()
                .height(SongRowHeight)
                .tapDim(onLongClick = onLongPress, onClick = onOpen)
                .padding(start = Space.gutter, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(SongCoverSize)) {
                Cover(song, SongCoverSize, corner = 8.dp)
                Box(Modifier.matchParentSize().clip(RoundedCornerShape(8.dp)).hairlineBorder(8.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    song.displayTitle,
                    style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                    color = Fret.colors.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (song.shared) {
                        Icon(
                            Icons.Rounded.Link,
                            contentDescription = "Shared",
                            tint = Fret.colors.text,
                            modifier = Modifier.size(12.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                    }
                    Text(
                        song.artist.ifBlank { "Unknown artist" },
                        style = MaterialTheme.typography.bodyMedium,
                        color = Fret.colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Box(Modifier.size(40.dp).tapDim(onClick = onOpen), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.MoreHoriz, contentDescription = "More", tint = Fret.colors.textMuted, modifier = Modifier.size(24.dp))
            }
        }
        if (!last) {
            Box(Modifier.padding(start = SongTextStart).fillMaxWidth().height(0.5.dp).background(Fret.colors.outline))
        }
    }
}

/** Ripple-free press: the row simply dims to 60% while held. */
@OptIn(ExperimentalFoundationApi::class)
fun Modifier.tapDim(enabled: Boolean = true, onLongClick: (() -> Unit)? = null, onClick: () -> Unit): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val alpha by animateFloatAsState(if (pressed) 0.6f else 1f, tween(120), label = "dim")
    this.graphicsLayer { this.alpha = alpha }.combinedClickable(
        interactionSource = source, indication = null, enabled = enabled,
        onLongClick = onLongClick, onClick = onClick,
    )
}

private fun Modifier.hairlineBorder(corner: androidx.compose.ui.unit.Dp): Modifier = composed {
    this.then(border(0.5.dp, Fret.colors.outline, RoundedCornerShape(corner)))
}

/** Primary action in ink, never colour. */
@Composable
private fun InkButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier.height(48.dp).clip(RoundedCornerShape(14.dp)).background(Fret.colors.text).tapDim(onClick = onClick).padding(horizontal = 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = Fret.colors.background, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Quiet action on the raised surface, ink text. */
@Composable
private fun QuietButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier.height(44.dp).clip(RoundedCornerShape(14.dp)).background(Fret.colors.surfaceRaised).tapDim(onClick = onClick).padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = Fret.colors.text, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * One-shot entrance for list items: fade in while rising 12dp, delayed by [index] so the list
 * arrives as a soft wave. [animate] is read once, when the item first composes.
 */
@Composable
private fun Modifier.enterStagger(index: Int, animate: Boolean): Modifier {
    val rise = with(LocalDensity.current) { 12.dp.toPx() }
    val progress = remember { Animatable(if (animate) 0f else 1f) }
    LaunchedEffect(Unit) {
        if (animate) {
            progress.animateTo(
                targetValue = 1f,
                animationSpec = tween(
                    durationMillis = 220,
                    delayMillis = index.coerceAtMost(8) * 25,
                    easing = FastOutSlowInEasing,
                ),
            )
        }
    }
    return graphicsLayer {
        alpha = progress.value
        translationY = (1f - progress.value) * rise
    }
}

@Composable
private fun NoResults(query: String, filter: SongFilter, onClear: () -> Unit) {
    val searching = query.isNotBlank()
    val title = when {
        searching -> "Nothing matches “$query”"
        filter == SongFilter.Shared -> "No shared songs"
        else -> "Every song is shared"
    }
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            title,
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
            color = Fret.colors.text,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            if (searching) "Try a different search" else "Songs you share will appear here",
            style = MaterialTheme.typography.bodyMedium,
            color = Fret.colors.textMuted,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        QuietButton(if (searching) "Clear search" else "Show all songs", onClear)
    }
}

/** Timestamps arrive as ISO strings (or epoch millis); newest first sorting needs a number. */
private fun sortTime(value: String?): Long {
    if (value.isNullOrBlank()) return 0L
    value.toLongOrNull()?.let { return it }
    return runCatching { java.time.Instant.parse(value).toEpochMilli() }.getOrDefault(0L)
}
