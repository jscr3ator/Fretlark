package com.fretlark.app.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fretlark.app.data.Api
import com.fretlark.app.data.ApiError
import com.fretlark.app.data.Session
import com.fretlark.app.data.SetlistSummary
import com.fretlark.app.data.Song
import com.fretlark.app.data.Storage
import kotlinx.coroutines.launch

/** What the app knows about the signed-in account. Screens read it and call its actions. */
class AppModel : ViewModel() {
    var session by mutableStateOf<Session?>(null); private set
    var sessionChecked by mutableStateOf(false); private set
    var songs by mutableStateOf<List<Song>>(emptyList()); private set
    var setlists by mutableStateOf<List<SetlistSummary>>(emptyList()); private set
    var storage by mutableStateOf<Storage?>(null); private set
    /** Song ids in each setlist, in order, for setlist cover collages. Filled after the list loads. */
    var setlistSongIds by mutableStateOf<Map<String, List<String>>>(emptyMap()); private set
    var loading by mutableStateOf(false); private set
    var loadError by mutableStateOf<String?>(null); private set
    /** The upload in progress or just finished, shown as a pill above the tab bar. */
    var upload by mutableStateOf<Upload?>(null)
    /** The song whose menu is open (tapping a song anywhere opens it). */
    var openSongId by mutableStateOf<String?>(null)
    fun openSong(song: Song) { openSongId = song.id }
    /** A setlist to open on the Setlists tab (set from Home; the tab consumes it). */
    var pendingSetlistId by mutableStateOf<String?>(null)
    /** Light/dark choice: System, Light or Dark. Saved on the device by the activity. */
    var appearance by mutableStateOf(Appearance.System)

    val signedIn get() = session?.authenticated == true

    init { checkSession() }

    fun checkSession() = viewModelScope.launch {
        try {
            session = Api.session()
            loadError = null
            if (signedIn) refresh()
        } catch (e: ApiError) {
            loadError = e.message
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            loadError = "Something went wrong. Pull down to try again."
        } finally {
            sessionChecked = true
        }
    }

    /** Reloads songs, setlists and storage together. */
    fun refresh() = viewModelScope.launch {
        if (!signedIn) return@launch
        loading = true
        try {
            songs = Api.songs()
            setlists = Api.setlists()
            loadSetlistSongs()
            storage = runCatching { Api.storage() }.getOrNull()
            loadError = null
        } catch (e: ApiError) {
            if (e.status == 401) session = session?.copy(authenticated = false)
            else loadError = e.message
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            loadError = "Something went wrong. Pull down to try again."
        } finally {
            loading = false
        }
    }

    fun signedInNow() = checkSession()

    fun signOut() = viewModelScope.launch {
        runCatching { Api.logout() }
        session = session?.copy(authenticated = false)
        songs = emptyList(); setlists = emptyList(); storage = null
    }

    /** Puts an updated song in place without reloading the list. */
    fun replaceSong(song: Song) { songs = songs.map { if (it.id == song.id) song else it } }
    fun addSong(song: Song) { songs = listOf(song) + songs.filterNot { it.id == song.id } }
    fun removeSong(id: String) { songs = songs.filterNot { it.id == id } }
    fun reloadSetlists() = viewModelScope.launch { runCatching { setlists = Api.setlists(); loadSetlistSongs() } }

    private fun loadSetlistSongs() = viewModelScope.launch {
        val ids = setlists.associate { s -> s.id to (runCatching { Api.setlist(s.id).songs.map { it.id } }.getOrNull() ?: setlistSongIds[s.id].orEmpty()) }
        setlistSongIds = ids
    }

    fun songById(id: String): Song? = songs.firstOrNull { it.id == id }
    /** The songs of a setlist this app knows about, in setlist order. */
    fun setlistSongs(setlistId: String): List<Song> = setlistSongIds[setlistId].orEmpty().mapNotNull(::songById)

    /**
     * Runs [block] and reports a failure through [onError] instead of throwing. Use for button actions:
     * `model.act({ Api.deleteSong(id) }, onError = toast) { model.removeSong(id) }`.
     */
    fun <T> act(block: suspend () -> T, onError: (String) -> Unit, onDone: (T) -> Unit = {}) = viewModelScope.launch {
        try { onDone(block()) } catch (e: ApiError) { onError(e.message ?: "Something went wrong.") }
        catch (e: Exception) { onError("Something went wrong. Please try again.") }
    }
}

enum class Appearance { System, Light, Dark }

/** One file being added from the picker, "Open with" or the share sheet. */
data class Upload(val name: String, val phase: Phase, val song: Song? = null, val error: String? = null, val left: Int = 0) {
    enum class Phase { Reading, Uploading, Done, Failed }
}

/**
 * Things only the hosting activity can do. Screens get it from `LocalAppActions.current`.
 */
interface AppActions {
    fun openPlayer(song: Song)
    fun openEditor(song: Song)
    fun openVideo(song: Song)        // the scrolling tab video maker
    fun newSong()
    fun importSong()                 // opens the system file picker, then uploads
    fun openSharedSetlist(url: String)
    fun openWebPage(url: String)     // a site page in the in-app web view (account security, plans)
    fun openOutside(url: String)     // the system browser
    fun copy(text: String, label: String = "Link")
    fun share(text: String, title: String? = null)
    fun toast(message: String)
    fun haptic()
}

val LocalAppActions = staticCompositionLocalOf<AppActions> { error("No AppActions") }

/** The four tab pages behind the floating tab bar. */
enum class Tab(val label: String) { Home("Home"), Songs("Songs"), Setlists("Setlists"), Settings("Settings") }
