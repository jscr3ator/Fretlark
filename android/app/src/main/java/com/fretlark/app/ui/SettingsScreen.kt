package com.fretlark.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Devices
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.MailOutline
import androidx.compose.material.icons.rounded.NorthEast
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fretlark.app.BuildConfig
import com.fretlark.app.data.AccountApi
import com.fretlark.app.data.Api
import com.fretlark.app.data.SecurityOverview
import com.fretlark.app.data.Storage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class SettingsSheet { Username, Email, Password, Mfa, RecoveryKey, Sessions, Delete }

/** The account page: who is signed in, security, appearance and about. Everything is native. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(model: AppModel) {
    val actions = LocalAppActions.current
    val scope = rememberCoroutineScope()
    val session = model.session
    val storage = model.storage
    var sec by remember { mutableStateOf<SecurityOverview?>(null) }
    var sheet by remember { mutableStateOf<SettingsSheet?>(null) }
    var showSignOut by remember { mutableStateOf(false) }
    val elevate = remember { ElevateController() }
    val entered = remember { mutableSetOf<String>() }

    fun reloadSecurity() {
        scope.launch { runCatching { sec = AccountApi.security() } }
    }
    LaunchedEffect(Unit) { runCatching { sec = AccountApi.security() } }
    fun changed() {
        model.signedInNow()
        reloadSecurity()
    }

    val username = session?.email.orEmpty()
    val contact = session?.contactEmail?.takeIf { it.isNotBlank() }
    val verified = session?.contactEmailVerified == true
    val mailEnabled = session?.mailEnabled == true
    val name = username.ifBlank { "Signed in" }
    val emailLine = contact ?: username.ifBlank { "Not signed in" }
    val mfa = sec?.mfaEnabled == true

    Box(Modifier.fillMaxSize().background(Fret.colors.background)) {
        PullToRefreshBox(
            isRefreshing = model.loading,
            onRefresh = { model.refresh(); reloadSecurity() },
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = Space.navClearance),
            ) {
                item(key = "header") {
                    Column(
                        Modifier.entrance(entered, "header", 0).animateItem().fillMaxWidth()
                            .padding(top = 12.dp, bottom = 10.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Box(
                            Modifier.size(76.dp).clip(CircleShape).background(Fret.colors.surfaceRaised),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                name.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
                                color = Fret.colors.text,
                                maxLines = 1,
                            )
                        }
                        Spacer(Modifier.height(10.dp))
                        Text(
                            name,
                            style = MaterialTheme.typography.headlineSmall,
                            color = Fret.colors.text,
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = Space.gutter),
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            emailLine,
                            style = MaterialTheme.typography.bodyMedium,
                            color = Fret.colors.textSecondary,
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = Space.gutter),
                        )
                    }
                }

                item(key = "account") {
                    Column(Modifier.entrance(entered, "account", 1).animateItem()) {
                        Spacer(Modifier.height(12.dp))
                        AccountRow(Icons.Rounded.Person, "Username", username.ifBlank { null }, onClick = { sheet = SettingsSheet.Username })
                        Hairline()
                        if (mailEnabled) {
                            EmailRow(contact = contact, verified = verified, onClick = { sheet = SettingsSheet.Email })
                            Hairline()
                        }
                        AccountRow(Icons.Rounded.Star, "Plan", storage?.let { if (it.plan == "plus") "Plus" else "Free" })
                        if (storage != null) {
                            Hairline()
                            StorageRow(storage)
                        }
                    }
                }

                item(key = "security") {
                    Column(Modifier.entrance(entered, "security", 2).animateItem()) {
                        Spacer(Modifier.height(26.dp))
                        AccountRow(Icons.Rounded.Lock, "Password", onClick = { sheet = SettingsSheet.Password })
                        Hairline()
                        AccountRow(Icons.Rounded.Fingerprint, "Two-factor", sec?.let { if (it.mfaEnabled) "On" else "Off" }, onClick = { sheet = SettingsSheet.Mfa })
                        Hairline()
                        AccountRow(Icons.Rounded.Key, "Recovery key", onClick = { sheet = SettingsSheet.RecoveryKey })
                        Hairline()
                        AccountRow(
                            Icons.Rounded.Devices,
                            "Sessions",
                            sec?.let { plural(it.activeSessions, "session") },
                            onClick = { sheet = SettingsSheet.Sessions },
                        )
                    }
                }

                item(key = "appearance") {
                    Column(Modifier.entrance(entered, "appearance", 3).animateItem()) {
                        Spacer(Modifier.height(26.dp))
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 54.dp).padding(horizontal = Space.gutter, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Rounded.Palette, null, tint = Fret.colors.text, modifier = Modifier.size(22.dp))
                            Spacer(Modifier.width(14.dp))
                            Text(
                                "Appearance",
                                style = MaterialTheme.typography.bodyLarge,
                                color = Fret.colors.text,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                            AppearanceSegments(current = model.appearance, onSelect = { model.appearance = it })
                        }
                    }
                }

                item(key = "about") {
                    Column(Modifier.entrance(entered, "about", 4).animateItem()) {
                        Spacer(Modifier.height(26.dp))
                        ExternalRow(Icons.Rounded.Shield, "Privacy") { actions.openOutside(Api.origin + "/privacy.html") }
                        Hairline()
                        ExternalRow(Icons.Rounded.Description, "Terms") { actions.openOutside(Api.origin + "/terms.html") }
                    }
                }

                item(key = "signout") {
                    Column(Modifier.entrance(entered, "signout", 5).animateItem()) {
                        Spacer(Modifier.height(26.dp))
                        PlainRow("Sign out", color = Fret.colors.text) { showSignOut = true }
                        PlainRow("Delete account", color = Fret.colors.danger) { sheet = SettingsSheet.Delete }
                    }
                }

                item(key = "version") {
                    Text(
                        "Fretlark ${BuildConfig.VERSION_NAME}",
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                        color = Fret.colors.textMuted,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.entrance(entered, "version", 6).fillMaxWidth().padding(top = 22.dp),
                    )
                }
            }
        }
    }

    when (sheet) {
        SettingsSheet.Username -> UsernameSheet(
            current = username, mfaEnabled = mfa, elevate = elevate,
            onClose = { sheet = null },
            onDone = { sheet = null; changed() },
        )
        SettingsSheet.Email -> EmailSheet(
            contact = contact, verified = verified, mfaEnabled = mfa, elevate = elevate,
            onClose = { sheet = null },
            onChanged = ::changed,
        )
        SettingsSheet.Password -> PasswordSheet(
            mfaEnabled = mfa, elevate = elevate,
            onClose = { sheet = null },
            onDone = { sheet = null; changed() },
        )
        SettingsSheet.Mfa -> MfaSheet(
            info = sec, elevate = elevate,
            onClose = { sheet = null },
            onChanged = ::changed,
        )
        SettingsSheet.RecoveryKey -> RecoveryKeySheet(
            elevate = elevate, mfaEnabled = mfa,
            onClose = { sheet = null },
        )
        SettingsSheet.Sessions -> SessionsSheet(
            info = sec, elevate = elevate, model = model,
            onClose = { sheet = null },
            onChanged = ::changed,
        )
        SettingsSheet.Delete -> DeleteSheet(
            username = username, contactEmail = contact, verified = verified,
            mailEnabled = mailEnabled, mfaEnabled = mfa, elevate = elevate, model = model,
            onClose = { sheet = null },
        )
        null -> {}
    }

    ElevateDialog(elevate)

    if (showSignOut) {
        AlertDialog(
            onDismissRequest = { showSignOut = false },
            containerColor = Fret.colors.surface,
            title = {
                Text("Sign out?", style = MaterialTheme.typography.headlineSmall, color = Fret.colors.text, maxLines = 1)
            },
            confirmButton = {
                TextButton(onClick = {
                    showSignOut = false
                    model.signOut()
                }) {
                    Text("Sign out", color = Fret.colors.text, maxLines = 1)
                }
            },
            dismissButton = {
                TextButton(onClick = { showSignOut = false }) {
                    Text("Cancel", color = Fret.colors.textSecondary, maxLines = 1)
                }
            },
        )
    }
}

/** First-appearance motion, matching Home: fade in, lift 16dp, 30ms stagger for the first eight. */
@Composable
private fun Modifier.entrance(seen: MutableSet<String>, slot: String, index: Int): Modifier {
    val progress = remember { Animatable(if (slot in seen) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (progress.value >= 1f) return@LaunchedEffect
        seen += slot
        if (index in 1..7) delay(index * 30L)
        progress.animateTo(
            1f,
            spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow),
        )
    }
    val lift = with(LocalDensity.current) { 16.dp.toPx() }
    return graphicsLayer {
        alpha = progress.value
        translationY = (1f - progress.value) * lift
    }
}

@Composable
private fun Hairline() {
    Box(Modifier.fillMaxWidth().padding(horizontal = Space.gutter).height(0.6.dp).background(Fret.colors.outline))
}

/** A borderless row: ink icon, label, right-aligned value, chevron. */
@Composable
private fun AccountRow(
    icon: ImageVector,
    label: String,
    value: String? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 54.dp)
            .then(if (onClick != null) Modifier.pressable(onClick = onClick) else Modifier)
            .padding(horizontal = Space.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = Fret.colors.text, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(14.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = Fret.colors.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        AccountValue(value)
        if (onClick != null) {
            Spacer(Modifier.width(4.dp))
            Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, tint = Fret.colors.textMuted, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun RowScope.AccountValue(value: String?) {
    if (value != null) {
        Spacer(Modifier.width(12.dp))
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            color = Fret.colors.textSecondary,
            textAlign = TextAlign.End,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 180.dp),
        )
    }
}

@Composable
private fun EmailRow(contact: String?, verified: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 54.dp).pressable(onClick = onClick)
            .padding(horizontal = Space.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.MailOutline, null, tint = Fret.colors.text, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(14.dp))
        Text(
            "Email",
            style = MaterialTheme.typography.bodyLarge,
            color = Fret.colors.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(12.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(
                contact ?: "Add",
                style = MaterialTheme.typography.bodyMedium,
                color = Fret.colors.textSecondary,
                textAlign = TextAlign.End,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (contact != null && !verified) {
                Text(
                    "Not verified",
                    style = MaterialTheme.typography.bodySmall,
                    color = Fret.colors.textMuted,
                    textAlign = TextAlign.End,
                    maxLines = 1,
                )
            }
        }
        Spacer(Modifier.width(4.dp))
        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, tint = Fret.colors.textMuted, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun StorageRow(storage: Storage) {
    val hasLimit = storage.limitBytes > 0
    val target = if (hasLimit) {
        (storage.usedBytes.toFloat() / storage.limitBytes.toFloat()).coerceIn(0f, 1f)
    } else 0f
    val fraction by animateFloatAsState(target, tween(420), label = "storageFill")
    Column(Modifier.fillMaxWidth().padding(horizontal = Space.gutter).padding(top = 12.dp, bottom = 12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Storage, null, tint = Fret.colors.text, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(14.dp))
            Text(
                "Storage",
                style = MaterialTheme.typography.bodyLarge,
                color = Fret.colors.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(12.dp))
            Text(
                if (hasLimit) "${bytes(storage.usedBytes)} of ${bytes(storage.limitBytes)}" else "${bytes(storage.usedBytes)} used",
                style = MaterialTheme.typography.bodyMedium,
                color = Fret.colors.textSecondary,
                textAlign = TextAlign.End,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (hasLimit) {
            Spacer(Modifier.height(10.dp))
            Box(
                Modifier.fillMaxWidth().padding(start = 36.dp).height(4.dp).clip(CircleShape).background(Fret.colors.surfaceRaised),
            ) {
                if (fraction > 0f) {
                    Box(Modifier.fillMaxWidth(fraction).height(4.dp).clip(CircleShape).background(Fret.colors.text))
                }
            }
        }
    }
}

@Composable
private fun AppearanceSegments(current: Appearance, onSelect: (Appearance) -> Unit) {
    val options = Appearance.entries
    GlassSegmented(
        options = listOf("System", "Light", "Dark"),
        selected = options.indexOf(current),
        onSelect = { onSelect(options[it]) },
        modifier = Modifier.width(210.dp),
        height = 34.dp,
    )
}

@Composable
private fun ExternalRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 54.dp).pressable(onClick = onClick)
            .padding(horizontal = Space.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = Fret.colors.text, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(14.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = Fret.colors.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Icon(Icons.Rounded.NorthEast, null, tint = Fret.colors.textMuted, modifier = Modifier.size(17.dp))
    }
}

@Composable
private fun PlainRow(label: String, color: Color, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 50.dp).pressable(onClick = onClick)
            .padding(horizontal = Space.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = color,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
