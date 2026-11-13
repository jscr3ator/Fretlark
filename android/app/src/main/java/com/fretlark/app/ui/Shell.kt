package com.fretlark.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.EditNote
import androidx.compose.material.icons.rounded.FileUpload
import androidx.compose.material.icons.rounded.QueueMusic
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import dev.chrisbanes.haze.haze
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.fretlark.app.data.Api
import kotlinx.coroutines.launch

/** The whole native app: sign-in, or the four tab pages under the floating tab bar. */
@Composable
fun AppRoot(model: AppModel) {
    // Status and gesture bar icons follow the native theme (the web page sets its own while open).
    val view = androidx.compose.ui.platform.LocalView.current
    val dark = Fret.colors.isDark
    androidx.compose.runtime.SideEffect {
        val window = (view.context as? android.app.Activity)?.window ?: return@SideEffect
        androidx.core.view.WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }
    Box(Modifier.fillMaxSize().background(Fret.colors.background)) {
        AnimatedContent(
            targetState = when { !model.sessionChecked -> 0; !model.signedIn -> 1; else -> 2 },
            transitionSpec = { fadeIn(tween(260)) togetherWith fadeOut(tween(200)) },
            label = "root",
        ) { stage ->
            when (stage) {
                0 -> Box(Modifier.fillMaxSize()) { if (model.loadError != null) Offline(model) else LoadingState() }
                1 -> SignInScreen(model)
                else -> Tabs(model)
            }
        }
    }
}

@Composable
private fun Offline(model: AppModel) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        EmptyState(Icons.Rounded.QueueMusic, "You're offline", model.loadError ?: "Check your connection.") {
            PrimaryButton("Try again", { model.checkSession() })
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Tabs(model: AppModel) {
    val pager = rememberPagerState { Tab.entries.size }
    // What the frosted tab bar blurs: the pages scrolling underneath it.
    val blur = remember { dev.chrisbanes.haze.HazeState() }
    val scope = rememberCoroutineScope()
    val actions = LocalAppActions.current
    var creating by remember { mutableStateOf(false) }
    var namingSetlist by remember { mutableStateOf(false) }

    // The bar slides away while scrolling down a list and comes back on the way up.
    var barHidden by remember { mutableStateOf(false) }
    val scrollWatcher = remember {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (available.y < -6f) barHidden = true else if (available.y > 6f) barHidden = false
                return Offset.Zero
            }
        }
    }
    LaunchedEffect(pager.currentPage) { barHidden = false }
    val density = LocalDensity.current
    val hide by animateFloatAsState(if (barHidden) 1f else 0f, spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessMediumLow), label = "bar")

    // Back from another tab jumps straight Home instead of sliding through the pages in between.
    BackHandler(enabled = pager.currentPage != 0) { scope.launch { pager.scrollToPage(0) } }

    Box(Modifier.fillMaxSize()) {
        HorizontalPager(
            state = pager,
            beyondViewportPageCount = 1,
            modifier = Modifier.fillMaxSize().nestedScroll(scrollWatcher).haze(blur),
            key = { it },
        ) { page ->
            // Pages ease back slightly as they slide away, so a swipe has depth instead of a flat slide.
            Box(Modifier.fillMaxSize().graphicsLayer {
                val off = kotlin.math.abs((pager.currentPage - page) + pager.currentPageOffsetFraction).coerceIn(0f, 1f)
                val s = 1f - 0.05f * off
                scaleX = s; scaleY = s
                alpha = 1f - 0.35f * off
            }) {
                when (Tab.entries[page]) {
                    Tab.Home -> HomeScreen(model) { tab -> scope.launch { pager.animateScrollToPage(tab.ordinal) } }
                    Tab.Songs -> SongsScreen(model)
                    Tab.Setlists -> SetlistsScreen(model)
                    Tab.Settings -> SettingsScreen(model)
                }
            }
        }

        UploadPill(
            upload = model.upload,
            onPlay = { model.upload = null; actions.openPlayer(it) },
            onDismiss = { model.upload = null },
            modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 10.dp + 64.dp + 12.dp),
        )

        FloatingNavBar(
            position = pager.currentPage + pager.currentPageOffsetFraction,
            onSelect = { scope.launch { pager.animateScrollToPage(it, animationSpec = spring(dampingRatio = 0.82f, stiffness = 380f)) } },
            onScrub = { p ->
                val page = p.toInt().coerceIn(0, Tab.entries.size - 1)
                pager.requestScrollToPage(page, (p - page).coerceIn(-0.5f, 0.999f))
            },
            onRelease = { scope.launch { pager.animateScrollToPage(it, animationSpec = spring(dampingRatio = 0.7f, stiffness = 420f)) } },
            onCreate = { creating = true },
            haze = blur,
            modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 10.dp)
                .graphicsLayer {
                    translationY = hide * with(density) { 120.dp.toPx() }
                    alpha = 1f - hide * 0.6f
                },
        )
    }

    model.openSongId?.let { id -> SongSheet(id, model, onDismiss = { model.openSongId = null }) }

    if (creating) {
        ModalBottomSheet(onDismissRequest = { creating = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Fret.colors.surface) {
            Column(Modifier.fillMaxWidth().padding(bottom = 28.dp)) {
                Text("Create", style = MaterialTheme.typography.headlineSmall, color = Fret.colors.text, modifier = Modifier.padding(horizontal = Space.gutter, vertical = 4.dp))
                Spacer(Modifier.height(10.dp))
                CreateOption(Icons.Rounded.FileUpload, "Upload a song") { creating = false; actions.importSong() }
                CreateOption(Icons.Rounded.EditNote, "Write a new song") { creating = false; actions.newSong() }
                CreateOption(Icons.Rounded.QueueMusic, "New setlist") { creating = false; namingSetlist = true }
            }
        }
    }

    if (namingSetlist) {
        var title by remember { mutableStateOf("") }
        var busy by remember { mutableStateOf(false) }
        val focus = remember { FocusRequester() }
        LaunchedEffect(Unit) { focus.requestFocus() }
        AlertDialog(
            onDismissRequest = { if (!busy) namingSetlist = false },
            containerColor = Fret.colors.surface,
            title = { Text("New setlist") },
            text = {
                OutlinedTextField(title, { title = it.take(120) }, singleLine = true, placeholder = { Text("Spring recital") },
                    shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().focusRequester(focus),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Fret.colors.accent, unfocusedBorderColor = Fret.colors.outline))
            },
            confirmButton = {
                TextButton(enabled = title.isNotBlank() && !busy, onClick = {
                    busy = true
                    model.act({ Api.createSetlist(title.trim()) }, onError = { busy = false; actions.toast(it) }) {
                        namingSetlist = false
                        model.reloadSetlists()
                        scope.launch { pager.animateScrollToPage(Tab.Setlists.ordinal) }
                        actions.toast("Setlist created")
                    }
                }) { Text("Create") }
            },
            dismissButton = { TextButton({ namingSetlist = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun CreateOption(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, onClick: () -> Unit) {
    ListRow(title = title, onClick = onClick, leading = {
        Box(Modifier.size(44.dp).background(Fret.colors.surfaceRaised, RoundedCornerShape(13.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Fret.colors.text, modifier = Modifier.size(23.dp))
        }
    })
}
