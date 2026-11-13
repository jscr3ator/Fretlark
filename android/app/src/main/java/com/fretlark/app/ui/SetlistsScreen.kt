package com.fretlark.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.QueueMusic
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fretlark.app.data.Api
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun SetlistsScreen(model: AppModel) {
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    // Entrance plays once per visit, even when coming back from a setlist page.
    var enter by rememberSaveable { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        if (enter) { delay(650); enter = false }
    }
    // Opened from Home: show that setlist straight away.
    LaunchedEffect(model.pendingSetlistId) {
        model.pendingSetlistId?.let { openId = it; model.pendingSetlistId = null }
    }
    if (openId != null) BackHandler { openId = null }
    SharedTransitionLayout {
        AnimatedContent(
            targetState = openId,
            // The cover flies between grid and page (shared element); everything else just cross-fades,
            // so nothing slides across and hides the flight.
            transitionSpec = {
                (fadeIn(tween(280, delayMillis = 60)) + androidx.compose.animation.scaleIn(tween(320), initialScale = 0.98f)) togetherWith
                    fadeOut(tween(180))
            },
            label = "setlist-nav",
        ) { id ->
            if (id == null) {
                SetlistList(
                    model = model,
                    onOpen = { openId = it },
                    enter = enter,
                    sharedScope = this@SharedTransitionLayout,
                    visibilityScope = this@AnimatedContent,
                )
            } else {
                SetlistDetail(
                    model = model,
                    setlistId = id,
                    onClose = { openId = null },
                    sharedScope = this@SharedTransitionLayout,
                    visibilityScope = this@AnimatedContent,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalSharedTransitionApi::class)
@Composable
private fun SetlistList(
    model: AppModel,
    onOpen: (String) -> Unit,
    enter: Boolean,
    sharedScope: SharedTransitionScope,
    visibilityScope: AnimatedVisibilityScope,
) {
    val actions = LocalAppActions.current
    var showCreate by rememberSaveable { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize().background(Fret.colors.background)) {
        PullToRefreshBox(
            isRefreshing = model.loading && model.setlists.isNotEmpty(),
            onRefresh = { model.refresh() },
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
        ) {
            if (model.setlists.isEmpty()) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(bottom = Space.navClearance),
                ) {
                    item(key = "header") {
                        PageHeader(title = "Setlists") {
                            CircleIconButton(Icons.Rounded.Add, "New setlist", onClick = { showCreate = true })
                        }
                    }
                    when {
                        model.loading -> item(key = "loading") {
                            Box(Modifier.fillMaxWidth().height(240.dp)) { LoadingState() }
                        }
                        model.loadError != null -> item(key = "error") {
                            EmptyState(
                                icon = Icons.Rounded.QueueMusic,
                                title = "Couldn't load setlists",
                                message = model.loadError.orEmpty(),
                                action = { PrimaryButton("Try again", { model.refresh() }) },
                            )
                        }
                        else -> item(key = "empty") {
                            EmptyState(
                                icon = Icons.Rounded.QueueMusic,
                                title = "No setlists yet",
                                message = "Group songs and share them with one link.",
                            ) {
                                PrimaryButton("New setlist", { showCreate = true })
                            }
                        }
                    }
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(
                        start = Space.gutter,
                        end = Space.gutter,
                        bottom = Space.navClearance,
                    ),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    item(span = { GridItemSpan(maxLineSpan) }, key = "header") {
                        Row(
                            Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 8.dp).animateItem(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "Setlists",
                                style = MaterialTheme.typography.displaySmall,
                                color = Fret.colors.text,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                            Spacer(Modifier.width(8.dp))
                            CircleIconButton(Icons.Rounded.Add, "New setlist", onClick = { showCreate = true })
                        }
                    }
                    itemsIndexed(model.setlists, key = { _, s -> s.id }) { index, s ->
                        val covers = remember(s.id, model.setlistSongIds) { model.setlistSongs(s.id) }
                        with(sharedScope) {
                            Column(
                                Modifier.animateItem()
                                    .enterReveal(index, enter)
                                    .pressable(onClick = { onOpen(s.id) }),
                            ) {
                                BoxWithConstraints(
                                    Modifier.fillMaxWidth()
                                        .sharedElement(
                                            rememberSharedContentState(key = "setlist-cover-${s.id}"),
                                            animatedVisibilityScope = visibilityScope,
                                            boundsTransform = SetlistBounds,
                                        )
                                ) {
                                    SetlistCover(covers, maxWidth, corner = 16.dp)
                                }
                                Spacer(Modifier.size(8.dp))
                                Text(
                                    s.title.ifBlank { "Untitled setlist" },
                                    style = MaterialTheme.typography.titleSmall,
                                    color = Fret.colors.text,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (s.songCount > 0) {
                                        Text(
                                            plural(s.songCount, "song"),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = Fret.colors.textMuted,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                            modifier = Modifier.weight(1f, fill = false),
                                        )
                                    }
                                    if (s.shared) {
                                        Spacer(Modifier.width(4.dp))
                                        Icon(Icons.Rounded.Link, "Shared", tint = Fret.colors.textMuted, modifier = Modifier.size(12.dp))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showCreate) {
        CreateSetlistDialog(
            busy = creating,
            onDismiss = { if (!creating) showCreate = false },
            onCreate = { title ->
                if (!creating) {
                    creating = true
                    model.act({ Api.createSetlist(title) },
                        onError = { creating = false; actions.toast(it) },
                        onDone = { creating = false; showCreate = false; model.reloadSetlists(); onOpen(it.id) })
                }
            },
        )
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
private val SetlistBounds: BoundsTransform = BoundsTransform { _, _ ->
    spring(stiffness = Spring.StiffnessMediumLow, dampingRatio = Spring.DampingRatioNoBouncy)
}

/** First-visit stagger: items fade in and rise 16dp, ~30ms apart, capped at 8. Runs once, never on scroll. */
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

@Composable
private fun CreateSetlistDialog(busy: Boolean, onDismiss: () -> Unit, onCreate: (String) -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Fret.colors.surface,
        title = { Text("New setlist", maxLines = 1, overflow = TextOverflow.Ellipsis) },
        text = {
            OutlinedTextField(
                value = title,
                onValueChange = { title = it.take(120) },
                label = { Text("Title") },
                singleLine = true,
                enabled = !busy,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (!busy && title.trim().isNotEmpty()) onCreate(title.trim()) }),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
        },
        confirmButton = {
            TextButton(enabled = title.trim().isNotEmpty() && !busy, onClick = { onCreate(title.trim()) }) {
                Text(if (busy) "Creating…" else "Create")
            }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Cancel") } },
    )
    LaunchedEffect(Unit) { focus.requestFocus() }
}
