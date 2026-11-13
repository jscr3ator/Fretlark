package com.fretlark.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.composed
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.IosShare
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.absoluteValue

/*
 * The building blocks every screen uses. Long text is always one or two lines with an ellipsis,
 * never wrapping a row taller or pushing buttons off screen.
 */

/** Big page title with optional subtitle and round action buttons on the right. */
@Composable
fun PageHeader(title: String, subtitle: String? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().padding(start = Space.gutter, end = Space.gutter - 4.dp, top = 12.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.displaySmall, color = Fret.colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = Fret.colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically, content = actions)
    }
}

/** A section header in the Apple Music style: a bold 22sp title and an optional accent action ("See all"). */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(
        modifier.fillMaxWidth().padding(start = Space.gutter, end = Space.gutter - 6.dp, top = 22.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.headlineMedium, color = Fret.colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (action != null && onAction != null) {
            Text(action, style = MaterialTheme.typography.labelLarge, color = Fret.colors.accent, maxLines = 1,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).pressable(onClick = onAction).padding(horizontal = 6.dp, vertical = 4.dp))
        }
    }
}

/** A round icon button (40dp) on a soft surface, as in the page header. */
@Composable
fun CircleIconButton(icon: ImageVector, label: String, onClick: () -> Unit, tint: Color = Fret.colors.text, background: Color = Fret.colors.surface) {
    Box(
        Modifier.size(40.dp).clip(CircleShape).background(background).pressable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(21.dp)) }
}

/** Pill search field. */
@Composable
fun SearchField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    Row(
        modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(22.dp)).background(Fret.colors.surfaceRaised).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Search, null, tint = Fret.colors.textMuted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(placeholder, color = Fret.colors.textMuted, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            BasicTextField(
                value = value, onValueChange = onChange, singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = Fret.colors.text),
                cursorBrush = SolidColor(Fret.colors.accent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (value.isNotEmpty()) Icon(Icons.Rounded.Close, "Clear search", tint = Fret.colors.textMuted,
            modifier = Modifier.size(20.dp).clip(CircleShape).clickable { onChange("") })
    }
}

/** A horizontally scrolling row of filter chips. [counts] is shown after each label when given. */
@Composable
fun <T> FilterChips(options: List<T>, selected: T, label: (T) -> String, onSelect: (T) -> Unit, counts: ((T) -> Int)? = null) {
    LazyRow(contentPadding = PaddingValues(horizontal = Space.gutter), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(options) { option ->
            val on = option == selected
            val bg by animateColorAsState(if (on) Fret.colors.text else Fret.colors.surface, label = "chip")
            val fg by animateColorAsState(if (on) Fret.colors.background else Fret.colors.textSecondary, label = "chipText")
            Row(
                Modifier.height(34.dp).clip(RoundedCornerShape(17.dp)).background(bg)
                    .then(if (on) Modifier else Modifier.border(1.dp, Fret.colors.outline, RoundedCornerShape(17.dp)))
                    .pressable { onSelect(option) }.padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(label(option), color = fg, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium), maxLines = 1)
                counts?.let { Text("  ${it(option)}", color = fg.copy(alpha = 0.6f), style = MaterialTheme.typography.labelMedium) }
            }
        }
    }
}

/** A rounded card that groups rows, like iOS/Android settings groups. */
@Composable
fun Card(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().padding(horizontal = Space.gutter).clip(RoundedCornerShape(Space.radius)).background(Fret.colors.surface), content = content)
}

@Composable
fun RowDivider(start: Dp = 16.dp) {
    Box(Modifier.padding(start = start).fillMaxWidth().height(0.6.dp).background(Fret.colors.outline))
}

/** Small uppercase label above a group. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier, trailing: @Composable (() -> Unit)? = null) {
    Row(modifier.fillMaxWidth().padding(start = Space.gutter + 4.dp, end = Space.gutter, top = 22.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = Fret.colors.textMuted, modifier = Modifier.weight(1f))
        trailing?.invoke()
    }
}


/**
 * One list row: leading content, a title and subtitle that ellipsize, and trailing content.
 * Height stays fixed however long the text is.
 */
@Composable
fun ListRow(
    title: String,
    subtitle: String? = null,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    titleColor: Color = Fret.colors.text,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 60.dp)
            .then(if (onClick != null) Modifier.pressable(onLongClick = onLongClick, onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) { leading(); Spacer(Modifier.width(14.dp)) }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = titleColor, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!subtitle.isNullOrBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Fret.colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (trailing != null) { Spacer(Modifier.width(10.dp)); trailing() }
    }
}

/** A settings-style row with a switch. */
@Composable
fun SwitchRow(title: String, subtitle: String? = null, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    ListRow(title = title, subtitle = subtitle, onClick = if (enabled) ({ onChange(!checked) }) else null, trailing = {
        Switch(checked = checked, onCheckedChange = if (enabled) onChange else null, enabled = enabled,
            colors = SwitchDefaults.colors(checkedTrackColor = if (Fret.colors.isDark) Color(0xFF30D158) else Color(0xFF34C759), checkedThumbColor = Color.White, checkedBorderColor = Color.Transparent,
                uncheckedTrackColor = Fret.colors.textMuted.copy(alpha = 0.38f), uncheckedBorderColor = Color.Transparent, uncheckedThumbColor = Color.White))
    })
}

/** Small rounded status pill, e.g. "Shared" or "Private". */
@Composable
fun Pill(text: String, color: Color = Fret.colors.accent, background: Color = Fret.colors.accentSoft) {
    Text(text, color = color, style = MaterialTheme.typography.labelMedium, maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(background).padding(horizontal = 8.dp, vertical = 3.dp))
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, busy: Boolean = false, icon: ImageVector? = null) {
    Row(
        modifier.height(50.dp).clip(RoundedCornerShape(14.dp))
            .background(if (enabled) Fret.colors.accent else Fret.colors.accent.copy(alpha = 0.45f))
            .pressable(enabled = enabled && !busy, onClick = onClick).padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        if (busy) CircularProgressIndicator(color = Fret.colors.onAccent, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
        else {
            if (icon != null) { Icon(icon, null, tint = Fret.colors.onAccent, modifier = Modifier.size(19.dp)); Spacer(Modifier.width(8.dp)) }
            Text(text, color = Fret.colors.onAccent, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, color: Color = Fret.colors.text) {
    Row(
        modifier.height(46.dp).clip(RoundedCornerShape(14.dp)).background(Fret.colors.surfaceRaised).pressable(onClick = onClick).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) { Icon(icon, null, tint = color, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, color = color, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Shows a share link with Copy and Send buttons. The URL is one line, ellipsized in the middle feel. */
@Composable
fun ShareLinkBox(url: String) {
    val actions = LocalAppActions.current
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Space.radiusSmall)).background(Fret.colors.surfaceRaised).padding(12.dp)) {
        Text(url.substringAfter("://"), style = MaterialTheme.typography.bodySmall, color = Fret.colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryButton("Copy", { actions.copy(url) }, Modifier.weight(1f), icon = Icons.Rounded.ContentCopy)
            SecondaryButton("Send", { actions.share(url) }, Modifier.weight(1f), icon = Icons.Rounded.IosShare)
        }
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, message: String, action: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(Fret.colors.surfaceRaised), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Fret.colors.text, modifier = Modifier.size(30.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text(title, style = MaterialTheme.typography.headlineSmall, color = Fret.colors.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(6.dp))
        Text(message, style = MaterialTheme.typography.bodyMedium, color = Fret.colors.textMuted, textAlign = androidx.compose.ui.text.style.TextAlign.Center, maxLines = 3, overflow = TextOverflow.Ellipsis)
        if (action != null) { Spacer(Modifier.height(20.dp)); action() }
    }
}

@Composable
fun LoadingState() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Fret.colors.textMuted, strokeWidth = 2.5.dp, modifier = Modifier.size(28.dp))
    }
}

/** A clickable that scales down slightly while pressed, with an optional long press. */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
fun Modifier.pressable(enabled: Boolean = true, onLongClick: (() -> Unit)? = null, onClick: () -> Unit): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessHigh), label = "press")
    this.scale(scale).combinedClickable(
        interactionSource = source, indication = androidx.compose.material3.ripple(), enabled = enabled,
        onLongClick = onLongClick, onClick = onClick,
    )
}

/** "3 songs", "1 song". */
fun plural(n: Int, word: String) = "$n $word${if (n == 1) "" else "s"}"

/** "1.2 MB" */
fun bytes(n: Long): String = when {
    n >= 1_000_000_000 -> "%.1f GB".format(n / 1e9)
    n >= 1_000_000 -> "%.1f MB".format(n / 1e6)
    n >= 1_000 -> "${n / 1000} KB"
    else -> "$n B"
}

/** "just now", "5 min ago", "3 days ago", or a date, from an ISO timestamp or epoch millis. */
fun ago(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    val t = iso.toLongOrNull() ?: runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrNull() ?: return ""
    return agoMillis(t)
}

fun agoMillis(t: Long): String {
    val s = (System.currentTimeMillis() - t) / 1000
    return when {
        s < 60 -> "just now"
        s < 3600 -> "${s / 60} min ago"
        s < 86_400 -> "${s / 3600} h ago"
        s < 7 * 86_400 -> plural((s / 86_400).toInt(), "day") + " ago"
        else -> java.text.SimpleDateFormat("MMM d", java.util.Locale.getDefault()).format(java.util.Date(t))
    }
}

/**
 * A frosted segmented control (iOS-style): a translucent track with a glass thumb that springs
 * between options and stretches slightly while it travels. Used for every in-page section switch.
 */
@Composable
fun GlassSegmented(
    options: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    height: androidx.compose.ui.unit.Dp = 36.dp,
    enabled: Boolean = true,
) {
    val colors = Fret.colors
    val position by androidx.compose.animation.core.animateFloatAsState(
        selected.toFloat(),
        androidx.compose.animation.core.spring(dampingRatio = 0.78f, stiffness = 520f),
        label = "segment",
    )
    val track = if (colors.isDark) Color.White.copy(alpha = 0.08f) else Color.Black.copy(alpha = 0.05f)
    val thumb = if (colors.isDark) Color(0xFF3A3A3C).copy(alpha = 0.92f) else Color.White.copy(alpha = 0.96f)
    val edge = if (colors.isDark) Color.White.copy(alpha = 0.10f) else Color.White
    androidx.compose.foundation.layout.BoxWithConstraints(
        modifier.fillMaxWidth().height(height)
            .clip(RoundedCornerShape(percent = 50))
            .background(track)
            .border(0.5.dp, if (colors.isDark) Color.White.copy(alpha = 0.06f) else Color.Black.copy(alpha = 0.04f), RoundedCornerShape(percent = 50))
            .padding(3.dp),
    ) {
        val cell = maxWidth / options.size
        val travel = (kotlin.math.abs(position - kotlin.math.round(position)) * 2f).coerceIn(0f, 1f)
        Box(
            Modifier
                .offset { androidx.compose.ui.unit.IntOffset((cell.toPx() * position).toInt(), 0) }
                .width(cell)
                .fillMaxSize()
                .graphicsLayer { scaleX = 1f + 0.08f * travel; scaleY = 1f - 0.04f * travel }
                .shadow(3.dp, RoundedCornerShape(percent = 50), ambientColor = Color.Black.copy(alpha = 0.10f), spotColor = Color.Black.copy(alpha = 0.14f))
                .clip(RoundedCornerShape(percent = 50))
                .background(thumb)
                .border(0.5.dp, edge, RoundedCornerShape(percent = 50)),
        )
        Row(Modifier.fillMaxSize()) {
            options.forEachIndexed { index, label ->
                val near = (1f - kotlin.math.abs(position - index)).coerceIn(0f, 1f)
                Box(
                    Modifier.weight(1f).fillMaxSize().clip(RoundedCornerShape(percent = 50))
                        .pressable(enabled = enabled) { if (index != selected) onSelect(index) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label,
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium),
                        color = androidx.compose.ui.graphics.lerp(colors.textSecondary, colors.text, near),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}
