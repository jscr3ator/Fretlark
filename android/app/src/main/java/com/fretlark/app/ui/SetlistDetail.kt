package com.fretlark.app.ui

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DragHandle
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.IosShare
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Preview
import androidx.compose.material.icons.rounded.QueueMusic
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.fretlark.app.data.Api
import com.fretlark.app.data.ApiError
import com.fretlark.app.data.Setlist
import com.fretlark.app.data.SetlistSong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val SongRowHeight = 68.dp

@OptIn(ExperimentalMaterial3Api::class, ExperimentalSharedTransitionApi::class)
@Composable
fun SetlistDetail(
    model: AppModel,
    setlistId: String,
    onClose: () -> Unit,
    sharedScope: SharedTransitionScope,
    visibilityScope: AnimatedVisibilityScope,
) {
    val actions = LocalAppActions.current
    val scope = rememberCoroutineScope()
    // Start from what the app already knows (title, songs, covers) so the page and its cover are
    // there on the first frame of the transition; the server copy replaces it a moment later.
    val cached = remember(setlistId) {
        model.setlists.firstOrNull { it.id == setlistId }?.let { s ->
            Setlist(s.id, s.title, "", s.shared, s.shareToken,
                model.setlistSongs(setlistId).map { SetlistSong(it.id, it.title, it.artist, it.shared) })
        }
    }
    var detail by remember(setlistId) { mutableStateOf(cached) }
    var refreshing by remember(setlistId) { mutableStateOf(false) }
    var loadError by remember(setlistId) { mutableStateOf<String?>(null) }

    var menuOpen by remember(setlistId) { mutableStateOf(false) }
    var showRename by remember(setlistId) { mutableStateOf(false) }
    var showDeleteConfirm by remember(setlistId) { mutableStateOf(false) }
    var showNotes by remember(setlistId) { mutableStateOf(false) }
    var showRotateConfirm by remember(setlistId) { mutableStateOf(false) }
    var showAdd by remember(setlistId) { mutableStateOf(false) }
    var showShare by remember(setlistId) { mutableStateOf(false) }
    var menuForSong by remember(setlistId) { mutableStateOf<String?>(null) }
    var removeTarget by remember(setlistId) { mutableStateOf<SetlistSong?>(null) }
    var shareBusy by remember(setlistId) { mutableStateOf(false) }
    var sharingSongs by remember(setlistId) { mutableStateOf(false) }
    var savingOrder by remember(setlistId) { mutableStateOf(false) }

    // Screen order of the songs; drag reorder mutates this, the server copy stays in [detail].
    val order = remember(setlistId) { mutableStateListOf<SetlistSong>().apply { cached?.songs?.let(::addAll) } }
    var draggingId by remember(setlistId) { mutableStateOf<String?>(null) }
    var dragOffsetY by remember(setlistId) { mutableFloatStateOf(0f) }
    var reorderBase by remember(setlistId) { mutableStateOf<List<SetlistSong>>(emptyList()) }
    val songsOf = detail?.songs
    LaunchedEffect(songsOf) {
        if (draggingId == null && songsOf != null) {
            order.clear()
            order.addAll(songsOf)
        }
    }
    // Song-row entrance plays once per visit; rows composed later (add, refresh) appear at once.
    var enter by remember(setlistId) { mutableStateOf(true) }
    LaunchedEffect(order.size) {
        if (order.isNotEmpty()) {
            delay(650)
            enter = false
        }
    }

    fun reload(initial: Boolean = false) {
        scope.launch {
            if (!initial) refreshing = true else loadError = null
            try {
                detail = Api.setlist(setlistId)
                loadError = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val message = (e as? ApiError)?.message ?: "Couldn't load this setlist."
                loadError = message
                // Deleted on another device: leave the page instead of editing a ghost.
                if ((e as? ApiError)?.status == 404) {
                    actions.toast(message)
                    onClose()
                    return@launch
                }
                // A failed refresh keeps the copy on screen; only a first load has nothing to show.
                if (detail != null) actions.toast(message)
            } finally {
                refreshing = false
            }
        }
    }
    LaunchedEffect(setlistId) { reload(initial = true) }

    fun applyUpdate(
        songIds: List<String>? = null,
        title: String? = null,
        notes: String? = null,
        fallbackOrder: List<SetlistSong>? = null,
        onSettled: (() -> Unit)? = null,
    ) {
        model.act({ Api.updateSetlist(setlistId, title = title, notes = notes, songIds = songIds) },
            onError = {
                if (fallbackOrder != null) {
                    order.clear()
                    order.addAll(fallbackOrder)
                }
                onSettled?.invoke()
                actions.toast(it)
            },
            onDone = { detail = it; onSettled?.invoke(); model.reloadSetlists() })
    }

    fun finishDrop() {
        val base = reorderBase
        draggingId = null
        dragOffsetY = 0f
        val ids = order.map { it.id }
        if (ids == base.map { it.id }) return
        // One reorder in flight at a time, so two PATCH replies can't land out of order.
        if (savingOrder) {
            order.clear()
            order.addAll(base)
            return
        }
        savingOrder = true
        applyUpdate(songIds = ids, fallbackOrder = base, onSettled = { savingOrder = false })
    }

    fun toggleShare(shared: Boolean) {
        if (shareBusy) return
        shareBusy = true
        model.act({ Api.setSetlistShared(setlistId, shared) },
            onError = { shareBusy = false; actions.toast(it) },
            onDone = { detail = it; shareBusy = false; model.reloadSetlists() })
    }

    fun toggleShareRotate() {
        if (shareBusy) return
        shareBusy = true
        model.act({ Api.setSetlistShared(setlistId, true, rotate = true) },
            onError = { shareBusy = false; actions.toast(it) },
            onDone = { detail = it; shareBusy = false; model.reloadSetlists() })
    }

    fun shareAllSongs(unshared: List<SetlistSong>) {
        if (sharingSongs) return
        sharingSongs = true
        model.act(
            {
                for (s in unshared) Api.setSongShared(s.id, true)
                Api.setlist(setlistId)
            },
            onError = {
                sharingSongs = false
                actions.toast(it)
                // Some songs may have been shared before the failure: resync instead of showing stale rows.
                reload()
            },
            onDone = { detail = it; sharingSongs = false; model.refresh() },
        )
    }

    fun openSong(song: SetlistSong) {
        val full = model.songs.firstOrNull { it.id == song.id }
        if (full != null) actions.openPlayer(full) else actions.toast("That song isn't available.")
    }

    fun openSongMenu(song: SetlistSong) {
        val full = model.songById(song.id)
        if (full != null) model.openSong(full) else actions.toast("That song isn't available.")
    }

    val listState = rememberLazyListState()
    val rowHPx = with(LocalDensity.current) { SongRowHeight.toPx() }
    val dragShadowPx = with(LocalDensity.current) { 10.dp.toPx() }

    Box(Modifier.fillMaxSize().background(Fret.colors.background)) {
        val d = detail
        if (d == null) {
            // A page that never got its first copy: keep Back on screen and offer a retry.
            Column(Modifier.fillMaxSize().statusBarsPadding()) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = Space.gutter, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircleIconButton(
                        Icons.AutoMirrored.Rounded.ArrowBack, "Back", onClose,
                        background = Fret.colors.surface.copy(alpha = 0.8f),
                    )
                }
                Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    val failure = loadError
                    if (failure != null) {
                        EmptyState(
                            icon = Icons.Rounded.QueueMusic,
                            title = "Couldn't load this setlist",
                            message = failure,
                            action = { PrimaryButton("Try again", { reload(initial = true) }) },
                        )
                    } else {
                        LoadingState()
                    }
                }
            }
        } else {
            val firstSong = (order.firstOrNull() ?: d.songs.firstOrNull())?.let { model.songById(it.id) }
            val coverSongs = order.mapNotNull { model.songById(it.id) }
            // Blurred art wash behind the top of the page (Apple Music look).
            CoverBackdrop(firstSong, Modifier.fillMaxWidth().height(420.dp))
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = { if (!savingOrder) reload() },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(
                    state = listState,
                    userScrollEnabled = draggingId == null,
                    modifier = Modifier.fillMaxSize().statusBarsPadding(),
                    contentPadding = PaddingValues(bottom = Space.navClearance),
                ) {
                    item(key = "top") {
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = Space.gutter, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            CircleIconButton(
                                Icons.AutoMirrored.Rounded.ArrowBack, "Back", onClose,
                                background = Fret.colors.surface.copy(alpha = 0.8f),
                            )
                            Spacer(Modifier.weight(1f))
                            Box {
                                CircleIconButton(
                                    Icons.Rounded.MoreVert, "More actions",
                                    onClick = { menuOpen = true },
                                    background = Fret.colors.surface.copy(alpha = 0.8f),
                                )
                                DropdownMenu(
                                    expanded = menuOpen,
                                    onDismissRequest = { menuOpen = false },
                                    containerColor = Fret.colors.surface,
                                ) {
                                    DropdownMenuItem(
                                        text = { Text("Rename", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                        leadingIcon = { Icon(Icons.Rounded.Edit, null) },
                                        onClick = { menuOpen = false; showRename = true },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Delete", color = Fret.colors.danger, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                        leadingIcon = { Icon(Icons.Rounded.Delete, null, tint = Fret.colors.danger) },
                                        onClick = { menuOpen = false; showDeleteConfirm = true },
                                    )
                                }
                            }
                        }
                    }
                    item(key = "hero") {
                        Column(
                            Modifier.fillMaxWidth().padding(horizontal = Space.gutter),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Spacer(Modifier.size(8.dp))
                            with(sharedScope) {
                                SetlistCover(
                                    coverSongs, 220.dp,
                                    modifier = Modifier.shadow(24.dp, RoundedCornerShape(20.dp))
                                        .sharedElement(
                                            rememberSharedContentState(key = "setlist-cover-$setlistId"),
                                            animatedVisibilityScope = visibilityScope,
                                            boundsTransform = SetlistBounds,
                                        ),
                                    corner = 20.dp,
                                )
                            }
                            Spacer(Modifier.size(20.dp))
                            with(sharedScope) {
                                Text(
                                    d.title.ifBlank { "Untitled setlist" },
                                    style = MaterialTheme.typography.headlineMedium.copy(fontSize = 26.sp),
                                    color = Fret.colors.text,
                                    textAlign = TextAlign.Center,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                            Spacer(Modifier.size(6.dp))
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.Center,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                if (d.songs.isNotEmpty()) {
                                    Text(
                                        plural(d.songs.size, "song"),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = Fret.colors.textSecondary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                if (d.shared) {
                                    Spacer(Modifier.width(6.dp))
                                    Icon(Icons.Rounded.Link, "Shared", tint = Fret.colors.textMuted, modifier = Modifier.size(14.dp))
                                }
                            }
                            Spacer(Modifier.size(6.dp))
                            if (d.notes.isBlank()) {
                                Text(
                                    "Add notes",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = Fret.colors.accent,
                                    textAlign = TextAlign.Center,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.clip(RoundedCornerShape(8.dp))
                                        .pressable { showNotes = true }
                                        .padding(horizontal = 12.dp, vertical = 6.dp),
                                )
                            } else {
                                Text(
                                    d.notes,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = Fret.colors.textSecondary,
                                    textAlign = TextAlign.Center,
                                    maxLines = 3,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.fillMaxWidth()
                                        .clip(RoundedCornerShape(8.dp))
                                        .pressable { showNotes = true }
                                        .padding(horizontal = 12.dp, vertical = 4.dp),
                                )
                            }
                            Spacer(Modifier.size(20.dp))
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Row(
                                    Modifier.weight(1f).height(48.dp)
                                        .clip(RoundedCornerShape(24.dp))
                                        .background(Fret.colors.accent)
                                        .pressable {
                                            val first = order.firstOrNull()
                                            if (first != null) openSong(first)
                                            else actions.toast("Add a song first.")
                                        }
                                        .padding(horizontal = 16.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center,
                                ) {
                                    Icon(Icons.Rounded.PlayArrow, null, tint = Fret.colors.onAccent, modifier = Modifier.size(20.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        "Play",
                                        color = Fret.colors.onAccent,
                                        style = MaterialTheme.typography.labelLarge,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                Row(
                                    Modifier.weight(1f).height(48.dp)
                                        .clip(RoundedCornerShape(24.dp))
                                        .background(Fret.colors.surfaceRaised)
                                        .pressable { showShare = true }
                                        .padding(horizontal = 16.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center,
                                ) {
                                    Icon(Icons.Rounded.IosShare, null, tint = Fret.colors.text, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        "Share",
                                        color = Fret.colors.text,
                                        style = MaterialTheme.typography.labelLarge,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                            Spacer(Modifier.size(12.dp))
                        }
                    }
                    itemsIndexed(order, key = { _, song -> song.id }) { index, song ->
                        Column(Modifier.fillMaxWidth().enterReveal(index, enter)) {
                            Box(
                                Modifier.fillMaxWidth()
                                    .zIndex(if (draggingId == song.id) 1f else 0f)
                                    .then(if (draggingId == song.id) Modifier else Modifier.animateItem())
                                    .graphicsLayer {
                                        translationY = if (draggingId == song.id) dragOffsetY else 0f
                                        scaleX = if (draggingId == song.id) 1.02f else 1f
                                        scaleY = if (draggingId == song.id) 1.02f else 1f
                                        shadowElevation = if (draggingId == song.id) dragShadowPx else 0f
                                    }
                                    .background(
                                        if (draggingId == song.id) Fret.colors.surface else Color.Transparent,
                                        RoundedCornerShape(Space.radiusSmall),
                                    ),
                            ) {
                                Row(
                                    Modifier.fillMaxWidth().height(SongRowHeight)
                                        .pressable(
                                            onLongClick = { menuForSong = song.id; actions.haptic() },
                                            onClick = { openSongMenu(song) },
                                        )
                                        .padding(start = Space.gutter, end = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    val full = model.songById(song.id)
                                    if (full != null) {
                                        Cover(full, 48.dp, corner = 8.dp)
                                    } else {
                                        Box(
                                            Modifier.size(48.dp)
                                                .clip(RoundedCornerShape(8.dp))
                                                .background(Fret.colors.surfaceRaised),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            Icon(Icons.Rounded.MusicNote, null, tint = Fret.colors.textMuted, modifier = Modifier.size(22.dp))
                                        }
                                    }
                                    Spacer(Modifier.width(12.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            song.title.ifBlank { "Untitled song" },
                                            style = MaterialTheme.typography.titleMedium,
                                            color = Fret.colors.text,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Text(
                                                song.artist.ifBlank { "Unknown artist" },
                                                style = MaterialTheme.typography.bodySmall,
                                                color = Fret.colors.textSecondary,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                                modifier = Modifier.weight(1f, fill = false),
                                            )
                                            if (!song.shared) {
                                                Spacer(Modifier.width(4.dp))
                                                Icon(Icons.Rounded.VisibilityOff, "Private", tint = Fret.colors.textMuted, modifier = Modifier.size(14.dp))
                                            }
                                        }
                                    }
                                    Box(
                                        Modifier.width(48.dp).height(SongRowHeight)
                                            .pointerInput(song.id, savingOrder) {
                                                detectDragGestures(
                                                    onDragStart = {
                                                        if (!savingOrder) {
                                                            draggingId = song.id
                                                            dragOffsetY = 0f
                                                            reorderBase = order.toList()
                                                            actions.haptic()
                                                        }
                                                    },
                                                    onDragCancel = {
                                                        if (draggingId != null) {
                                                            draggingId = null
                                                            dragOffsetY = 0f
                                                            order.clear()
                                                            order.addAll(reorderBase)
                                                        }
                                                    },
                                                    onDragEnd = { if (draggingId != null) finishDrop() },
                                                    onDrag = { _, amount ->
                                                        if (draggingId != song.id) return@detectDragGestures
                                                        dragOffsetY += amount.y
                                                        val idx = order.indexOfFirst { it.id == draggingId }
                                                        if (idx >= 0) {
                                                            var i = idx
                                                            while (dragOffsetY > rowHPx / 2 && i < order.lastIndex) {
                                                                val t = order[i]
                                                                order[i] = order[i + 1]
                                                                order[i + 1] = t
                                                                i++
                                                                dragOffsetY -= rowHPx
                                                            }
                                                            while (dragOffsetY < -rowHPx / 2 && i > 0) {
                                                                val t = order[i]
                                                                order[i] = order[i - 1]
                                                                order[i - 1] = t
                                                                i--
                                                                dragOffsetY += rowHPx
                                                            }
                                                        }
                                                    },
                                                )
                                            },
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Icon(Icons.Rounded.DragHandle, "Reorder", tint = Fret.colors.textMuted, modifier = Modifier.size(22.dp))
                                    }
                                }
                                DropdownMenu(
                                    expanded = menuForSong == song.id,
                                    onDismissRequest = { menuForSong = null },
                                    containerColor = Fret.colors.surface,
                                ) {
                                    DropdownMenuItem(
                                        text = { Text("Remove from setlist", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                        leadingIcon = { Icon(Icons.Rounded.Delete, null, tint = Fret.colors.danger) },
                                        onClick = { menuForSong = null; removeTarget = song },
                                    )
                                }
                            }
                            if (index < order.lastIndex) RowDivider(start = 80.dp)
                        }
                    }
                    item(key = "add") {
                        Column(Modifier.fillMaxWidth()) {
                            if (order.isEmpty() && d.songs.isEmpty()) {
                                Text(
                                    "No songs yet",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = Fret.colors.textMuted,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.fillMaxWidth().padding(start = Space.gutter, end = Space.gutter, top = 10.dp),
                                )
                            }
                            Row(
                                Modifier.fillMaxWidth()
                                    .pressable { showAdd = true }
                                    .padding(horizontal = Space.gutter, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    Modifier.size(40.dp).clip(CircleShape).background(Fret.colors.surfaceRaised),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Icon(Icons.Rounded.Add, null, tint = Fret.colors.text, modifier = Modifier.size(20.dp))
                                }
                                Spacer(Modifier.width(12.dp))
                                Text(
                                    "Add songs",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = Fret.colors.text,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    val current = detail

    if (showRename && current != null) {
        RenameDialog(
            initial = current.title,
            onDismiss = { showRename = false },
            onSave = { title ->
                showRename = false
                if (title != current.title) applyUpdate(title = title)
            },
        )
    }

    if (showNotes && current != null) {
        NotesDialog(
            initial = current.notes,
            onDismiss = { showNotes = false },
            onSave = { notes ->
                showNotes = false
                if (notes != current.notes) applyUpdate(notes = notes)
            },
        )
    }

    if (showDeleteConfirm && current != null) {
        val title = current.title.ifBlank { "Untitled setlist" }
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            containerColor = Fret.colors.surface,
            title = { Text("Delete setlist?", maxLines = 1, overflow = TextOverflow.Ellipsis) },
            text = {
                Text(
                    "“$title” will be permanently deleted. Its songs stay in your library.",
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteConfirm = false
                    model.act({ Api.deleteSetlist(setlistId) },
                        onError = { actions.toast(it) },
                        onDone = { model.reloadSetlists(); onClose() })
                }) { Text("Delete", color = Fret.colors.danger) }
            },
            dismissButton = { TextButton(onClick = { showDeleteConfirm = false }) { Text("Cancel") } },
        )
    }

    if (showRotateConfirm) {
        AlertDialog(
            onDismissRequest = { showRotateConfirm = false },
            containerColor = Fret.colors.surface,
            title = { Text("New link?", maxLines = 1, overflow = TextOverflow.Ellipsis) },
            text = { Text("The current link stops working and a new one is created.", maxLines = 3, overflow = TextOverflow.Ellipsis) },
            confirmButton = {
                TextButton(onClick = {
                    showRotateConfirm = false
                    toggleShareRotate()
                }) { Text("Make new link") }
            },
            dismissButton = { TextButton(onClick = { showRotateConfirm = false }) { Text("Cancel") } },
        )
    }

    val target = removeTarget
    if (target != null) {
        AlertDialog(
            onDismissRequest = { removeTarget = null },
            containerColor = Fret.colors.surface,
            title = { Text("Remove song?", maxLines = 1, overflow = TextOverflow.Ellipsis) },
            text = {
                Text(
                    "“${target.title.ifBlank { "Untitled song" }}” will be removed from this setlist.",
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    removeTarget = null
                    applyUpdate(songIds = order.map { it.id }.filterNot { it == target.id })
                }) { Text("Remove", color = Fret.colors.danger) }
            },
            dismissButton = { TextButton(onClick = { removeTarget = null }) { Text("Cancel") } },
        )
    }

    if (showShare && current != null) {
        ShareSheet(
            detail = current,
            shareBusy = shareBusy,
            sharingSongs = sharingSongs,
            onToggleShare = { toggleShare(it) },
            onShareAll = { shareAllSongs(it) },
            onRotate = { showRotateConfirm = true },
            onDismiss = { showShare = false },
        )
    }

    if (showAdd && current != null) {
        AddSongsSheet(
            model = model,
            existingIds = order.map { it.id }.toSet(),
            onDismiss = { showAdd = false },
            onAdd = { picked ->
                showAdd = false
                applyUpdate(songIds = order.map { it.id } + picked)
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ShareSheet(
    detail: Setlist,
    shareBusy: Boolean,
    sharingSongs: Boolean,
    onToggleShare: (Boolean) -> Unit,
    onShareAll: (List<SetlistSong>) -> Unit,
    onRotate: () -> Unit,
    onDismiss: () -> Unit,
) {
    val actions = LocalAppActions.current
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Fret.colors.surface,
    ) {
        Column(Modifier.fillMaxWidth().padding(bottom = 24.dp).animateContentSize()) {
            Text(
                "Share setlist",
                style = MaterialTheme.typography.headlineSmall,
                color = Fret.colors.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = Space.gutter),
            )
            Spacer(Modifier.size(8.dp))
            SwitchRow(
                title = "Share as one link",
                checked = detail.shared,
                enabled = !shareBusy,
                onChange = onToggleShare,
            )
            val unshared = detail.songs.filterNot { it.shared }
            if (detail.shared && unshared.isNotEmpty()) {
                RowDivider()
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        plural(unshared.size, "song") + " private",
                        style = MaterialTheme.typography.bodySmall,
                        color = Fret.colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { onShareAll(unshared) }, enabled = !sharingSongs) {
                        Text(if (sharingSongs) "Sharing…" else "Share them", maxLines = 1)
                    }
                }
            }
            val url = detail.shareUrl
            if (detail.shared && url != null) {
                RowDivider()
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    ShareLinkBox(url)
                    Spacer(Modifier.size(8.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        SecondaryButton(
                            "Preview",
                            { actions.openSharedSetlist(url) },
                            modifier = Modifier.weight(1f),
                            icon = Icons.Rounded.Preview,
                        )
                        Box(Modifier.weight(1f).height(46.dp), contentAlignment = Alignment.Center) {
                            Text(
                                "New link",
                                style = MaterialTheme.typography.labelLarge,
                                color = Fret.colors.accent,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.clip(RoundedCornerShape(10.dp))
                                    .pressable(onClick = onRotate)
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RenameDialog(initial: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var title by remember { mutableStateOf(initial) }
    val focus = remember { FocusRequester() }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Fret.colors.surface,
        title = { Text("Rename setlist", maxLines = 1, overflow = TextOverflow.Ellipsis) },
        text = {
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("Title") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (title.trim().isNotEmpty()) onSave(title.trim()) }),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
        },
        confirmButton = {
            TextButton(enabled = title.trim().isNotEmpty(), onClick = { onSave(title.trim()) }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
    LaunchedEffect(Unit) { focus.requestFocus() }
}

@Composable
private fun NotesDialog(initial: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var notes by remember { mutableStateOf(initial) }
    val focus = remember { FocusRequester() }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Fret.colors.surface,
        title = { Text("Notes for students", maxLines = 1, overflow = TextOverflow.Ellipsis) },
        text = {
            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                label = { Text("Notes") },
                minLines = 3,
                maxLines = 6,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onSave(notes.trim()) }),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
        },
        confirmButton = { TextButton(onClick = { onSave(notes.trim()) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
    LaunchedEffect(Unit) { focus.requestFocus() }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddSongsSheet(
    model: AppModel,
    existingIds: Set<String>,
    onDismiss: () -> Unit,
    onAdd: (List<String>) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val picked = remember { mutableStateListOf<String>() }
    var adding by remember { mutableStateOf(false) }
    val candidates = model.songs.filter { s ->
        s.id !in existingIds && (query.isBlank() ||
            s.title.contains(query, ignoreCase = true) || s.artist.contains(query, ignoreCase = true))
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Fret.colors.surface,
    ) {
        Column(Modifier.fillMaxWidth().imePadding().padding(bottom = 24.dp)) {
            Text(
                "Add songs",
                style = MaterialTheme.typography.headlineSmall,
                color = Fret.colors.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = Space.gutter),
            )
            Spacer(Modifier.size(10.dp))
            Box(Modifier.padding(horizontal = Space.gutter)) {
                SearchField(query, { query = it }, "Search songs")
            }
            Spacer(Modifier.size(4.dp))
            if (candidates.isEmpty()) {
                Text(
                    when {
                        model.loading && model.songs.isEmpty() -> "Loading songs…"
                        model.songs.isEmpty() -> "No songs in your library yet."
                        model.songs.all { it.id in existingIds } -> "Every song is already in this setlist."
                        else -> "No matches for “$query”."
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fret.colors.textMuted,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = 28.dp),
                )
            } else {
                LazyColumn(Modifier.heightIn(max = 340.dp)) {
                    itemsIndexed(candidates, key = { _, song -> song.id }) { _, song ->
                        val checked = song.id in picked
                        Row(
                            Modifier.fillMaxWidth()
                                .pressable { if (checked) picked.remove(song.id) else picked.add(song.id) }
                                .padding(horizontal = Space.gutter, vertical = 10.dp)
                                .animateItem(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier.size(24.dp).clip(CircleShape)
                                    .then(
                                        if (checked) Modifier.background(Fret.colors.text)
                                        else Modifier.border(1.5.dp, Fret.colors.outline, CircleShape),
                                    ),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (checked) Icon(Icons.Rounded.Check, null, tint = Fret.colors.background, modifier = Modifier.size(14.dp))
                            }
                            Spacer(Modifier.width(12.dp))
                            Cover(song, 40.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    song.title.ifBlank { "Untitled song" },
                                    style = MaterialTheme.typography.titleMedium,
                                    color = Fret.colors.text,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
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
                }
            }
            Spacer(Modifier.size(12.dp))
            Box(Modifier.padding(horizontal = Space.gutter)) {
                PrimaryButton(
                    if (picked.isEmpty()) "Add songs" else "Add ${plural(picked.size, "song")}",
                    { if (!adding) { adding = true; onAdd(picked.toList()) } },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = picked.isNotEmpty() && !adding,
                    busy = adding,
                )
            }
        }
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
private val SetlistBounds: BoundsTransform = BoundsTransform { _, _ ->
    spring(stiffness = Spring.StiffnessMediumLow, dampingRatio = Spring.DampingRatioNoBouncy)
}

/** First-visit stagger: rows fade in and rise 16dp, ~30ms apart, capped at 8. Runs once, never on scroll. */
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
