package com.fretlark.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fretlark.app.data.Api
import com.fretlark.app.data.ApiError
import kotlinx.coroutines.launch

private enum class SignInMode { SignIn, Create }

/** The signed-out screen: sign in, create an account, and the two-factor code step. */
@Composable
fun SignInScreen(model: AppModel) {
    val actions = LocalAppActions.current
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val registrationOpen = model.session?.registrationOpen != false

    var mode by remember { mutableStateOf(SignInMode.SignIn) }
    var identifier by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var challenge by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var showForgot by remember { mutableStateOf(false) }

    LaunchedEffect(registrationOpen) {
        if (!registrationOpen && mode == SignInMode.Create) mode = SignInMode.SignIn
    }

    fun reportFailure(e: Exception) {
        error = (e as? ApiError)?.message ?: "Something went wrong. Please try again."
    }

    fun submitCode() {
        if (busy) return
        val pending = challenge ?: return
        focus.clearFocus()
        if (code.length != 6) {
            error = "Enter the 6-digit code from your authenticator app."
            return
        }
        error = null
        busy = true
        scope.launch {
            try {
                Api.verifyCode(pending, code)
                model.signedInNow()
            } catch (e: Exception) {
                reportFailure(e)
            } finally {
                busy = false
            }
        }
    }

    fun submit() {
        if (busy) return
        focus.clearFocus()
        val id = identifier.trim()
        if (id.isEmpty() || password.isEmpty()) {
            error = if (mode == SignInMode.Create) {
                "Enter your email and password."
            } else {
                "Enter your email or username and password."
            }
            return
        }
        if (mode == SignInMode.Create && password != confirmPassword) {
            error = "Those passwords don't match."
            return
        }
        error = null
        busy = true
        if (mode == SignInMode.Create) {
            scope.launch {
                try {
                    Api.register(id, password)
                    model.signedInNow()
                } catch (e: Exception) {
                    reportFailure(e)
                } finally {
                    busy = false
                }
            }
        } else {
            scope.launch {
                try {
                    val pending = Api.login(id, password)
                    if (pending != null) {
                        challenge = pending
                        code = ""
                    } else {
                        model.signedInNow()
                    }
                } catch (e: Exception) {
                    reportFailure(e)
                } finally {
                    busy = false
                }
            }
        }
    }

    Box(Modifier.fillMaxSize().background(Fret.colors.background)) {
        // A soft wash behind the mark, fading into the page.
        Box(
            Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .fillMaxHeight(0.45f)
                .background(Brush.verticalGradient(listOf(Fret.colors.surfaceRaised, Fret.colors.background))),
        )

        Box(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding(),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                Modifier
                    .widthIn(max = 440.dp)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Space.gutter, vertical = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                // The app icon itself (vector, so it stays sharp at any size).
                Box(
                    Modifier
                        .size(88.dp)
                        .shadow(18.dp, RoundedCornerShape(24.dp), ambientColor = Color.Black.copy(alpha = 0.18f), spotColor = Color.Black.copy(alpha = 0.22f))
                        .clip(RoundedCornerShape(24.dp))
                        .background(Brush.linearGradient(listOf(Color(0xFF1C1C22), Color(0xFF08080B)))),
                    contentAlignment = Alignment.Center,
                ) {
                    androidx.compose.foundation.Image(
                        androidx.compose.ui.res.painterResource(com.fretlark.app.R.drawable.ic_launcher_foreground),
                        contentDescription = null,
                        modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = 1.2f; scaleY = 1.2f },
                    )
                }
                Spacer(Modifier.height(20.dp))
                Text(
                    "Fretlark",
                    style = MaterialTheme.typography.displaySmall,
                    color = Fret.colors.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "Your tabs, your students, one link.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fret.colors.textSecondary,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(28.dp))

                if (registrationOpen && challenge == null) {
                    ModeToggle(mode, enabled = !busy) { next ->
                        if (next != mode) {
                            mode = next
                            error = null
                            password = ""
                            confirmPassword = ""
                            focus.clearFocus()
                        }
                    }
                    Spacer(Modifier.height(20.dp))
                }

                if (challenge != null) {
                    Text(
                        "Two-factor authentication",
                        style = MaterialTheme.typography.titleMedium,
                        color = Fret.colors.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Enter the 6-digit code from your authenticator app.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Fret.colors.textSecondary,
                        textAlign = TextAlign.Center,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(16.dp))
                    OutlinedTextField(
                        value = code,
                        onValueChange = { error = null; code = it.filter(Char::isDigit).take(6) },
                        label = { Text("Code", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        singleLine = true,
                        enabled = !busy,
                        shape = RoundedCornerShape(16.dp),
                        colors = authFieldColors(),
                        textStyle = MaterialTheme.typography.bodyLarge,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submitCode() }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(16.dp))
                    SignInPrimaryButton("Verify", { submitCode() }, Modifier.fillMaxWidth(), busy = busy)
                    InlineError(error)
                    TextButton(
                        onClick = {
                            challenge = null
                            code = ""
                            password = ""
                            error = null
                            focus.clearFocus()
                        },
                        enabled = !busy,
                        modifier = Modifier.padding(top = 4.dp),
                    ) {
                        Text("Back to sign in", style = MaterialTheme.typography.bodySmall, color = Fret.colors.textSecondary)
                    }
                } else {
                    Column(
                        Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        OutlinedTextField(
                            value = identifier,
                            onValueChange = { error = null; identifier = it },
                            label = {
                                Text(
                                    if (mode == SignInMode.Create) "Email" else "Email or username",
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            },
                            singleLine = true,
                            enabled = !busy,
                            shape = RoundedCornerShape(16.dp),
                            colors = authFieldColors(),
                            textStyle = MaterialTheme.typography.bodyLarge,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = if (mode == SignInMode.Create) KeyboardType.Email else KeyboardType.Text,
                                imeAction = ImeAction.Next,
                            ),
                            keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = password,
                            onValueChange = { error = null; password = it },
                            label = { Text("Password", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            singleLine = true,
                            enabled = !busy,
                            shape = RoundedCornerShape(16.dp),
                            colors = authFieldColors(),
                            textStyle = MaterialTheme.typography.bodyLarge,
                            visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                            trailingIcon = {
                                IconButton(onClick = { showPassword = !showPassword }) {
                                    Icon(
                                        if (showPassword) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility,
                                        contentDescription = if (showPassword) "Hide password" else "Show password",
                                        tint = Fret.colors.textMuted,
                                        modifier = Modifier.size(20.dp),
                                    )
                                }
                            },
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = if (mode == SignInMode.Create) ImeAction.Next else ImeAction.Done,
                            ),
                            keyboardActions = KeyboardActions(
                                onNext = { focus.moveFocus(FocusDirection.Down) },
                                onDone = { submit() },
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        AnimatedVisibility(
                            visible = mode == SignInMode.Create,
                            enter = fadeIn() + expandVertically(),
                            exit = fadeOut() + shrinkVertically(),
                        ) {
                            OutlinedTextField(
                                value = confirmPassword,
                                onValueChange = { error = null; confirmPassword = it },
                                label = { Text("Confirm password", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                singleLine = true,
                                enabled = !busy,
                                shape = RoundedCornerShape(16.dp),
                                colors = authFieldColors(),
                                textStyle = MaterialTheme.typography.bodyLarge,
                                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(onDone = { submit() }),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                    Spacer(Modifier.height(18.dp))
                    SignInPrimaryButton(
                        if (mode == SignInMode.Create) "Create account" else "Sign in",
                        { submit() },
                        Modifier.fillMaxWidth(),
                        busy = busy,
                    )
                    InlineError(error)
                    if (mode == SignInMode.SignIn) {
                        TextButton(onClick = { showForgot = true }, modifier = Modifier.padding(top = 2.dp)) {
                            Text("Forgot password?", style = MaterialTheme.typography.bodySmall, color = Fret.colors.textSecondary)
                        }
                    }
                }

                Spacer(Modifier.height(24.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    FooterLink("Privacy") { actions.openOutside(Api.origin + "/privacy.html") }
                    Text("·", style = MaterialTheme.typography.bodySmall, color = Fret.colors.textMuted)
                    FooterLink("Terms") { actions.openOutside(Api.origin + "/terms.html") }
                }
            }
        }
    }

    if (showForgot) {
        ForgotPasswordDialog(
            initial = identifier,
            onDismiss = { showForgot = false },
            onSend = { value ->
                try {
                    Api.forgotPassword(value)
                    showForgot = false
                    actions.toast("If that account exists, we sent a reset link.")
                } catch (e: Exception) {
                    actions.toast((e as? ApiError)?.message ?: "Something went wrong. Please try again.")
                }
            },
        )
    }
}

/**
 * A 44dp segmented pill with a sliding surface thumb. The offset and the label colours animate,
 * so switching between "Sign in" and "Create account" feels like one continuous control.
 */
@Composable
private fun ModeToggle(mode: SignInMode, enabled: Boolean = true, onChange: (SignInMode) -> Unit) {
    GlassSegmented(
        options = listOf("Sign in", "Create account"),
        selected = if (mode == SignInMode.SignIn) 0 else 1,
        onSelect = { onChange(if (it == 0) SignInMode.SignIn else SignInMode.Create) },
        height = 44.dp,
        enabled = enabled,
    )
}

/** The sign-in page's primary action: 54dp tall, 16dp corners, one accent fill. */
@Composable
private fun SignInPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    busy: Boolean = false,
) {
    Row(
        modifier
            .height(54.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Fret.colors.text)
            .pressable(enabled = !busy, onClick = onClick)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (busy) {
            CircularProgressIndicator(
                color = Fret.colors.background,
                strokeWidth = 2.dp,
                modifier = Modifier.size(20.dp),
            )
        } else {
            Text(
                text,
                color = Fret.colors.background,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun InlineError(error: String?) {
    AnimatedVisibility(
        visible = error != null,
        enter = fadeIn() + expandVertically(),
        exit = fadeOut() + shrinkVertically(),
    ) {
        Text(
            error.orEmpty(),
            style = MaterialTheme.typography.bodySmall,
            color = Fret.colors.danger,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        )
    }
}

@Composable
private fun FooterLink(label: String, onClick: () -> Unit) {
    Text(
        label,
        style = MaterialTheme.typography.bodySmall,
        color = Fret.colors.textMuted,
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .pressable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
    )
}

@Composable
private fun ForgotPasswordDialog(initial: String, onDismiss: () -> Unit, onSend: suspend (String) -> Unit) {
    var value by remember { mutableStateOf(initial) }
    var sending by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }

    fun send() {
        val id = value.trim()
        if (id.isEmpty() || sending) return
        sending = true
        scope.launch {
            try {
                onSend(id)
            } finally {
                sending = false
            }
        }
    }

    AlertDialog(
        onDismissRequest = { if (!sending) onDismiss() },
        containerColor = Fret.colors.surface,
        title = {
            Text("Reset password", style = MaterialTheme.typography.headlineSmall, color = Fret.colors.text)
        },
        text = {
            Column {
                Text(
                    "We'll email a reset link if that account exists.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fret.colors.textSecondary,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it },
                    label = { Text("Email or username", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    singleLine = true,
                    enabled = !sending,
                    shape = RoundedCornerShape(16.dp),
                    colors = authFieldColors(),
                    textStyle = MaterialTheme.typography.bodyLarge,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { send() }),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus),
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = !sending && value.isNotBlank(),
                onClick = { send() },
            ) {
                if (sending) {
                    CircularProgressIndicator(
                        color = Fret.colors.text,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(18.dp),
                    )
                } else {
                    Text(
                        "Send link",
                        color = if (value.isBlank()) Fret.colors.textMuted else Fret.colors.text,
                    )
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !sending) {
                Text("Cancel", color = Fret.colors.textSecondary)
            }
        },
    )
    LaunchedEffect(Unit) { focus.requestFocus() }
}

@Composable
private fun authFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Fret.colors.text,
    unfocusedTextColor = Fret.colors.text,
    focusedContainerColor = Fret.colors.surface,
    unfocusedContainerColor = Fret.colors.surfaceRaised,
    disabledContainerColor = Fret.colors.surfaceRaised,
    cursorColor = Fret.colors.text,
    focusedBorderColor = Fret.colors.text.copy(alpha = 0.6f),
    unfocusedBorderColor = Color.Transparent,
    disabledBorderColor = Color.Transparent,
    focusedLabelColor = Fret.colors.textSecondary,
    unfocusedLabelColor = Fret.colors.textMuted,
    focusedTrailingIconColor = Fret.colors.textMuted,
    unfocusedTrailingIconColor = Fret.colors.textMuted,
    focusedPlaceholderColor = Fret.colors.textMuted,
    unfocusedPlaceholderColor = Fret.colors.textMuted,
)
