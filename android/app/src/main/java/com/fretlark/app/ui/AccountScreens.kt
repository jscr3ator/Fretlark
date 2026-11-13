package com.fretlark.app.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fretlark.app.data.AccountApi
import com.fretlark.app.data.ApiError
import com.fretlark.app.data.MfaSetup
import com.fretlark.app.data.SecurityOverview
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * Native account editors. Every row on the settings page opens one of these
 * bottom sheets; nothing ever leaves the app for account work.
 */

// ---------- re-authentication ----------

/**
 * The native "verify it's you" prompt. Sensitive calls run through [withElevateRetry]:
 * on `reauth_required` the prompt collects the password (and authenticator code),
 * calls auth/elevate, then the caller retries.
 */
class ElevateController {
    var open by mutableStateOf(false); private set
    var mfaEnabled by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    private var waiter: CompletableDeferred<Unit>? = null

    /** Shows the prompt; returns true once re-authenticated, false when dismissed. */
    suspend fun prompt(mfa: Boolean): Boolean {
        mfaEnabled = mfa
        error = null
        busy = false
        open = true
        val d = CompletableDeferred<Unit>()
        waiter = d
        return try {
            d.await()
            true
        } catch (_: CancellationException) {
            false
        } finally {
            open = false
            if (waiter === d) waiter = null
        }
    }

    fun cancel() {
        waiter?.cancel(CancellationException("elevate dismissed"))
        waiter = null
        open = false
    }

    internal suspend fun submit(password: String, code: String?): Boolean {
        if (password.isBlank()) {
            error = "Enter your current password."
            return false
        }
        busy = true
        error = null
        try {
            AccountApi.elevate(password, code?.ifBlank { null })
        } catch (e: ApiError) {
            error = e.message ?: "Something went wrong."
            return false
        } catch (_: Exception) {
            error = "Something went wrong. Please try again."
            return false
        } finally {
            busy = false
        }
        waiter?.complete(Unit)
        waiter = null
        open = false
        return true
    }
}

/**
 * Runs [block]; when the server asks for re-authentication the native prompt
 * appears and the call is retried. Returns the result, or null when it failed
 * (the message already went to [onError]) or the user walked away.
 */
suspend fun <T> withElevateRetry(
    elevate: ElevateController,
    mfaEnabled: Boolean,
    onError: (String) -> Unit,
    block: suspend () -> T,
): T? {
    try {
        return block()
    } catch (e: ApiError) {
        if (e.code != "reauth_required") {
            onError(e.message ?: "Something went wrong.")
            return null
        }
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        onError("Something went wrong. Please try again.")
        return null
    }
    if (!elevate.prompt(mfaEnabled)) return null
    return try {
        block()
    } catch (e: ApiError) {
        onError(e.message ?: "Something went wrong.")
        null
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        onError("Something went wrong. Please try again.")
        null
    }
}

@Composable
fun ElevateDialog(controller: ElevateController) {
    if (!controller.open) return
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var hidden by remember { mutableStateOf(true) }
    AlertDialog(
        onDismissRequest = { if (!controller.busy) controller.cancel() },
        containerColor = Fret.colors.surface,
        title = {
            Text("Verify it's you", style = MaterialTheme.typography.headlineSmall, color = Fret.colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
        },
        text = {
            Column {
                AccountField(value = password, onValue = { password = it }, label = "Current password", password = hidden, onTogglePassword = { hidden = !hidden })
                if (controller.mfaEnabled) {
                    Spacer(Modifier.height(10.dp))
                    AccountField(value = code, onValue = { code = it.filter(Char::isDigit).take(40) }, label = "Authenticator code", keyboard = KeyboardType.Number)
                }
                controller.error?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, style = MaterialTheme.typography.bodySmall, color = Fret.colors.danger, maxLines = 3, overflow = TextOverflow.Ellipsis)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { scope.launch { controller.submit(password, code) } }, enabled = !controller.busy) {
                if (controller.busy) CircularProgressIndicator(color = Fret.colors.text, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                else Text("Verify", color = Fret.colors.text, maxLines = 1)
            }
        },
        dismissButton = {
            TextButton(onClick = { controller.cancel() }, enabled = !controller.busy) {
                Text("Cancel", color = Fret.colors.textSecondary, maxLines = 1)
            }
        },
    )
}

// ---------- shared chrome ----------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountSheet(onClose: () -> Unit, title: String, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Fret.colors.surface,
        contentColor = Fret.colors.text,
    ) {
        Column(
            Modifier.fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .imePadding()
                .padding(bottom = 24.dp),
        ) {
            Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).clip(CircleShape).pressable(onClick = onClose), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Close, "Close", tint = Fret.colors.text, modifier = Modifier.size(22.dp))
                }
                Spacer(Modifier.width(4.dp))
                Text(title, style = MaterialTheme.typography.headlineSmall, color = Fret.colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Column(Modifier.fillMaxWidth().padding(horizontal = Space.gutter)) { content() }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountField(
    value: String,
    onValue: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    password: Boolean = false,
    onTogglePassword: (() -> Unit)? = null,
    keyboard: KeyboardType = KeyboardType.Text,
    enabled: Boolean = true,
    error: String? = null,
) {
    Column(modifier) {
        val focus = androidx.compose.ui.platform.LocalFocusManager.current
        OutlinedTextField(
            value = value,
            onValueChange = onValue,
            label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            singleLine = true,
            enabled = enabled,
            isError = error != null,
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (password) KeyboardType.Password else keyboard,
                imeAction = ImeAction.Done,
                autoCorrect = false,
            ),
            keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
            trailingIcon = if (onTogglePassword != null) {
                {
                    IconButton(onClick = onTogglePassword) {
                        Icon(
                            if (password) Icons.Rounded.Visibility else Icons.Rounded.VisibilityOff,
                            if (password) "Show password" else "Hide password",
                            tint = Fret.colors.textMuted,
                        )
                    }
                }
            } else null,
            shape = RoundedCornerShape(14.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = Fret.colors.surfaceRaised,
                unfocusedContainerColor = Fret.colors.surfaceRaised,
                disabledContainerColor = Fret.colors.surfaceRaised,
                errorContainerColor = Fret.colors.surfaceRaised,
                focusedBorderColor = Fret.colors.text,
                unfocusedBorderColor = Color.Transparent,
                disabledBorderColor = Color.Transparent,
                errorBorderColor = Fret.colors.danger,
                cursorColor = Fret.colors.text,
                focusedTextColor = Fret.colors.text,
                unfocusedTextColor = Fret.colors.text,
                disabledTextColor = Fret.colors.textMuted,
                focusedLabelColor = Fret.colors.textSecondary,
                unfocusedLabelColor = Fret.colors.textMuted,
                errorLabelColor = Fret.colors.danger,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        if (error != null) {
            Spacer(Modifier.height(6.dp))
            Text(error, style = MaterialTheme.typography.bodySmall, color = Fret.colors.danger, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** One error line used by the account sheets, under the fields it belongs to. */
@Composable
private fun SheetError(text: String?) {
    if (text == null) return
    Spacer(Modifier.height(8.dp))
    Text(text, style = MaterialTheme.typography.bodySmall, color = Fret.colors.danger, maxLines = 3, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun LoadingRow() {
    Box(Modifier.fillMaxWidth().padding(vertical = 28.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Fret.colors.textMuted, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
    }
}

@Composable
fun InkButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    busy: Boolean = false,
    enabled: Boolean = true,
    danger: Boolean = false,
) {
    val bg = if (danger) Fret.colors.danger else Fret.colors.text
    val fg = if (danger) Color.White else Fret.colors.background
    Row(
        modifier.height(52.dp).clip(CircleShape)
            .background(bg.copy(alpha = if (enabled && !busy) 1f else 0.4f))
            .pressable(enabled = enabled && !busy, onClick = onClick)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (busy) CircularProgressIndicator(color = fg, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
        else Text(text, color = fg, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Selectable secret with a copy button, for keys and codes. */
@Composable
fun SecretBox(text: String, copyLabel: String = "Copy") {
    val actions = LocalAppActions.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Space.radiusSmall)).background(Fret.colors.surfaceRaised).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SelectionContainer(Modifier.weight(1f)) {
            Text(text, style = MaterialTheme.typography.bodyLarge, color = Fret.colors.text)
        }
        Spacer(Modifier.width(8.dp))
        Box(Modifier.size(40.dp).clip(CircleShape).pressable { actions.copy(text, copyLabel) }, contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.ContentCopy, copyLabel, tint = Fret.colors.text, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
fun SavedCheck(checked: Boolean, onChange: (Boolean) -> Unit, label: String) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).pressable { onChange(!checked) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(
            checked = checked,
            onCheckedChange = null,
            colors = CheckboxDefaults.colors(
                checkedColor = Fret.colors.text,
                checkmarkColor = Fret.colors.background,
                uncheckedColor = Fret.colors.textMuted,
            ),
        )
        Spacer(Modifier.width(4.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium, color = Fret.colors.text, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
    }
}

// ---------- username ----------

@Composable
fun UsernameSheet(
    current: String,
    mfaEnabled: Boolean,
    elevate: ElevateController,
    onClose: () -> Unit,
    onDone: (String) -> Unit,
) {
    val actions = LocalAppActions.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(current) }
    var password by remember { mutableStateOf("") }
    var hidden by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit() {
        if (busy) return
        val next = name.trim().lowercase()
        if (next.length < 3) {
            error = "Use 3 to 30 letters, numbers, dots, dashes or underscores."
            return
        }
        if (password.isEmpty()) {
            error = "Enter your current password."
            return
        }
        busy = true
        error = null
        scope.launch {
            try {
                val result = withElevateRetry(elevate, mfaEnabled, onError = { error = it }) {
                    AccountApi.setUsername(next, password)
                }
                if (result != null) {
                    actions.toast("Username changed to $result.")
                    onDone(result)
                }
            } finally {
                busy = false
            }
        }
    }

    AccountSheet(onClose, "Username") {
        AccountField(value = name, onValue = { name = it.take(30); error = null }, label = "New username", keyboard = KeyboardType.Ascii)
        Spacer(Modifier.height(10.dp))
        AccountField(value = password, onValue = { password = it; error = null }, label = "Current password", password = hidden, onTogglePassword = { hidden = !hidden })
        SheetError(error)
        Spacer(Modifier.height(18.dp))
        InkButton("Save", onClick = ::submit, busy = busy, modifier = Modifier.fillMaxWidth())
    }
}

// ---------- email ----------

@Composable
fun EmailSheet(
    contact: String?,
    verified: Boolean,
    mfaEnabled: Boolean,
    elevate: ElevateController,
    onClose: () -> Unit,
    onChanged: () -> Unit,
) {
    val actions = LocalAppActions.current
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf(contact.orEmpty()) }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var hidden by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showRemove by remember { mutableStateOf(false) }
    val hasAddress = !contact.isNullOrBlank()

    fun save() {
        if (busy) return
        val email = address.trim()
        if (!email.contains("@")) {
            error = "Enter a valid email address."
            return
        }
        if (password.isEmpty()) {
            error = "Enter your current password."
            return
        }
        if (mfaEnabled && code.isBlank()) {
            error = "Enter the code from your authenticator."
            return
        }
        busy = true
        error = null
        scope.launch {
            try {
                val done = withElevateRetry(elevate, mfaEnabled, onError = { error = it }) {
                    AccountApi.setEmail(email, password, code.ifBlank { null })
                }
                if (done != null) {
                    actions.toast("We sent a confirmation link to $email. It expires in 24 hours.")
                    onChanged()
                    onClose()
                }
            } finally {
                busy = false
            }
        }
    }

    fun resend() {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                AccountApi.resendEmail()
                actions.toast("We sent a confirmation link to $contact. It expires in 24 hours.")
            } catch (e: ApiError) {
                error = e.message ?: "Something went wrong."
            } catch (_: Exception) {
                error = "Something went wrong. Please try again."
            } finally {
                busy = false
            }
        }
    }

    fun remove() {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                val done = withElevateRetry(elevate, mfaEnabled, onError = { error = it }) {
                    AccountApi.removeEmail()
                }
                if (done != null) {
                    actions.toast("Email removed.")
                    onChanged()
                    onClose()
                }
            } finally {
                busy = false
            }
        }
    }

    AccountSheet(onClose, if (hasAddress) "Change email" else "Add email") {
        AccountField(value = address, onValue = { address = it.take(254) }, label = "Email", keyboard = KeyboardType.Email)
        Spacer(Modifier.height(10.dp))
        AccountField(value = password, onValue = { password = it }, label = "Current password", password = hidden, onTogglePassword = { hidden = !hidden })
        if (mfaEnabled) {
            Spacer(Modifier.height(10.dp))
            AccountField(value = code, onValue = { code = it.take(40) }, label = "Authenticator code")
        }
        SheetError(error)
        Spacer(Modifier.height(18.dp))
        InkButton("Save", onClick = ::save, busy = busy, modifier = Modifier.fillMaxWidth())
        if (hasAddress) {
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                if (!verified) {
                    Text(
                        "Resend link",
                        style = MaterialTheme.typography.labelLarge,
                        color = Fret.colors.text,
                        maxLines = 1,
                        modifier = Modifier.clip(RoundedCornerShape(8.dp)).pressable(enabled = !busy) { resend() }.padding(horizontal = 12.dp, vertical = 10.dp),
                    )
                }
                Text(
                    "Remove",
                    style = MaterialTheme.typography.labelLarge,
                    color = Fret.colors.danger,
                    maxLines = 1,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).pressable(enabled = !busy) { showRemove = true }.padding(horizontal = 12.dp, vertical = 10.dp),
                )
            }
        }
    }

    if (showRemove) {
        AlertDialog(
            onDismissRequest = { showRemove = false },
            containerColor = Fret.colors.surface,
            title = { Text("Remove email?", style = MaterialTheme.typography.headlineSmall, color = Fret.colors.text, maxLines = 1) },
            text = {
                Text(
                    "You will no longer be able to reset your password by email. Your recovery key still works.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fret.colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(onClick = { showRemove = false; remove() }) {
                    Text("Remove", color = Fret.colors.danger, maxLines = 1)
                }
            },
            dismissButton = {
                TextButton(onClick = { showRemove = false }) {
                    Text("Cancel", color = Fret.colors.textSecondary, maxLines = 1)
                }
            },
        )
    }
}

// ---------- password ----------

@Composable
fun PasswordSheet(mfaEnabled: Boolean, elevate: ElevateController, onClose: () -> Unit, onDone: () -> Unit) {
    val actions = LocalAppActions.current
    val scope = rememberCoroutineScope()
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var hidden by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit() {
        if (busy) return
        if (current.isEmpty()) {
            error = "Enter your current password."
            return
        }
        if (next.length < 8 || next.length > 1024) {
            error = "Use a password of 8 to 1024 characters."
            return
        }
        if (next != confirm) {
            error = "New passwords do not match."
            return
        }
        busy = true
        error = null
        scope.launch {
            try {
                val done = withElevateRetry(elevate, mfaEnabled, onError = { error = it }) {
                    AccountApi.changePassword(current, next)
                }
                if (done != null) {
                    actions.toast("Password updated. Other devices have been signed out.")
                    onDone()
                }
            } finally {
                busy = false
            }
        }
    }

    AccountSheet(onClose, "Password") {
        AccountField(value = current, onValue = { current = it }, label = "Current password", password = hidden, onTogglePassword = { hidden = !hidden })
        Spacer(Modifier.height(10.dp))
        AccountField(value = next, onValue = { next = it.take(1024) }, label = "New password", password = hidden, onTogglePassword = { hidden = !hidden })
        Spacer(Modifier.height(10.dp))
        AccountField(value = confirm, onValue = { confirm = it.take(1024) }, label = "Confirm new password", password = true)
        SheetError(error)
        Spacer(Modifier.height(18.dp))
        InkButton("Save", onClick = ::submit, busy = busy, modifier = Modifier.fillMaxWidth())
    }
}

// ---------- two-factor ----------

@Composable
fun MfaSheet(
    info: SecurityOverview?,
    elevate: ElevateController,
    onClose: () -> Unit,
    onChanged: () -> Unit,
) {
    val actions = LocalAppActions.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var overview by remember { mutableStateOf(info) }
    var setup by remember { mutableStateOf<MfaSetup?>(null) }
    var codes by remember { mutableStateOf<List<String>>(emptyList()) }
    var codeInput by remember { mutableStateOf("") }
    var saved by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmOff by remember { mutableStateOf(false) }
    var confirmReplace by remember { mutableStateOf(false) }
    var loadFailed by remember { mutableStateOf(false) }

    fun loadOverview() = scope.launch {
        loadFailed = false
        val result = runCatching { AccountApi.security() }.getOrNull()
        if (result != null) overview = result else loadFailed = true
        onChanged()
    }
    LaunchedEffect(Unit) { if (overview == null) loadOverview() }

    // A failed background refresh keeps the copy on screen instead of flipping the page to "Off".
    fun refresh() = scope.launch {
        runCatching { AccountApi.security() }.getOrNull()?.let { overview = it }
        onChanged()
    }

    fun start() {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                val result = withElevateRetry(elevate, overview?.mfaEnabled == true, onError = { error = it }) {
                    AccountApi.mfaStart()
                }
                if (result != null) {
                    setup = result
                    codeInput = ""
                }
            } finally {
                busy = false
            }
        }
    }

    fun enable() {
        if (busy) return
        if (codeInput.length != 6) {
            error = "Enter the six digits from your authenticator."
            return
        }
        busy = true
        error = null
        scope.launch {
            try {
                val result = withElevateRetry(elevate, false, onError = { error = it }) {
                    AccountApi.mfaConfirm(codeInput)
                }
                if (result != null) {
                    codes = result
                    saved = false
                    setup = null
                    codeInput = ""
                    refresh()
                }
            } finally {
                busy = false
            }
        }
    }

    fun turnOff() {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                val done = withElevateRetry(elevate, true, onError = { error = it }) {
                    AccountApi.mfaDisable()
                }
                if (done != null) {
                    actions.toast("Two-factor turned off.")
                    refresh()
                }
            } finally {
                busy = false
            }
        }
    }

    fun replace() {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                val result = withElevateRetry(elevate, true, onError = { error = it }) {
                    AccountApi.mfaRecovery()
                }
                if (result != null) {
                    codes = result
                    saved = false
                    refresh()
                }
            } finally {
                busy = false
            }
        }
    }

    AccountSheet(onClose, "Two-factor") {
        when {
            codes.isNotEmpty() -> {
                Text(
                    "Save these codes somewhere safe. Each works once.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fret.colors.textSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(12.dp))
                SelectionContainer(Modifier.fillMaxWidth().clip(RoundedCornerShape(Space.radiusSmall)).background(Fret.colors.surfaceRaised).padding(14.dp)) {
                    Text(codes.joinToString("\n"), style = MaterialTheme.typography.bodyLarge, color = Fret.colors.text)
                }
                Spacer(Modifier.height(10.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    Text(
                        "Copy all",
                        style = MaterialTheme.typography.labelLarge,
                        color = Fret.colors.text,
                        maxLines = 1,
                        modifier = Modifier.clip(RoundedCornerShape(8.dp)).pressable { actions.copy(codes.joinToString("\n"), "Codes") }.padding(horizontal = 12.dp, vertical = 10.dp),
                    )
                }
                SavedCheck(checked = saved, onChange = { saved = it }, label = "I saved my codes")
                Spacer(Modifier.height(8.dp))
                InkButton("Done", onClick = onClose, enabled = saved, modifier = Modifier.fillMaxWidth())
            }
            setup != null -> {
                val current = setup
                if (current != null) {
                val grouped = current.secret.chunked(4).joinToString(" ")
                SecretBox(grouped, "Key")
                Spacer(Modifier.height(10.dp))
                Row(
                    Modifier.fillMaxWidth().height(46.dp).clip(RoundedCornerShape(14.dp)).background(Fret.colors.surfaceRaised)
                        .pressable {
                            try {
                                val otp = Uri.parse(current.uri)
                                if (otp.scheme == "otpauth") context.startActivity(Intent(Intent.ACTION_VIEW, otp))
                            } catch (_: ActivityNotFoundException) {
                                actions.toast("No authenticator app found.")
                            }
                        }.padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Icon(Icons.Rounded.OpenInNew, null, tint = Fret.colors.text, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Open authenticator app", color = Fret.colors.text, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.height(10.dp))
                AccountField(value = codeInput, onValue = { codeInput = it.filter(Char::isDigit).take(6); error = null }, label = "Six-digit code", keyboard = KeyboardType.Number)
                SheetError(error)
                Spacer(Modifier.height(18.dp))
                InkButton("Enable", onClick = ::enable, busy = busy, modifier = Modifier.fillMaxWidth())
                }
            }
            else -> {
                val sec = overview
                if (sec == null) {
                    if (loadFailed) {
                        Text(
                            "Couldn't load two-factor settings.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Fret.colors.textSecondary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Spacer(Modifier.height(14.dp))
                        InkButton("Try again", onClick = ::loadOverview, modifier = Modifier.fillMaxWidth())
                    } else {
                        LoadingRow()
                    }
                } else if (sec.mfaEnabled) {
                    val left = sec.recoveryCodesLeft
                    Text(
                        "On · $left unused codes",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Fret.colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    SheetError(error)
                    Spacer(Modifier.height(18.dp))
                    InkButton("Replace codes", onClick = { confirmReplace = true }, busy = busy, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(6.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                        Text(
                            "Turn off",
                            style = MaterialTheme.typography.labelLarge,
                            color = Fret.colors.danger,
                            maxLines = 1,
                            modifier = Modifier.clip(RoundedCornerShape(8.dp)).pressable { confirmOff = true }.padding(horizontal = 12.dp, vertical = 10.dp),
                        )
                    }
                } else {
                    if (!sec.mfaAvailable) {
                        Text(
                            "Setup is temporarily unavailable.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Fret.colors.textSecondary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Spacer(Modifier.height(18.dp))
                    } else {
                        Spacer(Modifier.height(2.dp))
                    }
                    SheetError(error)
                    InkButton("Set up", onClick = ::start, busy = busy, enabled = sec.mfaAvailable, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }

    if (confirmOff) {
        AlertDialog(
            onDismissRequest = { confirmOff = false },
            containerColor = Fret.colors.surface,
            title = { Text("Turn off two-factor?", style = MaterialTheme.typography.headlineSmall, color = Fret.colors.text, maxLines = 1) },
            text = {
                Text(
                    "Your account will be protected by your password alone. Other sessions will be signed out.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fret.colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(onClick = { confirmOff = false; turnOff() }) {
                    Text("Turn off", color = Fret.colors.danger, maxLines = 1)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmOff = false }) {
                    Text("Cancel", color = Fret.colors.textSecondary, maxLines = 1)
                }
            },
        )
    }

    if (confirmReplace) {
        AlertDialog(
            onDismissRequest = { confirmReplace = false },
            containerColor = Fret.colors.surface,
            title = { Text("Replace recovery codes?", style = MaterialTheme.typography.headlineSmall, color = Fret.colors.text, maxLines = 1) },
            text = {
                Text(
                    "Your previous recovery codes will stop working.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fret.colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(onClick = { confirmReplace = false; replace() }) {
                    Text("Replace codes", color = Fret.colors.text, maxLines = 1)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmReplace = false }) {
                    Text("Cancel", color = Fret.colors.textSecondary, maxLines = 1)
                }
            },
        )
    }
}

// ---------- recovery key ----------

@Composable
fun RecoveryKeySheet(elevate: ElevateController, mfaEnabled: Boolean, onClose: () -> Unit) {
    val actions = LocalAppActions.current
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var hidden by remember { mutableStateOf(true) }
    var key by remember { mutableStateOf<String?>(null) }
    var saved by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun create() {
        if (busy) return
        if (password.isEmpty()) {
            error = "Enter your current password."
            return
        }
        busy = true
        error = null
        scope.launch {
            try {
                val result = withElevateRetry(elevate, mfaEnabled, onError = { error = it }) {
                    AccountApi.newRecoveryKey(password)
                }
                if (result != null) {
                    key = result
                    saved = false
                }
            } finally {
                busy = false
            }
        }
    }

    AccountSheet(onClose, "Recovery key") {
        val shown = key
        if (shown == null) {
            AccountField(value = password, onValue = { password = it }, label = "Current password", password = hidden, onTogglePassword = { hidden = !hidden }, error = error)
            Spacer(Modifier.height(18.dp))
            InkButton("Create new key", onClick = ::create, busy = busy, modifier = Modifier.fillMaxWidth())
        } else {
            Text(
                "Keep it somewhere safe. It is shown once.",
                style = MaterialTheme.typography.bodyMedium,
                color = Fret.colors.textSecondary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(12.dp))
            SecretBox(shown, "Key")
            SavedCheck(checked = saved, onChange = { saved = it }, label = "I saved my key")
            Spacer(Modifier.height(8.dp))
            InkButton("Done", onClick = { actions.toast("Recovery key created."); onClose() }, enabled = saved, modifier = Modifier.fillMaxWidth())
        }
    }
}

// ---------- sessions ----------

@Composable
fun SessionsSheet(
    info: SecurityOverview?,
    elevate: ElevateController,
    model: AppModel,
    onClose: () -> Unit,
    onChanged: () -> Unit,
) {
    val actions = LocalAppActions.current
    val scope = rememberCoroutineScope()
    var overview by remember { mutableStateOf(info) }
    // 1 = other devices, 2 = everywhere; one action at a time, and only its button spins.
    var busyAction by remember { mutableStateOf<Int?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmAll by remember { mutableStateOf(false) }
    var loadFailed by remember { mutableStateOf(false) }

    fun loadOverview() = scope.launch {
        loadFailed = false
        val result = runCatching { AccountApi.security() }.getOrNull()
        if (result != null) overview = result else loadFailed = true
        onChanged()
    }
    LaunchedEffect(Unit) { if (overview == null) loadOverview() }

    fun reload() = scope.launch {
        runCatching { AccountApi.security() }.getOrNull()?.let { overview = it }
        onChanged()
    }

    fun signOutOthers() {
        if (busyAction != null) return
        busyAction = 1
        error = null
        scope.launch {
            try {
                val done = withElevateRetry(elevate, overview?.mfaEnabled == true, onError = { error = it }) {
                    AccountApi.signOutOthers()
                }
                if (done != null) {
                    actions.toast("Other sessions signed out.")
                    reload()
                }
            } finally {
                busyAction = null
            }
        }
    }

    fun signOutEverywhere() {
        if (busyAction != null) return
        busyAction = 2
        error = null
        scope.launch {
            try {
                val done = withElevateRetry(elevate, overview?.mfaEnabled == true, onError = { error = it }) {
                    AccountApi.signOutEverywhere()
                }
                if (done != null) model.signOut()
            } finally {
                busyAction = null
            }
        }
    }

    AccountSheet(onClose, "Sessions") {
        val infoNow = overview
        if (infoNow == null) {
            if (loadFailed) {
                Text(
                    "Couldn't load sessions.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fret.colors.textSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(14.dp))
                InkButton("Try again", onClick = ::loadOverview, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(18.dp))
            } else {
                LoadingRow()
            }
        }
        val count = infoNow?.activeSessions
        if (count != null && count > 0) {
            Text(
                plural(count, "session") + ", including this device",
                style = MaterialTheme.typography.bodyMedium,
                color = Fret.colors.textSecondary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(18.dp))
        }
        SheetError(error)
        InkButton("Sign out other devices", onClick = ::signOutOthers, busy = busyAction == 1, enabled = busyAction == null, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        InkButton("Sign out everywhere", onClick = { confirmAll = true }, busy = busyAction == 2, enabled = busyAction == null, danger = true, modifier = Modifier.fillMaxWidth())
    }

    if (confirmAll) {
        AlertDialog(
            onDismissRequest = { confirmAll = false },
            containerColor = Fret.colors.surface,
            title = { Text("Sign out everywhere?", style = MaterialTheme.typography.headlineSmall, color = Fret.colors.text, maxLines = 1) },
            text = {
                Text(
                    "You will need to sign in again on this device and every other device.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fret.colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(onClick = { confirmAll = false; signOutEverywhere() }) {
                    Text("Sign out", color = Fret.colors.danger, maxLines = 1)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmAll = false }) {
                    Text("Cancel", color = Fret.colors.textSecondary, maxLines = 1)
                }
            },
        )
    }
}

// ---------- delete account ----------

@Composable
fun DeleteSheet(
    username: String,
    contactEmail: String?,
    verified: Boolean,
    mailEnabled: Boolean,
    mfaEnabled: Boolean,
    elevate: ElevateController,
    model: AppModel,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var confirm by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var hidden by remember { mutableStateOf(true) }
    var step by remember { mutableStateOf(0) }
    var deleteCode by remember { mutableStateOf("") }
    var cooldown by remember { mutableStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val needsCode = mailEnabled && verified && !contactEmail.isNullOrBlank()

    LaunchedEffect(cooldown) {
        if (cooldown > 0) {
            delay(1000)
            cooldown--
        }
    }

    fun sendCode() {
        if (busy) return
        if (confirm != username) {
            error = "Type your username to confirm deletion."
            return
        }
        if (password.isEmpty()) {
            error = "Enter your current password."
            return
        }
        if (mfaEnabled && code.isBlank()) {
            error = "Enter the code from your authenticator."
            return
        }
        busy = true
        error = null
        scope.launch {
            try {
                val done = withElevateRetry(elevate, mfaEnabled, onError = { error = it }) {
                    AccountApi.deleteCode(confirm, password, code.ifBlank { null })
                }
                if (done != null) {
                    step = 1
                    deleteCode = ""
                    cooldown = 30
                }
            } finally {
                busy = false
            }
        }
    }

    fun finish() {
        if (busy) return
        if (confirm != username) {
            error = "Type your username to confirm deletion."
            return
        }
        if (password.isEmpty()) {
            error = "Enter your current password."
            return
        }
        if (step == 1 && deleteCode.trim().length != 6) {
            error = "Enter the 6-digit code."
            return
        }
        busy = true
        error = null
        scope.launch {
            try {
                val done = withElevateRetry(elevate, mfaEnabled, onError = { error = it }) {
                    AccountApi.deleteAccount(confirm, password, code.ifBlank { null }, deleteCode.trim().ifBlank { null })
                }
                if (done != null) model.signOut()
            } finally {
                busy = false
            }
        }
    }

    fun submit() {
        if (busy) return
        if (step == 0 && needsCode) sendCode() else finish()
    }

    val saveEnabled = when {
        busy -> false
        step == 1 -> deleteCode.trim().length == 6 && confirm == username
        else -> confirm == username && password.isNotEmpty() && (!mfaEnabled || code.isNotBlank())
    }

    AccountSheet(onClose, "Delete account") {
        if (step == 0) {
            Text(
                "This permanently deletes your account and every song in your library. This can't be undone.",
                style = MaterialTheme.typography.bodyMedium,
                color = Fret.colors.textSecondary,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(12.dp))
            AccountField(value = confirm, onValue = { confirm = it }, label = "Type your username to confirm")
            Spacer(Modifier.height(10.dp))
            AccountField(value = password, onValue = { password = it }, label = "Current password", password = hidden, onTogglePassword = { hidden = !hidden })
            if (mfaEnabled) {
                Spacer(Modifier.height(10.dp))
                AccountField(value = code, onValue = { code = it.take(40) }, label = "Authenticator code")
            }
        } else {
            Text(
                "We sent a 6-digit code to $contactEmail.",
                style = MaterialTheme.typography.bodyMedium,
                color = Fret.colors.textSecondary,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(12.dp))
            AccountField(
                value = deleteCode,
                onValue = { deleteCode = it.filter(Char::isDigit).take(6) },
                label = "6-digit code",
                keyboard = KeyboardType.Number,
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                Text(
                    if (cooldown > 0) "Send a new code (${cooldown}s)" else "Send a new code",
                    style = MaterialTheme.typography.labelLarge,
                    color = if (cooldown > 0 || busy) Fret.colors.textMuted else Fret.colors.text,
                    maxLines = 1,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp))
                        .pressable(enabled = cooldown <= 0 && !busy, onClick = ::sendCode)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                )
            }
        }
        SheetError(error)
        Spacer(Modifier.height(18.dp))
        InkButton(
            if (step == 1 || !needsCode) "Delete account permanently" else "Email me a code",
            onClick = ::submit,
            busy = busy,
            enabled = saveEnabled,
            danger = step == 1 || !needsCode,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
