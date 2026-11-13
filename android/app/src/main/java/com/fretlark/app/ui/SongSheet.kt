package com.fretlark.app.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.outlined.PlaylistAdd
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.fretlark.app.data.Api
import com.fretlark.app.data.Song

/**
 * Everything you can do with one song: play it, make a video, share it, rename it or
 * delete it. The song is read from [AppModel.songs] on every frame, so server updates show up here
 * without reopening the sheet.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SongSheet(songId: String, model: AppModel, onDismiss: () -> Unit) {
    val song = model.songs.firstOrNull { it.id == songId } ?: return
    val actions = LocalAppActions.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var sharing by remember(songId) { mutableStateOf(false) }
    var shareEnabling by remember(songId) { mutableStateOf(false) }
    var rotating by remember(songId) { mutableStateOf(false) }
    var deleting by remember(songId) { mutableStateOf(false) }
    var confirmDelete by remember(songId) { mutableStateOf(false) }
    var confirmRotate by remember(songId) { mutableStateOf(false) }
    var showEdit by remember(songId) { mutableStateOf(false) }
    var setlistOpen by remember(songId) { mutableStateOf(false) }
    var addingId by remember(songId) { mutableStateOf<String?>(null) }

    val shareNow: (String) -> Unit = { url ->
        actions.share(url, song.displayTitle)
        onDismiss()
    }
    val shareTile = {
        val url = song.shareUrl
        if (url != null) {
            shareNow(url)
        } else if (!shareEnabling) {
            shareEnabling = true
            model.act(
                { Api.setSongShared(song.id, true) },
                onError = { message ->
                    shareEnabling = false
                    actions.toast(message)
                },
            ) { updated ->
                model.replaceSong(updated)
                shareEnabling = false
                updated.shareUrl?.let { shareNow(it) }
            }
        }
    }
    val setSharing: (Boolean) -> Unit = { on ->
        if (!sharing) {
            sharing = true
            model.act(
                { Api.setSongShared(song.id, on) },
                onError = { message ->
                    sharing = false
                    actions.toast(message)
                },
            ) { updated ->
                model.replaceSong(updated)
                sharing = false
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        containerColor = Fret.colors.background,
        dragHandle = { BottomSheetDefaults.DragHandle(color = Fret.colors.textMuted.copy(alpha = 0.4f)) },
    ) {
        Column(
            Modifier.fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(bottom = 24.dp),
        ) {
            // ---------- header ----------
            Row(
                Modifier.fillMaxWidth()
                    .padding(horizontal = Space.gutter)
                    .padding(top = 2.dp, bottom = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(56.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .border(0.5.dp, Fret.colors.outline, RoundedCornerShape(8.dp)),
                ) {
                    Cover(song, 56.dp, corner = 0.dp)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        song.displayTitle,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Medium),
                        color = Fret.colors.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        songSub(song),
                        style = MaterialTheme.typography.bodyMedium,
                        color = Fret.colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            Hairline(start = 0.dp)

            // ---------- action row ----------
            Row(
                Modifier.fillMaxWidth()
                    .padding(horizontal = Space.gutter)
                    .padding(top = 16.dp, bottom = 8.dp),
                horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    Modifier.weight(1f).height(48.dp)
                        .clip(RoundedCornerShape(24.dp))
                        .background(Fret.colors.text)
                        .sheetPress {
                            actions.openPlayer(song)
                            onDismiss()
                        }
                        .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                ) {
                    Icon(Icons.Rounded.PlayArrow, contentDescription = null, tint = Fret.colors.background, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "Play",
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium),
                        color = Fret.colors.background,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Row(
                    Modifier.weight(1f).height(48.dp)
                        .clip(RoundedCornerShape(24.dp))
                        .background(Fret.colors.surfaceRaised)
                        .sheetPress {
                            actions.openEditor(song)
                            onDismiss()
                        }
                        .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                ) {
                    Icon(Icons.Outlined.Edit, contentDescription = null, tint = Fret.colors.text, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "Edit",
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium),
                        color = Fret.colors.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            // ---------- plain list ----------
            Column(Modifier.fillMaxWidth().animateContentSize(spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium))) {
                SheetRow(
                    icon = Icons.Outlined.Videocam,
                    label = "Make video",
                    busy = false,
                    onClick = {
                        actions.openVideo(song)
                        onDismiss()
                    },
                )
                Hairline(start = 56.dp)
                SheetRow(
                    icon = Icons.Outlined.IosShare,
                    label = "Share",
                    busy = shareEnabling,
                    onClick = shareTile,
                )
                Hairline(start = 56.dp)
                // Student link + switch
                SheetLinkToggle(
                    checked = song.shared,
                    busy = sharing,
                    onChange = setSharing,
                )
                val url = song.shareUrl
                if (song.shared && url != null) {
                    SheetUrlSubRow(
                        url = url,
                        rotating = rotating,
                        onCopy = { actions.copy(url) },
                        onRotate = { confirmRotate = true },
                    )
                }
                Hairline(start = 56.dp)
                SheetRow(
                    icon = Icons.Outlined.EditNote,
                    label = "Edit details",
                    onClick = { showEdit = true },
                )
                Hairline(start = 56.dp)
                SheetRow(
                    icon = Icons.Outlined.PlaylistAdd,
                    label = "Add to setlist",
                    onClick = { setlistOpen = true },
                )
                Hairline(start = 0.dp)
                SheetRow(
                    icon = Icons.Outlined.Delete,
                    label = "Delete song",
                    danger = true,
                    onClick = { confirmDelete = true },
                )
            }
        }
    }

    if (showEdit) {
        EditDetailsSheet(
            song = song,
            model = model,
            onDismiss = { showEdit = false },
        )
    }

    if (setlistOpen) {
        SetlistPickerSheet(
            songId = songId,
            model = model,
            addingId = addingId,
            onAdding = { addingId = it },
            onDismiss = { if (addingId == null) setlistOpen = false },
            onDone = { setlistOpen = false },
        )
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { if (!deleting) confirmDelete = false },
            containerColor = Fret.colors.surface,
            titleContentColor = Fret.colors.text,
            textContentColor = Fret.colors.textSecondary,
            title = {
                Text(
                    "Delete this song?",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Medium),
                    color = Fret.colors.text,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            },
            text = {
                Text(
                    "“${song.displayTitle}” and its student link will stop working. This can't be undone.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fret.colors.textSecondary,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (!deleting) {
                            deleting = true
                            model.act(
                                { Api.deleteSong(song.id) },
                                onError = { message ->
                                    deleting = false
                                    confirmDelete = false
                                    actions.toast(message)
                                },
                            ) {
                                model.removeSong(song.id)
                                deleting = false
                                confirmDelete = false
                                onDismiss()
                            }
                        }
                    },
                    enabled = !deleting,
                ) {
                    if (deleting) {
                        CircularProgressIndicator(
                            color = Fret.colors.danger,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(18.dp),
                        )
                    } else {
                        Text("Delete", color = Fret.colors.danger, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium))
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }, enabled = !deleting) {
                    Text("Cancel", color = Fret.colors.text, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium))
                }
            },
        )
    }

    if (confirmRotate) {
        AlertDialog(
            onDismissRequest = { if (!rotating) confirmRotate = false },
            containerColor = Fret.colors.surface,
            titleContentColor = Fret.colors.text,
            textContentColor = Fret.colors.textSecondary,
            title = {
                Text(
                    "Make a new link?",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Medium),
                    color = Fret.colors.text,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            },
            text = {
                Text(
                    "The old link stops working. Anyone using it will need the new one.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fret.colors.textSecondary,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (!rotating) {
                            rotating = true
                            confirmRotate = false
                            model.act(
                                { Api.setSongShared(song.id, true, rotate = true) },
                                onError = { message ->
                                    rotating = false
                                    actions.toast(message)
                                },
                            ) { updated ->
                                model.replaceSong(updated)
                                rotating = false
                            }
                        }
                    },
                    enabled = !rotating,
                ) {
                    Text("New link", color = Fret.colors.text, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmRotate = false }, enabled = !rotating) {
                    Text("Cancel", color = Fret.colors.text, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium))
                }
            },
        )
    }
}

/** Artist plus recency, e.g. "Gracie Abrams · Updated 3 min ago". */
private fun songSub(song: Song): String {
    val artist = song.artist.ifBlank { "Unknown artist" }
    val a = ago(song.updatedAt)
    return if (a.isNotBlank()) "$artist · Updated $a" else artist
}

/** One 56dp menu row: outlined 24dp ink icon + Medium bodyLarge label, ripple-free. */
@Composable
private fun SheetRow(
    icon: ImageVector,
    label: String,
    busy: Boolean = false,
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    val tint = if (danger) Fret.colors.danger else Fret.colors.text
    Row(
        Modifier.fillMaxWidth().height(56.dp)
            .sheetPress(onClick = onClick)
            .padding(horizontal = Space.gutter),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) {
            Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Fret.colors.textSecondary, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            }
        } else {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(24.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
            color = tint,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

/** "Student link" row with a small monochrome switch. */
@Composable
private fun SheetLinkToggle(checked: Boolean, busy: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(56.dp)
            .sheetPress(enabled = !busy, onClick = { onChange(!checked) })
            .padding(horizontal = Space.gutter),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Link, contentDescription = null, tint = Fret.colors.text, modifier = Modifier.size(24.dp))
        Spacer(Modifier.width(12.dp))
        Text(
            "Student link",
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
            color = Fret.colors.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (busy) {
            CircularProgressIndicator(color = Fret.colors.textSecondary, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(10.dp))
        }
        Switch(
            checked = checked,
            onCheckedChange = if (busy) null else onChange,
            enabled = !busy,
            colors = SwitchDefaults.colors(
                checkedTrackColor = if (Fret.colors.isDark) Color(0xFF30D158) else Color(0xFF34C759), // iOS green
                checkedThumbColor = Color.White,
                checkedBorderColor = Color.Transparent,
                uncheckedTrackColor = Fret.colors.textMuted.copy(alpha = 0.45f),
                uncheckedBorderColor = Color.Transparent,
                uncheckedThumbColor = Color.White,
            ),
            modifier = Modifier.graphicsLayer(scaleX = 0.78f, scaleY = 0.78f),
        )
    }
}

/** Indented URL sub-row: address plus copy / refresh icon buttons. */
@Composable
private fun SheetUrlSubRow(url: String, rotating: Boolean, onCopy: () -> Unit, onRotate: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(56.dp)
            .padding(start = 56.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            url.substringAfter("://"),
            style = MaterialTheme.typography.bodySmall,
            color = Fret.colors.textSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Box(
            Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).sheetPress(onClick = onCopy),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.ContentCopy, contentDescription = "Copy link", tint = Fret.colors.text, modifier = Modifier.size(20.dp))
        }
        Box(
            Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).sheetPress(enabled = !rotating, onClick = onRotate),
            contentAlignment = Alignment.Center,
        ) {
            if (rotating) {
                CircularProgressIndicator(color = Fret.colors.textSecondary, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            } else {
                Icon(Icons.Outlined.Refresh, contentDescription = "New link", tint = Fret.colors.text, modifier = Modifier.size(20.dp))
            }
        }
    }
}

/** Hairline divider; [start] aligns it with where the row text begins. */
@Composable
private fun Hairline(start: Dp) {
    Box(Modifier.padding(start = start).fillMaxWidth().height(0.5.dp).background(Fret.colors.outline))
}

/** Ripple-free pressed state: rows dim to 60% instead of rippling. */
@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.sheetPress(enabled: Boolean = true, onClick: () -> Unit): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val alpha by animateFloatAsState(
        if (pressed) 0.6f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium),
        label = "sheetPress",
    )
    this.graphicsLayer { this.alpha = alpha }
        .combinedClickable(
            interactionSource = source,
            indication = null,
            enabled = enabled,
            onClick = onClick,
        )
}

/** Setlist picker restyled as a sheet list with 44dp covers and check marks. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SetlistPickerSheet(
    songId: String,
    model: AppModel,
    addingId: String?,
    onAdding: (String?) -> Unit,
    onDismiss: () -> Unit,
    onDone: () -> Unit,
) {
    val actions = LocalAppActions.current
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        containerColor = Fret.colors.surface,
        dragHandle = { BottomSheetDefaults.DragHandle(color = Fret.colors.textMuted.copy(alpha = 0.4f)) },
    ) {
        Column(
            Modifier.fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(bottom = 24.dp),
        ) {
            Text(
                "Add to setlist",
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Medium),
                color = Fret.colors.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = Space.gutter).padding(top = 2.dp, bottom = 8.dp),
            )
            if (model.setlists.isEmpty()) {
                Text(
                    "No setlists yet",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fret.colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = Space.gutter, vertical = 12.dp),
                )
            } else {
                model.setlists.forEachIndexed { index, s ->
                    if (index > 0) Hairline(start = 76.dp)
                    val busy = addingId == s.id
                    val inIt = model.setlistSongIds[s.id]?.contains(songId) == true
                    Row(
                        Modifier.fillMaxWidth().height(64.dp)
                            .sheetPress(enabled = addingId == null) {
                                if (addingId != null) return@sheetPress
                                if (model.setlistSongIds[s.id]?.contains(songId) == true) {
                                    onDone()
                                    actions.toast("Already in ${s.title.ifBlank { "setlist" }}")
                                    return@sheetPress
                                }
                                onAdding(s.id)
                                model.act(
                                    {
                                        val full = Api.setlist(s.id)
                                        val ids = full.songs.map { it.id }
                                        if (ids.contains(songId)) full else Api.updateSetlist(s.id, songIds = ids + songId)
                                    },
                                    onError = { message ->
                                        onAdding(null)
                                        actions.toast(message)
                                    },
                                ) {
                                    onAdding(null)
                                    onDone()
                                    model.reloadSetlists()
                                    actions.toast("Added to ${s.title.ifBlank { "setlist" }}")
                                }
                            }
                            .padding(horizontal = Space.gutter),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        SetlistCover(model.setlistSongs(s.id), 44.dp, corner = 8.dp)
                        Spacer(Modifier.width(12.dp))
                        Text(
                            s.title.ifBlank { "Untitled setlist" },
                            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                            color = Fret.colors.text,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        if (busy) {
                            CircularProgressIndicator(color = Fret.colors.textSecondary, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                        } else if (inIt) {
                            Icon(Icons.Outlined.Check, contentDescription = "Already added", tint = Fret.colors.text, modifier = Modifier.size(20.dp))
                        }
                    }
                }
            }
        }
    }
}

/**
 * A second, focused sheet for the song's text: iOS-style Cancel / Details / Save bar over
 * grouped inset fields, errors shown in place instead of as a toast.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditDetailsSheet(song: Song, model: AppModel, onDismiss: () -> Unit) {
    val focus = LocalFocusManager.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var title by remember(song.id) { mutableStateOf(song.title) }
    var artist by remember(song.id) { mutableStateOf(song.artist) }
    var notes by remember(song.id) { mutableStateOf(song.notes) }
    var saving by remember(song.id) { mutableStateOf(false) }
    var error by remember(song.id) { mutableStateOf<String?>(null) }

    val changed = title.trim() != song.title || artist.trim() != song.artist || notes.trim() != song.notes

    val save = {
        if (!saving && changed) {
            focus.clearFocus()
            error = null
            saving = true
            model.act(
                { Api.updateSong(song, title = title.trim(), artist = artist.trim(), notes = notes.trim()) },
                onError = { message ->
                    saving = false
                    error = message
                },
            ) { updated ->
                model.replaceSong(updated)
                saving = false
                onDismiss()
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!saving) onDismiss() },
        sheetState = sheetState,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        containerColor = Fret.colors.surface,
        dragHandle = { BottomSheetDefaults.DragHandle(color = Fret.colors.textMuted.copy(alpha = 0.4f)) },
    ) {
        Column(
            Modifier.fillMaxWidth()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(start = Space.gutter, end = Space.gutter, top = 12.dp, bottom = 24.dp),
        ) {
            // iOS-style nav bar
            Row(Modifier.fillMaxWidth().height(44.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    Text(
                        "Cancel",
                        style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                        color = Fret.colors.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clip(RoundedCornerShape(8.dp))
                            .sheetPress(enabled = !saving, onClick = { if (!saving) onDismiss() })
                            .padding(horizontal = 4.dp, vertical = 8.dp),
                    )
                }
                Text(
                    "Details",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Medium),
                    color = Fret.colors.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                    if (saving) {
                        CircularProgressIndicator(color = Fret.colors.text, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    } else {
                        Text(
                            "Save",
                            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                            color = if (changed) Fret.colors.text else Fret.colors.textMuted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.clip(RoundedCornerShape(8.dp))
                                .sheetPress(enabled = changed, onClick = save)
                                .padding(horizontal = 4.dp, vertical = 8.dp),
                        )
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            // Grouped inset form: Title + Artist
            Column(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Fret.colors.surfaceRaised),
            ) {
                FormRow(
                    label = "Title",
                    value = title,
                    onValueChange = { title = it; error = null },
                    singleLine = true,
                    imeAction = ImeAction.Next,
                )
                Hairline(start = 16.dp)
                FormRow(
                    label = "Artist",
                    value = artist,
                    onValueChange = { artist = it; error = null },
                    singleLine = true,
                    imeAction = ImeAction.Next,
                )
            }

            Spacer(Modifier.height(12.dp))

            // Notes group
            Column(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Fret.colors.surfaceRaised)
                    .padding(16.dp),
            ) {
                Box(Modifier.fillMaxWidth()) {
                    BasicTextField(
                        value = notes,
                        onValueChange = { notes = it; error = null },
                        singleLine = false,
                        minLines = 4,
                        maxLines = 8,
                        textStyle = MaterialTheme.typography.bodyLarge.copy(color = Fret.colors.text),
                        cursorBrush = SolidColor(Fret.colors.text),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (notes.isEmpty()) {
                        Text(
                            "Add notes",
                            style = MaterialTheme.typography.bodyLarge,
                            color = Fret.colors.textMuted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            if (error != null) {
                Spacer(Modifier.height(12.dp))
                Text(
                    error ?: "",
                    style = MaterialTheme.typography.bodySmall,
                    color = Fret.colors.danger,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }
    }
}

/** One labeled row inside the grouped inset form. */
@Composable
private fun FormRow(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    singleLine: Boolean,
    imeAction: ImeAction,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = Fret.colors.textSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.width(90.dp),
        )
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = singleLine,
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = Fret.colors.text),
            cursorBrush = SolidColor(Fret.colors.text),
            keyboardOptions = KeyboardOptions(imeAction = imeAction),
            modifier = Modifier.weight(1f),
        )
    }
}
