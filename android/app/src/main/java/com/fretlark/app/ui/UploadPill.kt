package com.fretlark.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** A floating pill that follows an upload from "Adding…" to "Added", with Play once it's in. */
@Composable
fun UploadPill(upload: Upload?, onPlay: (com.fretlark.app.data.Song) -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    // Keep the last value while the pill slides away.
    val last = remember { arrayOfNulls<Upload>(1) }
    if (upload != null) last[0] = upload
    AnimatedVisibility(
        visible = upload != null,
        modifier = modifier,
        enter = slideInVertically(spring(dampingRatio = 0.72f, stiffness = 420f)) { it * 2 } + fadeIn(tween(160)),
        exit = slideOutVertically(tween(220)) { it * 2 } + fadeOut(tween(180)),
    ) {
        val u = upload ?: last[0] ?: return@AnimatedVisibility
        Row(
            Modifier.padding(horizontal = Space.gutter).fillMaxWidth().height(60.dp)
                .shadow(20.dp, RoundedCornerShape(30.dp), ambientColor = Color.Black.copy(alpha = 0.10f), spotColor = Color.Black.copy(alpha = 0.16f))
                .clip(RoundedCornerShape(30.dp)).background(Fret.colors.navBar)
                .border(0.6.dp, Fret.colors.outline, RoundedCornerShape(30.dp))
                .pressable(onClick = { if (u.phase == Upload.Phase.Done && u.song != null) onPlay(u.song) else onDismiss() })
                .padding(start = 8.dp, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AnimatedContent(u.phase, transitionSpec = { (fadeIn(tween(180)) + scaleIn(initialScale = 0.8f)) togetherWith fadeOut(tween(120)) }, label = "lead") { phase ->
                Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                    when {
                        phase == Upload.Phase.Done && u.song != null -> Cover(u.song, 44.dp, corner = 22.dp)
                        phase == Upload.Phase.Done -> Icon(Icons.Rounded.Check, null, tint = Fret.colors.text, modifier = Modifier.size(26.dp))
                        phase == Upload.Phase.Failed -> Icon(Icons.Rounded.ErrorOutline, null, tint = Fret.colors.danger, modifier = Modifier.size(26.dp))
                        else -> CircularProgressIndicator(Modifier.size(24.dp), color = Fret.colors.text, strokeWidth = 2.5.dp, trackColor = Fret.colors.surfaceRaised)
                    }
                }
            }
            Column(Modifier.weight(1f).padding(start = 10.dp), verticalArrangement = Arrangement.Center) {
                AnimatedContent(u.phase to u.name, transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) using SizeTransform(clip = false) }, label = "text") { (phase, _) ->
                    Column {
                        Text(
                            when (phase) {
                                Upload.Phase.Reading -> "Reading file"
                                Upload.Phase.Uploading -> "Adding to your songs"
                                Upload.Phase.Done -> "Added"
                                Upload.Phase.Failed -> "Couldn't add this file"
                            } + if (u.left > 0 && phase != Upload.Phase.Failed) " · ${u.left} more" else "",
                            style = MaterialTheme.typography.labelMedium, color = if (phase == Upload.Phase.Failed) Fret.colors.danger else Fret.colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            if (phase == Upload.Phase.Failed) u.error.orEmpty() else (u.song?.displayTitle ?: u.name),
                            style = MaterialTheme.typography.titleSmall, color = Fret.colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            if (u.phase == Upload.Phase.Done && u.song != null) {
                Box(Modifier.size(40.dp).clip(CircleShape).background(Fret.colors.text), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.PlayArrow, "Play", tint = Fret.colors.background, modifier = Modifier.size(24.dp))
                }
            }
        }
    }
}
