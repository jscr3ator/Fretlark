package com.fretlark.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Fretlark's palette. Screens read it as `Fret.colors`, never hard-coded colours. */
@Immutable
data class FretColors(
    val background: Color,     // the page behind everything
    val surface: Color,        // cards, rows, sheets
    val surfaceRaised: Color,  // inputs, chips at rest, pressed rows
    val outline: Color,        // hairlines between rows
    val text: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val accent: Color,         // the Fretlark blue
    val accentSoft: Color,     // tinted backgrounds behind accent content
    val onAccent: Color,
    val good: Color,
    val danger: Color,
    val navBar: Color,         // the floating tab bar
    val navSelection: Color,
    val scrim: Color,
    val isDark: Boolean,
)

private val Light = FretColors(
    background = Color(0xFFF6F6F8),
    surface = Color(0xFFFFFFFF),
    surfaceRaised = Color(0xFFE9E9EE),
    outline = Color(0x14000000),
    text = Color(0xFF1D1D1F),
    textSecondary = Color(0xFF5E5E66),
    textMuted = Color(0xFF8E8E96),
    accent = Color(0xFF0A72E8),
    accentSoft = Color(0xFFE3EEFD),
    onAccent = Color.White,
    good = Color(0xFF1F9D55),
    danger = Color(0xFFD7263D),
    navBar = Color(0xFFFFFFFF),
    navSelection = Color(0xFFEFEFF2),
    scrim = Color(0x66000000),
    isDark = false,
)

private val Dark = FretColors(
    background = Color(0xFF000000),
    surface = Color(0xFF1C1C1E),
    surfaceRaised = Color(0xFF2C2C2E),
    outline = Color(0x1FFFFFFF),
    text = Color(0xFFF5F5F7),
    textSecondary = Color(0xFFB4B4BC),
    textMuted = Color(0xFF85858E),
    accent = Color(0xFF3B95FF),
    accentSoft = Color(0xFF15253D),
    onAccent = Color.White,
    good = Color(0xFF3DD07E),
    danger = Color(0xFFFF5468),
    navBar = Color(0xFF1C1C1E),
    navSelection = Color(0xFF2C2C2E),
    scrim = Color(0x99000000),
    isDark = true,
)

/** Spacing and shape tokens, so every screen lines up. */
object Space {
    val gutter = 20.dp       // left/right page margin
    val row = 14.dp          // vertical padding inside a list row
    val gap = 12.dp
    val radius = 18.dp       // cards
    val radiusSmall = 12.dp  // inputs, chips, thumbnails
    val navClearance = 136.dp // bottom padding so content clears the floating tab bar
}

val LocalFretColors = staticCompositionLocalOf { Light }

object Fret {
    val colors: FretColors @Composable get() = LocalFretColors.current
}

/** Inter, the same face as the website, from one variable font file (each weight is a point on its axis). */
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
private fun inter(weight: FontWeight) = androidx.compose.ui.text.font.Font(
    com.fretlark.app.R.font.inter_variable, weight,
    variationSettings = androidx.compose.ui.text.font.FontVariation.Settings(androidx.compose.ui.text.font.FontVariation.weight(weight.weight)),
)

val Inter = androidx.compose.ui.text.font.FontFamily(
    listOf(FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold, FontWeight.ExtraBold, FontWeight.Black).map(::inter),
)

private val type = Typography(
    displaySmall = TextStyle(fontFamily = Inter, fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-1.1).sp),
    // Section headers ("Recently added") and sheet titles.
    headlineMedium = TextStyle(fontFamily = Inter, fontSize = 22.sp, lineHeight = 27.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
    headlineSmall = TextStyle(fontFamily = Inter, fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.3).sp),
    titleMedium = TextStyle(fontFamily = Inter, fontSize = 16.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.1).sp),
    titleSmall = TextStyle(fontFamily = Inter, fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontFamily = Inter, fontSize = 16.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontFamily = Inter, fontSize = 14.sp, lineHeight = 19.sp),
    bodySmall = TextStyle(fontFamily = Inter, fontSize = 13.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontFamily = Inter, fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontFamily = Inter, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontFamily = Inter, fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.4.sp),
)

@Composable
fun FretlarkTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val c = if (dark) Dark else Light
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = c.accent, onPrimary = c.onAccent, background = c.background, onBackground = c.text,
        surface = c.surface, onSurface = c.text, surfaceVariant = c.surfaceRaised, onSurfaceVariant = c.textSecondary,
        outline = c.outline, outlineVariant = c.outline, error = c.danger, surfaceContainerHigh = c.surface,
        surfaceContainer = c.surface, surfaceContainerLow = c.surface, surfaceContainerHighest = c.surfaceRaised,
    )
    androidx.compose.runtime.CompositionLocalProvider(LocalFretColors provides c) {
        MaterialTheme(colorScheme = scheme, typography = type, content = content)
    }
}
