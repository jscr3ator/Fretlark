package com.fretlark.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.horizontalDrag
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.LibraryMusic
import androidx.compose.material.icons.outlined.QueueMusic
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeChild
import kotlin.math.abs
import kotlin.math.roundToInt

private data class NavItem(
    val tab: Tab,
    val on: androidx.compose.ui.graphics.vector.ImageVector,
    val off: androidx.compose.ui.graphics.vector.ImageVector,
)

private val navItems = listOf(
    NavItem(Tab.Home, Icons.Rounded.Home, Icons.Outlined.Home),
    NavItem(Tab.Songs, Icons.Rounded.LibraryMusic, Icons.Outlined.LibraryMusic),
    NavItem(Tab.Setlists, Icons.Rounded.QueueMusic, Icons.Outlined.QueueMusic),
    NavItem(Tab.Settings, Icons.Rounded.Settings, Icons.Outlined.Settings),
)

// A true capsule, with a selection pill whose ends follow the same curve (iOS-style concentric corners).
private val BarShape = RoundedCornerShape(percent = 50)
private val SlotShape = RoundedCornerShape(percent = 50)
private val BarHeight = 64.dp
private val BarElevation = 8.dp
private val BarShadow = Color.Black.copy(alpha = 0.06f)
private val BarShadowSpot = Color.Black.copy(alpha = 0.08f)
private val GlassBlur = 24.dp
private const val GlassNoise = 0.03f

/**
 * The floating tab bar.
 *
 * [position] is the pager's live position (page + offset fraction), so the selection capsule glides
 * with a swipe between pages. Dragging along the bar moves the capsule under the finger and scrubs
 * the pages with it ([onScrub] gets a fractional page); letting go snaps to the nearest tab
 * ([onRelease]). While the capsule travels it stretches slightly toward the direction of travel and
 * squashes back on arrival; the tab it lands on gets a small spring bump.
 */
@Composable
fun FloatingNavBar(
    position: Float,
    onSelect: (Int) -> Unit,
    onScrub: (Float) -> Unit,
    onRelease: (Int) -> Unit,
    onCreate: () -> Unit,
    haze: dev.chrisbanes.haze.HazeState? = null,
    modifier: Modifier = Modifier,
) {
    val haptic = LocalHapticFeedback.current
    val count = navItems.size
    var dragging by remember { mutableStateOf(false) }
    var dragPos by remember { mutableFloatStateOf(0f) }
    val shown = if (dragging) dragPos else position
    val active = shown.roundToInt().coerceIn(0, count - 1)

    val colors = Fret.colors

    // iOS 18 frosted glass: blur the pages scrolling underneath, then lay a soft tint over the blur.
    val glassTint = if (colors.isDark) Color(0xFF1C1C1E).copy(alpha = 0.55f) else Color.White.copy(alpha = 0.55f)
    val glass = remember(colors) {
        HazeStyle(
            backgroundColor = colors.background,
            tint = HazeTint(glassTint),
            blurRadius = GlassBlur,
            noiseFactor = GlassNoise,
        )
    }
    val hairline = if (colors.isDark) Color.White.copy(alpha = 0.08f) else Color.White.copy(alpha = 0.6f)
    val fallbackFill = colors.navBar.copy(alpha = 0.88f)
    val selection = colors.text.copy(alpha = 0.08f)

    // Small pop as a tab becomes the selection, then settle back to rest (not on first layout).
    val bump = remember { Animatable(1f) }
    var settled by remember { mutableStateOf(false) }
    LaunchedEffect(active) {
        if (!settled) {
            settled = true
            return@LaunchedEffect
        }
        bump.snapTo(1.16f)
        bump.animateTo(1f, spring(dampingRatio = 0.36f, stiffness = Spring.StiffnessMediumLow))
    }

    Row(
        modifier.fillMaxWidth().padding(horizontal = Space.gutter),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BoxWithConstraints(
            Modifier.weight(1f).height(BarHeight)
                .shadow(BarElevation, BarShape, ambientColor = BarShadow, spotColor = BarShadowSpot)
                .clip(BarShape)
                .then(if (haze != null) Modifier.hazeChild(haze, BarShape, glass) else Modifier.background(fallbackFill))
                .border(0.5.dp, hairline, BarShape)
                .padding(6.dp),
        ) {
            val density = LocalDensity.current
            val cellPx = with(density) { maxWidth.toPx() } / count
            val gapPx = with(density) { 6.dp.toPx() }

            // Drag anywhere on the bar: the capsule jumps under the finger and follows it.
            val gesture = Modifier.pointerInput(count, cellPx) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    val startX = down.position.x
                    var moved = false
                    var lastTab = (startX / cellPx).toInt().coerceIn(0, count - 1)
                    horizontalDrag(down.id) { change ->
                        if (!moved && abs(change.position.x - startX) > viewConfiguration.touchSlop / 2) {
                            moved = true
                            dragging = true
                        }
                        if (moved) {
                            change.consume()
                            val p = (change.position.x / cellPx - 0.5f).coerceIn(0f, count - 1f)
                            dragPos = p
                            onScrub(p)
                            val tab = p.roundToInt()
                            if (tab != lastTab) {
                                lastTab = tab
                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            }
                        }
                    }
                    if (moved) {
                        val target = dragPos.roundToInt().coerceIn(0, count - 1)
                        dragging = false
                        onRelease(target)
                    }
                }
            }

            // The selection capsule: centred on the live position, stretching toward travel.
            val frac = (shown - active).coerceIn(-0.5f, 0.5f)
            val travel = (abs(frac) * 2f).coerceIn(0f, 1f)
            val pillPx = cellPx - gapPx
            val pillX = (shown + 0.5f) * cellPx - pillPx / 2f
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .offset { IntOffset(pillX.roundToInt(), 0) }
                    .width(with(density) { pillPx.toDp() })
                    .fillMaxHeight()
                    .graphicsLayer {
                        scaleX = 1f + 0.16f * travel
                        scaleY = 1f - 0.05f * travel
                        // Stretch from the centre: the pill is longest halfway between tabs, with no jump.
                        transformOrigin = TransformOrigin(0.5f, 0.5f)
                    }
                    .clip(SlotShape)
                    .background(selection),
            )

            Row(Modifier.fillMaxWidth().fillMaxHeight().then(gesture)) {
                navItems.forEachIndexed { index, item ->
                    // 1 when the capsule sits right on this tab, fading to 0 one tab away.
                    val near = (1f - abs(shown - index)).coerceIn(0f, 1f)
                    val isOn = index == active
                    val tint = lerp(colors.textMuted, colors.text, near)
                    Column(
                        Modifier.weight(1f).fillMaxHeight()
                            .clip(SlotShape)
                            .pressable {
                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                onSelect(index)
                            }
                            .semantics {
                                selected = isOn
                                role = Role.Tab
                                contentDescription = item.tab.label
                            },
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Icon(
                            if (isOn) item.on else item.off,
                            null,
                            tint = tint,
                            modifier = Modifier.size(24.dp).graphicsLayer {
                                val s = if (isOn) bump.value else 1f
                                scaleX = s
                                scaleY = s
                            },
                        )
                        Spacer(Modifier.height(3.dp))
                        Text(
                            item.tab.label,
                            color = tint,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 10.5.sp,
                                lineHeight = 12.sp,
                                fontWeight = FontWeight.Medium,
                                letterSpacing = 0.sp,
                            ),
                            modifier = Modifier.padding(horizontal = 2.dp),
                        )
                    }
                }
            }
        }

        Spacer(Modifier.width(10.dp))
        // Create: a round button beside the bar, same height and material (the ElevenLabs layout).
        Box(
            Modifier.size(BarHeight)
                .shadow(BarElevation, CircleShape, ambientColor = BarShadow, spotColor = BarShadowSpot)
                .clip(CircleShape)
                .then(if (haze != null) Modifier.hazeChild(haze, CircleShape, glass) else Modifier.background(fallbackFill))
                .border(0.5.dp, hairline, CircleShape)
                .pressable {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onCreate()
                }
                .semantics { contentDescription = "Create" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.Add, null, tint = colors.text, modifier = Modifier.size(26.dp))
        }
    }
}
