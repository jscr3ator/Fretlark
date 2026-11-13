package com.fretlark.app.data

import org.json.JSONObject

/**
 * What GET security returns: the account's protection state.
 * Identity (username, contact email) comes from [Session]; plan and storage from [Storage].
 */
data class SecurityOverview(
    val activeSessions: Int,
    val mfaEnabled: Boolean,
    val mfaAvailable: Boolean,
    val recoveryCodesLeft: Int,
)

/** A fresh two-factor secret, shown once before it is confirmed. */
data class MfaSetup(val secret: String, val uri: String)

/**
 * Every account action the website offers, called natively instead of in a web view.
 * Request bodies mirror the website's forms exactly (see web/account-settings.js);
 * optional one-time codes are omitted when blank, like the site's JSON encoding does.
 */
object AccountApi {
    suspend fun security(): SecurityOverview = Api.call("GET", "security").let {
        SecurityOverview(
            activeSessions = it.optInt("active_sessions"),
            mfaEnabled = it.optBoolean("mfa_enabled"),
            mfaAvailable = it.optBoolean("mfa_available"),
            recoveryCodesLeft = it.optInt("recovery_codes_remaining"),
        )
    }

    /** Re-authenticates for sensitive actions (the website's "verify it's you" step). */
    suspend fun elevate(password: String, code: String?) {
        val body = JSONObject().put("current_password", password)
        if (!code.isNullOrBlank()) body.put("code", code)
        Api.call("POST", "auth/elevate", body)
    }

    /** Returns the new username. */
    suspend fun setUsername(newUsername: String, password: String): String =
        Api.call("POST", "auth/username", JSONObject()
            .put("new_username", newUsername)
            .put("current_password", password)).optString("email")

    suspend fun changePassword(current: String, next: String) {
        Api.call("POST", "auth/password", JSONObject()
            .put("current_password", current)
            .put("new_password", next))
    }

    /** Creates a replacement recovery key. Returns the key itself, shown once. */
    suspend fun newRecoveryKey(password: String): String =
        Api.call("POST", "auth/recovery-key", JSONObject()
            .put("current_password", password)).optString("recovery_key")

    /** Sets the contact email and sends the confirmation link. */
    suspend fun setEmail(email: String, password: String, code: String?) {
        val body = JSONObject().put("email", email).put("current_password", password)
        if (!code.isNullOrBlank()) body.put("code", code)
        Api.call("POST", "auth/email-set", body)
    }

    /** Resends the confirmation link to the address already on the account. */
    suspend fun resendEmail() {
        Api.call("POST", "auth/email-resend", JSONObject())
    }

    suspend fun removeEmail() {
        Api.call("POST", "auth/email-remove", JSONObject())
    }

    suspend fun mfaStart(): MfaSetup =
        Api.call("POST", "auth/mfa-start", JSONObject()).let {
            MfaSetup(secret = it.optString("secret"), uri = it.optString("uri"))
        }

    /** Confirms setup. Returns the one-time recovery codes. */
    suspend fun mfaConfirm(code: String): List<String> =
        Api.call("POST", "auth/mfa-confirm", JSONObject().put("code", code)).codes()

    suspend fun mfaDisable() {
        Api.call("POST", "auth/mfa-disable", JSONObject())
    }

    /** Replaces the recovery codes. Returns the new codes. */
    suspend fun mfaRecovery(): List<String> =
        Api.call("POST", "auth/mfa-recovery", JSONObject()).codes()

    suspend fun signOutOthers() {
        Api.call("POST", "security", JSONObject().put("scope", "others"))
    }

    suspend fun signOutEverywhere() {
        Api.call("POST", "security", JSONObject().put("scope", "all"))
    }

    /** Step one of deleting an account with a confirmed email: sends the 6-digit code. */
    suspend fun deleteCode(confirm: String, password: String, code: String?) {
        val body = JSONObject().put("confirm", confirm).put("current_password", password)
        if (!code.isNullOrBlank()) body.put("code", code)
        Api.call("POST", "auth/delete-account-code", body)
    }

    /** Deletes the account. [deleteCode] is the emailed code, when the account has one. */
    suspend fun deleteAccount(confirm: String, password: String, code: String?, deleteCode: String?) {
        val body = JSONObject().put("confirm", confirm).put("current_password", password)
        if (!code.isNullOrBlank()) body.put("code", code)
        if (!deleteCode.isNullOrBlank()) body.put("delete_code", deleteCode)
        Api.call("POST", "auth/delete-account", body)
    }

    private fun JSONObject.codes(): List<String> {
        val arr = optJSONArray("recovery_codes") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { arr.optString(it).takeIf { c -> c.isNotBlank() } }
    }
}
