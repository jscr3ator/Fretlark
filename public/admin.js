(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const json = (method, body) => ({method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const defaultSettings = Object.freeze({
    notation: 'both',
    show_mixer: true,
    show_track_controls: true,
    metronome: true,
    count_in: true,
    allow_print: true,
    allow_download: true
  });

  let lessons = [];
  let filter = 'overview';
  let selected = null;
  const localCloudSaves = new Set();
  let librarySelectedId = null;
  let previewKey = null;
  let savingShare = false;
  let files = [];
  let replacement = null;
  const params = new URLSearchParams(location.search);
  // Only same-site paths are followed after sign-in, so a link cannot bounce teachers elsewhere.
  const nextPath = /^\/(?!\/)[\w\-./?=&%]*$/.test(params.get('next') || '') ? params.get('next') : null;
  let recoveryDone = null;
  let authMode = 'login', signupShown = false, localOwner = 'guest', authChallenge = null;
  let lastAuthMode = null;
  let forgotMethod = 'recovery';
  let resetToken = params.get('reset');
  const verifyToken = params.get('verify');
  if (resetToken) removeQueryParam('reset');
  const sessionState = {mailEnabled: false, contactEmail: null, contactEmailAddress: null, contactEmailVerified: false, hasRecoveryKey: null};
  const bannerDismissKeys = {email: 'fretlark-banner-email-dismissed'};
  let emailBannerError = '';
  let accountControls;
  let uploading = false;
  let savingDetails = false;
  let initializing = false;
  let savingPassword = false;
  let registrationOpen = false;
  let detailsSnapshot = '';
  let shareTrackRequest = 0;
  let toastTimer;
  const dialogFocus = new WeakMap();

  async function api(path, options = {}) {
    const response = await fetch(`/api/${path}`, {cache: 'no-store', credentials: 'same-origin', ...options});
    let body = null;
    try { body = await response.json(); } catch { /* Some proxy errors have no JSON body. */ }
    if (!response.ok) throw Object.assign(new Error(body?.error || `Request failed (${response.status}).`), {status: response.status,code:body?.code,retryAfter:Number(response.headers.get('Retry-After'))||null});
    return body;
  }

  function toast(message, error = false) {
    const node = $('toast');
    node.textContent = message;
    node.className = `toast visible${error ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('visible'), 4500);
  }

  function removeQueryParam(name) {
    const url = new URL(location.href);
    if (!url.searchParams.has(name)) return;
    url.searchParams.delete(name);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  function readSession(session) {
    sessionState.mailEnabled = session.mailEnabled === true;
    sessionState.contactEmail = session.contactEmail || null;
    sessionState.contactEmailAddress = session.contactEmailAddress || null;
    sessionState.contactEmailVerified = session.contactEmailVerified === true;
    sessionState.hasRecoveryKey = typeof session.hasRecoveryKey === 'boolean' ? session.hasRecoveryKey : null;
    renderAccountBanners();
    return session;
  }

  async function refreshSession() {
    return readSession(await api('session'));
  }

  function bannerDismissed(kind) {
    try { return sessionStorage.getItem(bannerDismissKeys[kind]) === '1'; } catch { return false; }
  }

  function dismissBanner(kind) {
    try { sessionStorage.setItem(bannerDismissKeys[kind], '1'); } catch { /* Browsing may block session storage. */ }
    renderAccountBanners();
  }

  function renderAccountBanners() {
    const stack = $('banner-stack');
    const signedIn = !$('workspace').hidden;
    const address = sessionState.contactEmailAddress || sessionState.contactEmail;
    // An unconfirmed email always wins, even after its banner is dismissed: never show both.
    const emailEligible = signedIn && Boolean(address) && !sessionState.contactEmailVerified;
    const showEmail = emailEligible && !bannerDismissed('email');

    $('email-banner').hidden = !showEmail;
    $('email-banner').classList.toggle('error', showEmail && Boolean(emailBannerError));
    if (!emailEligible) emailBannerError = '';
    if (showEmail) $('email-banner-text').textContent = emailBannerError || `Confirm your email: we sent a link to ${address}.`;

    // Recovery keys live in Settings > Security; nothing nags about them.
    stack.hidden = !showEmail;
  }

  async function resendEmailConfirmation() {
    const email = sessionState.contactEmailAddress;
    if (!email) return;
    const button = $('email-banner-resend');
    button.disabled = true; button.textContent = 'Sending…';
    try {
      await api('auth/email-resend', json('POST', {}));
      emailBannerError = '';
      toast(`We sent a confirmation link to ${email}. It expires in 24 hours.`);
      await refreshSession();
    } catch (error) {
      if (error.name !== 'AbortError') {
        emailBannerError = error.message || 'The confirmation email could not be sent. Try again.';
        renderAccountBanners();
      }
    } finally {
      button.disabled = false; button.textContent = 'Resend';
    }
  }

  async function handleEmailVerify() {
    if (!verifyToken) return;
    try {
      await api('auth/email-verify', json('POST', {token: verifyToken}));
      removeQueryParam('verify');
      emailBannerError = '';
      try { await refreshSession(); } catch { /* The next init will retry. */ }
      toast("Email confirmed. You're all set.");
    } catch {
      removeQueryParam('verify');
      const message = 'This confirmation link is invalid or has expired.';
      try { await refreshSession(); } catch { /* The next init will retry. */ }
      if (sessionState.contactEmail && !sessionState.contactEmailVerified) {
        emailBannerError = message;
        renderAccountBanners();
      }
      toast(message, true);
    }
  }

  function status(id, message, error = false) {
    const node = $(id);
    node.textContent = message;
    node.classList.toggle('error', error);
  }

  function showAccess() {
    $('access').hidden = false;
  }

  function animateAuthSwap(element) {
    if (!element || !element.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    element.animate([{opacity: 0}, {opacity: 1}], {duration: 180, easing: 'ease-out'});
  }

  function normalizeSettings(value) {
    let settings = value || {};
    if (typeof settings === 'string') {
      try { settings = JSON.parse(settings); } catch { settings = {}; }
    }
    const notation = ['both', 'standard', 'tab', 'slash', 'numbered'].includes(settings.notation) ? settings.notation : defaultSettings.notation;
    const normalized = {notation, allowed_tracks: Array.isArray(settings.allowed_tracks) ? settings.allowed_tracks : null, allowed_notations: Array.isArray(settings.allowed_notations) ? settings.allowed_notations : ['both','standard','tab','slash','numbered']};
    for (const key of Object.keys(defaultSettings).filter(key => key !== 'notation')) {
      normalized[key] = typeof settings[key] === 'boolean' ? settings[key] : defaultSettings[key];
    }
    return normalized;
  }

  function lessonSettings(row = selected) {
    return normalizeSettings(row?.student_settings);
  }

  const authTitles = {login: 'Sign in', register: 'Create account', forgot: 'Reset your password', reset: 'Choose a new password'};
  const authButtons = {login: 'Sign in', register: 'Create account', forgot: 'Reset password', reset: 'Set new password'};
  const authCopy = {
    register: "Use your email and a password. We'll send a link to confirm it.",
    registerNoMail: 'Pick a username and a password. You can create a recovery key later in Settings.',
    forgot: 'Enter your username and the recovery key you saved from Settings.',
    forgotEmail: "Enter your email and we'll send you a reset link.",
    reset: 'Choose a new password. Every device will need to sign in again.',
    login: 'Use your Fretlark account to open your songs and shared links.'
  };
  function authSubmitText() {
    return authMode === 'forgot' && forgotMethod === 'email' ? 'Email me a reset link' : authButtons[authMode];
  }
  function setAuthMode(mode, method) {
    authChallenge = null;
    $('auth-form').hidden = false; $('auth-factor-form').hidden = true; $('auth-factor-code').value = '';
    authMode = mode === 'register' && !registrationOpen ? 'login' : ['register', 'forgot', 'reset'].includes(mode) ? mode : 'login';
    if (authMode === 'forgot') forgotMethod = !sessionState.mailEnabled ? 'recovery' : method === 'recovery' ? 'recovery' : 'email';
    const registering = authMode === 'register', forgot = authMode === 'forgot', reset = authMode === 'reset';
    const forgotEmail = forgot && sessionState.mailEnabled && forgotMethod === 'email', newPassword = registering || reset || (forgot && !forgotEmail);
    $('access-title').textContent = authTitles[authMode];
    $('auth-submit').textContent = authSubmitText();
    $('auth-switch-label').textContent = registering ? 'Already have an account?' : authMode === 'login' ? 'New to Fretlark?' : '';
    $('auth-toggle').textContent = authMode === 'login' ? 'Create an account' : registering ? 'Sign in' : 'Back to sign in';
    $('auth-switch').hidden = authMode === 'login' && !registrationOpen;
    const signupEmail = registering && sessionState.mailEnabled;
    const emailField = signupEmail || forgotEmail;
    $('auth-email').hidden = reset; $('auth-email').required = !reset;
    $('auth-email').placeholder = signupEmail ? 'Email' : forgotEmail ? 'Email' : registering ? 'Choose a username' : sessionState.mailEnabled ? 'Email or username' : 'Username';
    $('auth-email').type = emailField ? 'email' : 'text';
    $('auth-email').autocomplete = emailField ? 'email' : 'username';
    $('auth-email').name = emailField ? 'email' : 'username';
    $('auth-email-label').textContent = signupEmail || forgotEmail ? 'Email' : sessionState.mailEnabled && !registering && !forgot ? 'Email or username' : 'Username';
    $('auth-recovery').hidden = !(forgot && !forgotEmail); $('auth-recovery').required = forgot && !forgotEmail;
    $('auth-password').closest('.password-field').hidden = forgotEmail;
    $('auth-password').required = !forgotEmail;
    $('auth-password').placeholder = newPassword ? 'New password' : 'Password';
    $('auth-password2-wrap').hidden = !newPassword; $('auth-password2').required = newPassword;
    $('forgot-link').hidden = authMode !== 'login';
    $('forgot-recovery-link').hidden = !forgotEmail;
    $('reset-back').hidden = true;
    $('auth-password').autocomplete = newPassword ? 'new-password' : 'current-password';
    $('auth-password').minLength = newPassword ? 8 : 0;
    $('auth-password').type = 'password';
    $('password-toggle').setAttribute('aria-pressed', 'false');
    $('password-toggle').setAttribute('aria-label', 'Show password');
    $('password-hint').hidden = !newPassword;
    const copy = reset ? authCopy.reset : forgotEmail ? authCopy.forgotEmail : forgot ? authCopy.forgot : registering ? (sessionState.mailEnabled ? authCopy.register : authCopy.registerNoMail) : authCopy.login;
    const current = $('access-message').textContent;
    // Keep a server message (legacy note, connection error) when returning to sign in.
    if (copy !== authCopy.login || !current || Object.values(authCopy).includes(current)) $('access-message').textContent = copy;
    status('auth-status', '');
    if (lastAuthMode !== null && lastAuthMode !== authMode) animateAuthSwap($('auth-form'));
    lastAuthMode = authMode;
  }

  function focusDescriptor(element) {
    const row = element?.closest?.('[data-id]');
    return {element, rowId: row?.dataset.id, action: element?.dataset.action};
  }

  function openDialog(dialogId, initialFocusId, restoreTarget = document.activeElement) {
    const dialog = $(dialogId);
    dialogFocus.set(dialog, focusDescriptor(restoreTarget));
    dialog.showModal();
    if (initialFocusId) queueMicrotask(() => $(initialFocusId)?.focus());
  }

  function closeDialog(dialogId) {
    const dialog = $(dialogId);
    if (dialogId === 'password-dialog') $('password-form').reset();
    if (dialog.open) dialog.close();
  }

  function detailsValue() {
    return JSON.stringify(['detail-title', 'detail-artist', 'detail-notation', 'setting-show-mixer', 'setting-track-controls', 'setting-metronome', 'setting-count-in', 'setting-allow-print', 'setting-allow-download'].map(id => {
      const input = $(id);
      return input.type === 'checkbox' ? input.checked : input.value;
    }));
  }

  function hasUnsavedChanges(dialogId) {
    if (dialogId === 'details-dialog') return Boolean(replacement) || detailsValue() !== detailsSnapshot;
    if (dialogId === 'upload-dialog') return files.length > 0;
    if (dialogId === 'password-dialog') return ['current-password','new-password','confirm-password'].some(id => $(id).value);
    return false;
  }

  async function requestDialogClose(dialogId) {
    if(dialogId === 'password-dialog' && savingPassword) return;
    if(accountControls && !accountControls.canClose(dialogId)) return;
    if (hasUnsavedChanges(dialogId) && !await window.appConfirm('Discard unsaved changes?', {ok: 'Discard', danger: true})) return;
    closeDialog(dialogId);
  }

  function restoreDialogFocus(dialog) {
    const target = dialogFocus.get(dialog);
    dialogFocus.delete(dialog);
    if (!target || document.querySelector('dialog[open]')) return;
    queueMicrotask(() => {
      if (target.element?.isConnected && target.element.getClientRects().length) {
        target.element.focus();
        return;
      }
      if (target.rowId && target.action) {
        const row = Array.from($('lesson-list').children).find(item => item.dataset.id === target.rowId);
        const action = Array.from(row?.querySelectorAll('[data-action]') || []).find(item => item.dataset.action === target.action);
        if (action) {
          action.focus();
          return;
        }
      }
      [$('upload-mobile'), $('upload-open'), $('detail-share')].find(element => element?.getClientRects().length)?.focus();
    });
  }

  function wireDialogs() {
    const focusable = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    for (const dialog of document.querySelectorAll('dialog')) {
      dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const items = [...dialog.querySelectorAll(focusable)].filter(element => element.getClientRects().length);
        if (!items.length) return;
        const first = items[0], last = items.at(-1), active = document.activeElement;
        if (event.shiftKey && (active === first || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
      });
      dialog.addEventListener('close', () => {
        if (dialog.id === 'share-dialog') shareTrackRequest++;
        restoreDialogFocus(dialog);
      });
      dialog.addEventListener('cancel', event => {
        event.preventDefault();
        if ((dialog.id === 'upload-dialog' && uploading) || (dialog.id === 'details-dialog' && savingDetails) || (dialog.id === 'share-dialog' && savingShare)) return;
        requestDialogClose(dialog.id);
      });
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
        if (!outside) return;
        if ((dialog.id === 'upload-dialog' && uploading) || (dialog.id === 'details-dialog' && savingDetails) || (dialog.id === 'share-dialog' && savingShare)) return;
        requestDialogClose(dialog.id);
      });
    }
  }

  function shareUrl(lesson) {
    // The desktop app runs from a local address; links people copy must still point at the site.
    return `${window.FRETLARK_ORIGIN || location.origin}/view/${encodeURIComponent(lesson.share_token)}`;
  }

  function embedSnippet(lesson) {
    const title = esc(lesson.title || 'Untitled song');
    return `<iframe src="${window.FRETLARK_ORIGIN || location.origin}/embed/${encodeURIComponent(lesson.share_token)}" width="100%" height="480" style="border:0;border-radius:12px" allow="fullscreen; autoplay" loading="lazy" title="${title} on Fretlark"></iframe>`;
  }

  const relative = new Intl.RelativeTimeFormat(undefined, {numeric: 'auto'});
  function ago(iso) {
    if (!iso) return 'never';
    const seconds = Math.min(0, (new Date(iso) - Date.now()) / 1000);
    for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
      if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
    }
    return 'just now';
  }
  const plural = (count, word) => `${count} ${count === 1 ? word : word + 's'}`;

  const localCoverSource = song => ({id: `local:${song.id}`, title: song.title, artist: song.artist});
  function librarySong(id) {
    if (!id?.startsWith('local:')) return lessons.find(song => song.id === id);
    const song = window.LocalSongs?.list(localOwner).find(song => `local:${song.id}` === id);
    return song && {...localCoverSource(song), local_id: song.id, track_count: song.tracks, bar_count: song.bars, tempo: song.tempo, updated_at: song.updatedAt};
  }
  function coverHtml(lesson, className) {
    return `<span class="${className} cover" style="${coverStyle(lesson)}" data-cover-id="${esc(lesson.id)}" data-cover-key="${esc(JSON.stringify([lesson.id, lesson.title, lesson.artist]))}"><span class="cover-monogram">${monogram(lesson)}</span><img src="/admin-assets/doc.svg" alt=""></span>`;
  }

  // Plain-language summary of what a shared link lets students see and use.
  const notationShort = {tab: 'Tabs', standard: 'Standard', both: 'Tabs + standard', slash: 'Rhythm', numbered: 'Numbered'};
  function accessSummary(lesson) {
    const settings = lessonSettings(lesson), tracks = Number(lesson.track_count) || 0;
    const visible = settings.allowed_tracks === null ? (tracks === 1 ? '1 track' : `All ${tracks} tracks`) : `${settings.allowed_tracks.length} of ${tracks} tracks`;
    const views = settings.allowed_notations.length === 5 ? `opens in ${notationShort[settings.notation]}` : settings.allowed_notations.map(mode => notationShort[mode]).join(', ');
    const extras = [['show_mixer', 'Mixer'], ['metronome', 'Metronome'], ['allow_print', 'Print'], ['allow_download', 'GP download']].filter(([key]) => settings[key]).map(([, name]) => name);
    return {text: `${visible} · ${views}`, extras};
  }

  function renderOverview() {
    $('overview-date').textContent = new Intl.DateTimeFormat(undefined, {weekday: 'long', month: 'long', day: 'numeric'}).format(new Date());
    const recent = lessons.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const latest = recent[0];
    if (latest) {
      const tracks = Number(latest.track_count) || 0, bars = Number(latest.bar_count) || 0, tempo = Number(latest.tempo) || 0;
      const others = recent.slice(1, 6);
      $('resume').innerHTML = `<div class="resume-main">${coverHtml(latest, 'resume-cover')}<div class="resume-copy"><p class="eyebrow" id="resume-title">Last edited ${esc(ago(latest.updated_at))}</p><h2>${esc(latest.title || 'Untitled song')}</h2><p class="resume-artist">${esc(latest.artist || latest.file_name || '')}</p><p class="resume-meta">${plural(tracks, 'track')} · ${plural(bars, 'bar')}${tempo ? ` · ${tempo} BPM` : ''}</p><div class="resume-actions"><a class="button primary" href="/editor/index.html?lesson=${encodeURIComponent(latest.id)}"><svg class="icon"><use href="#i-pencil"/></svg>Open in Editor</a><button class="button" type="button" data-share-song="${esc(latest.id)}"><svg class="icon"><use href="#i-share"/></svg>Share</button><button class="button" type="button" data-open-song="${esc(latest.id)}">View Song</button></div></div></div>${others.length ? `<div class="resume-recent"><p class="eyebrow">Recent</p><ul>${others.map(lesson => `<li><div class="recent-row" role="button" tabindex="0" data-open-song="${esc(lesson.id)}">${coverHtml(lesson, 'recent-cover')}<span><strong>${esc(lesson.title || 'Untitled song')}</strong><small>${lesson.shared ? 'Shared · ' : ''}${esc(ago(lesson.updated_at))}</small></span><svg class="icon" aria-hidden="true"><use href="#i-chevron"/></svg></div></li>`).join('')}</ul></div>` : ''}`;
    } else {
      $('resume').innerHTML = `<div class="resume-main"><div class="resume-copy"><h2 id="resume-title">Upload your first song</h2><p class="resume-artist">Or start a new one from scratch.</p><div class="resume-actions"><button class="button primary" type="button" data-upload-open><svg class="icon"><use href="#i-upload"/></svg>Upload Files</button><a class="button" href="/editor/index.html?new=1"><svg class="icon"><use href="#i-plus"/></svg>New Song</a></div></div></div>`;
      $('resume').querySelector('[data-upload-open]').addEventListener('click', openUpload);
    }

    const shared = lessons.filter(lesson => lesson.shared).sort((a, b) => String(a.title).localeCompare(String(b.title)));
    $('link-table').innerHTML = shared.length ? shared.slice(0, 8).map(lesson => {
      const access = accessSummary(lesson);
      return `<div class="link-row"><div class="link-song" role="button" tabindex="0" data-open-song="${esc(lesson.id)}">${coverHtml(lesson, 'link-cover')}<span><strong>${esc(lesson.title || 'Untitled song')}</strong><small>${esc(lesson.artist || lesson.file_name || '')}</small></span></div><div class="link-access"><span>${esc(access.text)}</span><span class="chips">${access.extras.map(name => `<span class="chip">${esc(name)}</span>`).join('')}</span></div><span class="link-buttons"><button class="icon-button" type="button" data-copy-link="${esc(lesson.id)}" aria-label="Copy link to ${esc(lesson.title)}" title="Copy link"><svg class="icon"><use href="#i-copy"/></svg></button><button class="icon-button" type="button" data-share-song="${esc(lesson.id)}" aria-label="Sharing settings for ${esc(lesson.title)}" title="Sharing settings"><svg class="icon"><use href="#i-sliders"/></svg></button></span></div>`;
    }).join('') + (shared.length > 8 ? `<button class="text-button more-links" type="button" data-goto-filter="shared">${shared.length - 8} more shared songs</button>` : '')
      : '<p class="panel-empty">Nothing shared yet.</p>';
    renderLocalSongs();

  }

  // Songs kept only in this browser (see /local-songs.js). They never reach the cloud unless saved there from the editor.
  function renderLocalSongs() {
    const songs = window.LocalSongs ? window.LocalSongs.list(localOwner) : [];
    $('local-panel').hidden = !songs.length;
    $('local-songs').innerHTML = songs.map(song => `<div class="link-row"><div class="link-song" role="button" tabindex="0" data-open-song="local:${esc(song.id)}">${coverHtml(localCoverSource(song), 'link-cover')}<span><strong>${esc(song.title || 'Untitled song')}</strong><small>${esc([song.artist, `${song.bars || 0} bars`, `edited ${ago(song.updatedAt)}`].filter(Boolean).join(' · '))}</small></span></div><div class="local-actions"><button class="button" type="button" data-local-cloud="${esc(song.id)}" ${localCloudSaves.has(song.id)?'disabled':''}>${localCloudSaves.has(song.id)?'Saving…':'Save to Library'}</button><a class="button" href="/editor/index.html?local=${encodeURIComponent(song.id)}">Edit</a><button class="icon-button" type="button" data-local-remove="${esc(song.id)}" aria-label="Remove ${esc(song.title || 'song')} from local songs"><svg class="icon"><use href="#i-trash"/></svg></button></div></div>`).join('');
  }
  document.addEventListener('click', event => {
    if (event.target.closest('.cover-caption')) event.stopPropagation();
  }, true);
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-local-remove]');
    if (!button || !window.LocalSongs) return;
    const song = window.LocalSongs.list(localOwner).find(item => item.id === button.dataset.localRemove);
    if (song) deleteLocalSong(song);
  });
  addEventListener('storage', event => { if (event.key?.startsWith('fretphrase-local-songs:')) { renderLocalSongs(); if (typeof render === 'function' && !$('library').hidden) render(); } });

  function updateLesson(row) {
    const index = lessons.findIndex(lesson => lesson.id === row.id);
    if (index >= 0) lessons[index] = row;
    else lessons.unshift(row);
    if (selected?.id === row.id) selected = row;
    if (!librarySelectedId) librarySelectedId = row.id;
    render();
  }

  const coverResults=new Map(),coverExpiry=new Map(),coverPending=new Set(),coverQueue=[],coverRetries=new Map(),coverRetryTimers=new Map();
  let coverRequests=0;
  const coverObserver=new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.isIntersecting){coverObserver.unobserve(entry.target);queueCover(entry.target);}
  },{rootMargin:'80px'});
  function hasCover(key){
    if(Date.now()>=(coverExpiry.get(key)??Infinity)){coverResults.delete(key);coverExpiry.delete(key);}
    return coverResults.has(key);
  }
  function retryCover(key,delay){
    const count=coverRetries.get(key)||0;
    if(count>=2||coverRetryTimers.has(key))return;
    coverRetries.set(key,count+1);
    coverRetryTimers.set(key,setTimeout(()=>{
      coverRetryTimers.delete(key);
      document.querySelectorAll('[data-cover-key]').forEach(node=>{if(node.dataset.coverKey===key)queueCover(node);});
    },delay||(count?65000:5000)));
  }
  addEventListener('online',()=>{
    coverRetryTimers.forEach(timer=>clearTimeout(timer));coverRetryTimers.clear();coverRetries.clear();
    document.querySelectorAll('[data-cover-key]').forEach(node=>coverObserver.observe(node));
    if($('selected-cover').dataset.coverKey)queueCover($('selected-cover'));
  });
  function coverCreditUrl(value){
    try{const url=new URL(value);return url.protocol==='https:'&&['music.apple.com','deezer.com','www.deezer.com'].includes(url.hostname)&&!url.port&&!url.username&&!url.password?url.href:null;}catch{return null;}
  }
  function coverCreditLabel(artwork){
    return artwork?.source==='Deezer'?'Deezer':artwork?.source==='Apple Music'?'Apple Music':null;
  }
  function hideCoverCredit(node){
    if(node?.id!=='selected-cover')return;
    const credit=$('selected-cover-credit');if(!credit)return;
    credit.hidden=true;credit.removeAttribute('href');
  }
  function showCoverCredit(node,artwork){
    if(node?.id!=='selected-cover')return;
    const credit=$('selected-cover-credit');if(!credit)return;
    const url=coverCreditUrl(artwork?.sourceUrl),label=coverCreditLabel(artwork);
    if(!url||!label){credit.hidden=true;credit.removeAttribute('href');return;}
    credit.href=url;credit.querySelector('.cover-caption-text').textContent=`Artwork · ${label}`;
    credit.setAttribute('aria-label',`Album artwork from ${label} (opens in a new tab)`);credit.hidden=false;
  }
  function applyCover(node,artwork){
    if(!artwork){hideCoverCredit(node);return;}
    const image=node.querySelector('img');if(!image)return;
    const key=node.dataset.coverKey;
    let fallback;try{const url=new URL(artwork.fallbackUrl);if(url.protocol==='https:'&&/^(?:is\d+-ssl\.mzstatic\.com|(?:e-cdns|cdn)-images\.dzcdn\.net)$/.test(url.hostname)&&!url.port&&!url.username&&!url.password&&url.href!==artwork.url)fallback=url.href;}catch{}
    image.onload=()=>{if(node.dataset.coverKey===key){node.classList.add('has-cover');showCoverCredit(node,artwork);}};
    image.onerror=()=>{
      if(node.dataset.coverKey!==key)return;
      if(fallback){const url=fallback;fallback=null;image.src=url;return;}
      image.onload=null;image.onerror=null;node.classList.remove('has-cover');hideCoverCredit(node);image.src='/admin-assets/doc.svg';node.removeAttribute('title');retryCover(key);
    };
    image.referrerPolicy='no-referrer';image.decoding='async';image.alt='';image.src=artwork.url;
    const label=coverCreditLabel(artwork);
    node.title=label?`Album artwork from ${label}`:`${artwork.album} · ${artwork.artist}`;
  }
  function queueCover(node){
    const key=node.dataset.coverKey;
    if(hasCover(key)){applyCover(node,coverResults.get(key));return;}
    if(coverPending.has(key))return;
    coverPending.add(key);coverQueue.push({key,id:node.dataset.coverId});loadCovers();
  }
  async function loadCovers(){
    if(coverRequests>=2||!coverQueue.length)return;
    const {key,id}=coverQueue.shift();coverRequests++;
    try{
      let path=`admin/lessons/${encodeURIComponent(id)}/artwork`;
      if(id.startsWith('local:')){const [,title,artist]=JSON.parse(key);path=`admin/artwork?title=${encodeURIComponent(title||'')}&artist=${encodeURIComponent(artist||'')}`;}
      const {artwork}=await api(path);
      coverResults.set(key,artwork||null);
      coverExpiry.set(key,Date.now()+(artwork?604800000:3600000));
      document.querySelectorAll('[data-cover-key]').forEach(node=>{if(node.dataset.coverKey===key)applyCover(node,artwork);});
    }catch(error){if(!error.status||error.status===429||error.status>=500)retryCover(key,error.status===429?(error.retryAfter||60)*1000:0);}
    finally{coverPending.delete(key);coverRequests--;loadCovers();}
  }

  // Songs without verified artwork get a stable generated cover instead of a file icon.
  function coverStyle(lesson) {
    let hash = 0;
    for (const char of `${lesson.title || ''}${lesson.artist || ''}`) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return `--cover-hue:${hash % 360}`;
  }
  function monogram(lesson) {
    return esc((lesson.title || 'Untitled').trim().charAt(0).toUpperCase() || '♪');
  }
  function paintCover(node, lesson) {
    node.setAttribute('style', coverStyle(lesson));
    const mark = node.querySelector('.cover-monogram');
    if (mark) mark.textContent = (lesson.title || 'Untitled').trim().charAt(0).toUpperCase() || '♪';
  }

  // Point a cover node at a song and show its verified artwork when available.
  function syncCover(node, lesson) {
    const key = JSON.stringify([lesson.id, lesson.title, lesson.artist]);
    if (node.dataset.coverKey !== key) {
      const image = node.querySelector('img');
      image.onload = null;
      image.onerror = null;
      node.removeAttribute('title');
      node.classList.remove('has-cover');
      if (typeof hideCoverCredit === 'function') hideCoverCredit(node);
      image.src = '/admin-assets/doc.svg';
    }
    node.dataset.coverId = lesson.id;
    node.dataset.coverKey = key;
    paintCover(node, lesson);
    if (hasCover(key)) applyCover(node, coverResults.get(key));
    else queueCover(node);
  }

  function render() {
    if (!librarySong(librarySelectedId)) {
      const local = window.LocalSongs?.list(localOwner)[0];
      librarySelectedId = lessons[0]?.id || (local ? `local:${local.id}` : null);
    }
    const overview = filter === 'overview';
    $('overview').hidden = !overview;
    $('library').hidden = overview;
    const plain = text => text.replace(/\s+/g, ' ').toLowerCase();
    const query = plain($('search').value.trim());
    const shown = lessons.filter(lesson => {
      const shared = Boolean(lesson.shared);
      const matchesFilter = filter === 'all' || (filter === 'shared' ? shared : !shared);
      const words = plain(`${lesson.title} ${lesson.artist} ${lesson.file_name}`);
      return matchesFilter && words.includes(query);
    });

    const localAll = window.LocalSongs ? window.LocalSongs.list(localOwner) : [];
    const localShown = filter === 'shared' ? [] : localAll.filter(song => `${song.title} ${song.artist}`.toLowerCase().includes(query));
    coverObserver.disconnect();
    $('lesson-list').innerHTML = shown.map(lesson => {
      const title = esc(lesson.title || 'Untitled song');
      const artist = esc(lesson.artist || lesson.file_name || 'GP file');
      const tracks = Number(lesson.track_count) || 0;
      const active = lesson.id === librarySelectedId;
      return `<div class="lesson-row${active ? ' selected' : ''}" role="button" tabindex="0" data-id="${esc(lesson.id)}" aria-pressed="${active}">
        ${coverHtml(lesson, 'song-mark')}
        <span class="song-copy"><strong class="song-title">${title}</strong><span class="song-artist">${artist}</span></span>
        <span class="song-meta">${lesson.shared ? '<svg class="icon shared-icon" role="img" aria-label="Shared"><use href="#i-link"/></svg>' : ''}${tracks} ${tracks === 1 ? 'track' : 'tracks'}</span>
        <svg class="icon row-chevron" aria-hidden="true"><use href="#i-chevron"/></svg>
      </div>`;
    }).join('') + localShown.map(song => `<div class="lesson-row local-row${librarySelectedId === `local:${song.id}` ? ' selected' : ''}" role="button" tabindex="0" data-id="local:${esc(song.id)}" aria-pressed="${librarySelectedId === `local:${song.id}`}">
        ${coverHtml(localCoverSource(song), 'song-mark')}
        <span class="song-copy"><strong class="song-title">${esc(song.title || 'Untitled song')}</strong><span class="song-artist">${esc(song.artist || '')}</span></span>
        <span class="song-meta"><svg class="icon shared-icon" role="img" aria-label="Local"><use href="#i-device"/></svg>Local</span>
        <svg class="icon row-chevron" aria-hidden="true"><use href="#i-chevron"/></svg>
      </div>`).join('');
    const counts = {all: lessons.length + localAll.length, shared: lessons.filter(lesson => lesson.shared).length};
    counts.private = counts.all - counts.shared;
    document.querySelectorAll('[data-count]').forEach(node => { node.textContent = counts[node.dataset.count] || ''; });
    if (!overview) $('library-title').textContent = {all: 'Library', shared: 'Shared', private: 'Private'}[filter];
    if (overview) renderOverview();

    document.querySelectorAll('#lesson-list [data-cover-id], #overview [data-cover-id]').forEach(node=>coverObserver.observe(node));

    const empty = shown.length === 0 && localShown.length === 0;
    $('lesson-list').hidden = empty;
    $('empty').hidden = !empty;
    $('empty').querySelector('h2').textContent = lessons.length + localAll.length ? 'No matching songs' : 'No songs yet';
    $('empty').querySelector('p').textContent = lessons.length + localAll.length
      ? 'Try another search or filter.'
      : 'Upload a file or open the editor to create a piece.';
    $('empty-upload').hidden = lessons.length + localAll.length > 0;
    $('result-count').textContent = String(counts.all);
    if (storageCount !== lessons.length) { storageCount = lessons.length; loadStorage().catch(() => {}); }
    $('result-count').setAttribute('aria-label', `${counts.all} ${counts.all === 1 ? 'song' : 'songs'}`);
    renderSelected();
  }

  function renderSelected() {
    const lesson = librarySong(librarySelectedId);
    $('detail-empty').hidden = Boolean(lesson);
    $('song-content').hidden = !lesson;
    if (!lesson) {
      previewKey = null;
      window.FretphrasePreview.clear();
      return;
    }
    const cover = $('selected-cover');
    const coverKey = JSON.stringify([lesson.id, lesson.title, lesson.artist]);
    if (cover.dataset.coverKey !== coverKey) {
      const image = cover.querySelector('img');
      image.onload = null;
      image.onerror = null;
      cover.removeAttribute('title');
      cover.classList.remove('has-cover');
      if (typeof hideCoverCredit === 'function') hideCoverCredit(cover);
      image.src = '/admin-assets/doc.svg';
      const content = $('song-content');
      content.classList.remove('is-entering');
      void content.offsetWidth;
      content.classList.add('is-entering');
    }
    cover.dataset.coverId = lesson.id;
    cover.dataset.coverKey = coverKey;
    paintCover(cover, lesson);
    $('song-content').setAttribute('style', coverStyle(lesson));
    if (hasCover(coverKey)) applyCover(cover, coverResults.get(coverKey));
    else queueCover(cover);
    $('selected-title').textContent = lesson.title || 'Untitled song';
    const local = Boolean(lesson.local_id);
    $('selected-artist').textContent = lesson.artist || (local ? '' : lesson.file_name || 'GP file');
    $('selected-artist').hidden = local && !lesson.artist;
    $('selected-state').textContent = local ? 'Local' : lesson.shared ? 'Link shared' : 'Private';
    document.querySelector('.song-sharing').classList.toggle('is-shared', Boolean(lesson.shared));
    for (const id of ['detail-share', 'selected-device', 'selected-settings', 'selected-preview']) $(id).hidden = local;
    $('selected-video').hidden = local;
    $('selected-preview').title = lesson.shared && lesson.share_token ? 'Open the shared link in a new tab, as your audience sees it.' : 'Open the audience player in a new tab. Only you can open it.';
    if (!local) $('selected-video').href = `/editor/video.html?lesson=${encodeURIComponent(lesson.id)}`;
    $('selected-cloud-save').hidden = !local;
    $('selected-cloud-save').disabled = localCloudSaves.has(lesson.local_id);
    $('selected-cloud-save').querySelector('span').textContent = localCloudSaves.has(lesson.local_id) ? 'Saving…' : 'Save to Library';
    const tracks = Number(lesson.track_count) || 0;
    const bars = Number(lesson.bar_count) || 0;
    const tempo = Number(lesson.tempo) || 0;
    $('selected-meta').textContent = `${tracks} ${tracks === 1 ? 'track' : 'tracks'} · ${bars} ${bars === 1 ? 'bar' : 'bars'}${tempo > 0 ? ` · ${tempo} BPM` : ''}`;
    $('selected-edit').href = local ? `/editor/index.html?local=${encodeURIComponent(lesson.local_id)}` : `/editor/index.html?lesson=${encodeURIComponent(lesson.id)}`;
    const key = `${lesson.id}:${local ? lesson.updated_at : lesson.version}`;
    if (previewKey !== key) {
      previewKey = key;
      window.FretphrasePreview.load(lesson, false, localOwner);
    }
  }

  // Opens the audience player full page in a new tab: the public share link when the song is shared,
  // otherwise the owner-only preview, which needs this account's session and says so in a banner.
  function openAudienceView() {
    const lesson = lessons.find(item => item.id === librarySelectedId);
    if (!lesson) return;
    if (lesson.shared && lesson.share_token) { window.open(shareUrl(lesson), '_blank', 'noopener'); return; }
    const url = new URL('/editor/player.html', location.origin);
    url.searchParams.set('lesson', lesson.id);
    url.searchParams.set('preview', '1');
    if (new URLSearchParams(location.search).get('silent') === '1') url.searchParams.set('silent', '1');
    window.open(url.href, '_blank', 'noopener');
  }

  async function init() {
    if (initializing) return;
    initializing = true;
    $('loading').hidden = false;
    $('access').hidden = true;
    $('workspace').hidden = true;
    $('library').hidden = true;
    $('overview').hidden = true;
    $('retry-access').hidden = true;
    $('retry-library').hidden = true;

    try {
      const session = await refreshSession();
      registrationOpen = session.registrationOpen === true;
      forgotMethod = session.mailEnabled === true ? forgotMethod : 'recovery';
      $('username-current').textContent = session.email ? `Currently ${session.email}.` : 'Shown on your account.';
      $('manage-users').hidden = session.owner !== true;
      window.fretlarkReports?.setOwner(session.owner === true);
      renderViolations(session);
      $('auth-switch').hidden = !registrationOpen;
      const passwordAccount = session.admin && session.authType === 'password';
      localOwner = session.email || 'guest';
      $('account-label').textContent = passwordAccount ? session.email : 'Account';
      const initial = (session.email || 'T').charAt(0).toUpperCase();
      document.querySelectorAll('.avatar').forEach(node => { node.textContent = initial; });
      const accountCopy = document.querySelector('.account-copy strong');
      if (accountCopy && passwordAccount) accountCopy.textContent = session.email;
      $('signout').hidden = !passwordAccount;
      $('delete-account-open').disabled = session.owner === true;
      $('delete-account-detail').textContent = session.owner === true ? 'The owner account cannot be deleted. Hand over ownership first.' : 'Permanently delete your account and every song saved to your Library. Songs saved locally stay in this browser.';
      $('migration').hidden = !(passwordAccount && session.legacyMigrationAvailable);

      if (resetToken) {
        showAccess();
        setAuthMode('reset');
        return;
      }
      if (passwordAccount && nextPath) { location.replace(nextPath); return; }
      if (!passwordAccount) {
        showAccess();
        $('legacy-access-note').hidden = !session.legacyMigrationAvailable;
        $('access-message').textContent = session.authType === 'legacy'
          ? 'Your older sign-in is available. Create or sign in to a password account to manage your library and claim those songs.'
          : !registrationOpen ? 'Registration is currently closed.'
          : nextPath?.startsWith('/editor/') ? `Create a free account to save your song to your Library.` : '';
        setAuthMode(params.has('signup') && !signupShown ? 'register' : authMode);
        signupShown = true;
        return;
      }

      $('workspace').hidden = false;
      $('library').hidden = false;
      renderAccountBanners();
      const result = await api('admin/lessons');
      lessons = Array.isArray(result.lessons) ? result.lessons : [];
      if (!librarySong(librarySelectedId)) librarySelectedId = lessons[0]?.id || null;
      render();
    } catch (error) {
      if ($('workspace').hidden) {
        showAccess();
        $('access-title').textContent = 'Sign in';
        $('access-message').textContent = error.message || 'Could not connect to Fretlark.';
        $('retry-access').hidden = false;
      } else {
        $('result-count').textContent = 'Could not load songs.';
        $('retry-library').hidden = false;
        toast(error.message || 'Could not load songs.', true);
      }
    } finally {
      $('loading').hidden = true;
      initializing = false;
    }
  }

  async function loadLessons() {
    $('retry-library').disabled = true;
    try {
      const result = await api('admin/lessons');
      lessons = Array.isArray(result.lessons) ? result.lessons : [];
      if (!librarySong(librarySelectedId)) librarySelectedId = lessons[0]?.id || null;
      $('retry-library').hidden = true;
      render();
      return true;
    } catch (error) {
      toast(error.message || 'Could not load songs.', true);
      return false;
    } finally {
      $('retry-library').disabled = false;
    }
  }

  async function submitRecovery(username, password) {
    const submit = $('auth-submit');
    if (password.length < 8 || password.length > 1024) return status('auth-status', 'Use a password between 8 and 1024 characters.', true);
    if (password !== $('auth-password2').value) return status('auth-status', 'The passwords do not match.', true);
    submit.disabled = true; $('auth-toggle').disabled = true; status('auth-status', '');
    submit.textContent = 'Resetting…';
    try {
      const result = await api('auth/reset', json('POST', {username, recovery_key: $('auth-recovery').value, new_password: password}));
      $('auth-password').value = ''; $('auth-password2').value = ''; $('auth-recovery').value = '';
      setAuthMode('login');
      status('auth-status', 'Password updated. Sign in with your new password.');
      await showRecoveryKey(result.recovery_key, 'Your recovery key was replaced');
    } catch (error) {
      status('auth-status', error.message || 'Something went wrong. Try again.', true);
    } finally {
      submit.disabled = false; $('auth-toggle').disabled = false;
      submit.textContent = authButtons[authMode];
    }
  }

  // Shows a recovery key once; resolves when the person confirms they saved it.
  function showRecoveryKey(key, title = 'Save your recovery key') {
    $('recovery-show-title').textContent = title;
    $('recovery-key-text').textContent = key;
    $('recovery-key-saved').checked = false; $('recovery-key-done').disabled = true;
    $('recovery-show-dialog').showModal();
    return new Promise(resolve => { recoveryDone = () => { $('recovery-show-dialog').close(); recoveryDone = null; resolve(); }; });
  }

  async function submitForgotRequest(identifier) {
    const submit = $('auth-submit');
    submit.disabled = true; $('auth-toggle').disabled = true; status('auth-status', '');
    submit.textContent = 'Sending…';
    try {
      await api('auth/forgot-request', json('POST', {identifier}));
      $('auth-email').value = '';
      status('auth-status', 'If that account has a confirmed email, a reset link is on its way. It expires in 30 minutes.');
    } catch (error) {
      status('auth-status', error.message || 'Something went wrong. Try again.', true);
    } finally {
      submit.disabled = false; $('auth-toggle').disabled = false;
      submit.textContent = authSubmitText();
    }
  }

  async function submitNewPassword(password) {
    const submit = $('auth-submit');
    if (password.length < 8 || password.length > 1024) return status('auth-status', 'Use a new password of 8 to 1024 characters.', true);
    if (password !== $('auth-password2').value) return status('auth-status', 'The passwords do not match.', true);
    submit.disabled = true; $('auth-toggle').disabled = true; status('auth-status', '');
    submit.textContent = 'Saving…';
    try {
      await api('auth/forgot-complete', json('POST', {token: resetToken, new_password: password}));
      resetToken = null;
      $('auth-password').value = ''; $('auth-password2').value = '';
      setAuthMode('login');
      status('auth-status', 'Password changed. Sign in with your new password.');
    } catch (error) {
      status('auth-status', error.message || 'This password reset link is invalid or has expired.', true);
      $('reset-back').hidden = false;
    } finally {
      submit.disabled = false; $('auth-toggle').disabled = false;
      submit.textContent = authSubmitText();
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    const form = $('auth-form');
    if (!form.reportValidity()) return;
    const identifier = $('auth-email').value.trim();
    const password = $('auth-password').value;
    if (authMode === 'forgot' && sessionState.mailEnabled && forgotMethod === 'email') return submitForgotRequest(identifier);
    if (authMode === 'forgot') return submitRecovery(identifier, password);
    if (authMode === 'reset') return submitNewPassword(password);
    if (authMode === 'register' && (password.length < 8 || password.length > 1024)) {
      status('auth-status', 'Use a password between 8 and 1024 characters.', true);
      return;
    }
    if (authMode === 'register' && password !== $('auth-password2').value) {
      status('auth-status', 'The passwords do not match.', true);
      return;
    }

    const submit = $('auth-submit');
    submit.disabled = true;
    $('auth-toggle').disabled = true;
    submit.textContent = authMode === 'register' ? 'Creating account…' : 'Signing in…';
    status('auth-status', '');
    try {
      const payload = authMode === 'register'
        ? (sessionState.mailEnabled ? {email: identifier, password} : {username: identifier, password})
        : {email: identifier, password};
      const result=await api(`auth/${authMode}`, json('POST', payload));
      if(result.mfa_required){
        authChallenge=result.challenge;$('auth-password').value='';$('auth-form').hidden=true;$('auth-switch').hidden=true;$('auth-factor-form').hidden=false;animateAuthSwap($('auth-factor-form'));
        $('access-title').textContent='Two-factor authentication';$('access-message').textContent='Enter a code to finish signing in.';status('auth-factor-status','');$('auth-factor-code').focus();return;
      }
      $('auth-password').value = '';
      if (authMode === 'register' && result.email_sent === false) emailBannerError = 'The confirmation email could not be sent. Try again.';
      if (nextPath) { location.replace(nextPath); return; }
      await init();
    } catch (error) {
      status('auth-status', error.message || 'Could not sign in.', true);
    } finally {
      submit.disabled = false;
      $('auth-toggle').disabled = false;
      submit.textContent = authSubmitText();
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    if(savingPassword) return;
    const current_password=$('current-password').value,new_password=$('new-password').value;
    if(new_password.length<8 || new_password.length>1024) return status('password-status','Use a password of 8 to 1024 characters.',true);
    if(new_password!==$('confirm-password').value) return status('password-status','New passwords do not match.',true);
    savingPassword=true;
    const controls=[...$('password-form').querySelectorAll('button,input')];
    controls.forEach(control=>control.disabled=true);
    $('password-submit').textContent='Updating…';status('password-status','');
    try {
      await accountControls.secure(()=>api('auth/password',json('POST',{current_password,new_password})));
      closeDialog('password-dialog');
      toast('Password updated. Other devices have been signed out.');
    } catch(error) { status('password-status',error.message,true); }
    finally { savingPassword=false;controls.forEach(control=>control.disabled=false);$('password-submit').textContent='Update password'; }
  }

  // Appearance: follow the system unless the teacher picks light or dark.
  function applyTheme(choice, save) {
    const root = document.documentElement;
    if (choice === 'light' || choice === 'dark') root.dataset.theme = choice;
    else { delete root.dataset.theme; choice = 'system'; }
    if (save) {
      try { choice === 'system' ? localStorage.removeItem('fretphrase-theme') : localStorage.setItem('fretphrase-theme', choice); } catch { /* Storage can be blocked. */ }
    }
    const buttons = [...document.querySelectorAll('[data-theme-choice]')];
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === choice)));
    document.querySelector('.segmented')?.style.setProperty('--seg-index', Math.max(0, buttons.findIndex(button => button.dataset.themeChoice === choice)));
  }
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice, true)));
  applyTheme(document.documentElement.dataset.theme, false);

  async function openAccount() { await accountControls.open(); }

  // Storage use feeds both the sidebar meter and the Account dialog.
  async function loadStorage() {
    const usage = await api('admin/storage');
    const used = usage.used_bytes / 1024 / 1024, limit = usage.limit_bytes / 1024 / 1024;
    $('account-storage').textContent = `${used.toFixed(1)} of ${limit} MB · ${usage.songs} of ${usage.limit_songs} songs`;
    $('sidebar-storage-text').textContent = `${used.toFixed(1)} of ${limit} MB`;
    $('sidebar-storage').hidden = false;
    const width = `${Math.min(100, usage.used_bytes / usage.limit_bytes * 100).toFixed(1)}%`;
    document.querySelectorAll('.storage-meter span').forEach(bar => bar.style.setProperty('width', width));
    renderPlan(usage);
  }

  // Paid plans are not offered yet; the storage meter only reflects the current account.
  function renderPlan(usage) {
    if (!usage.plan) return;
    $('plan-card').hidden = false;
    $('plan-detail').textContent = `${Math.round(usage.limit_bytes / 1048576)} MB per account. Songs saved only on this device never count.`;
  }
  let storageCount = -1;

  async function signOut() {
    $('signout').disabled = true;
    try {
      await api('auth/logout', {method: 'POST'});
      try { localStorage.removeItem('score-studio-session'); } catch {}
      closeDialog('account-dialog');
      lessons = [];
      window.FretphrasePreview.clear();
      selected = null;
      librarySelectedId = null;
      previewKey = null;
      $('auth-password').value = '';
      await init();
    } catch (error) {
      toast(error.message || 'Could not sign out.', true);
    } finally {
      $('signout').disabled = false;
    }
  }

  async function claimLegacyLessons() {
    const button = $('claim-lessons');
    button.disabled = true;
    try {
      const result = await api('auth/claim', {method: 'POST'});
      $('migration').hidden = true;
      const session = await api('session');
      $('migration').hidden = !(session.admin && session.authType === 'password' && session.legacyMigrationAvailable);
      if (await loadLessons()) {
        const moved = Number(result.moved) || 0;
        toast(moved ? `${moved} older ${moved === 1 ? 'song' : 'songs'} moved. Shared links still work.` : 'Your library is up to date.');
      }
    } catch (error) {
      toast(error.message || 'Could not claim older songs.', true);
    } finally {
      button.disabled = false;
    }
  }

  function openUpload() {
    if (uploading) return;
    files = [];
    $('upload-form').reset();
    $('upload-selection').textContent = '';
    renderUploadSelection();
    status('upload-status', '');
    openDialog('upload-dialog', 'upload-files');
  }

  function chooseFiles(fileList) {
    for (const file of Array.from(fileList || [])) {
      if (!files.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) files.push(file);
    }
    $('upload-files').value = '';
    status('upload-status', '');
    renderUploadSelection();
  }

  function renderUploadSelection() {
    $('upload-selection').innerHTML = files.map((file, index) => `<div class="upload-file"><img src="/admin-assets/doc.svg" alt=""><div><strong>${esc(file.name)}</strong><span>${file.size >= 1024 * 1024 ? (file.size / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.ceil(file.size / 1024)) + ' KB'}</span></div><button class="icon-button" type="button" data-remove-upload="${index}" aria-label="Remove ${esc(file.name)}"><img src="/admin-assets/close.svg" alt=""></button></div>`).join('');
    $('upload-submit').disabled = uploading || !files.length;
    $('upload-submit').textContent = files.length > 1 ? `Upload ${files.length} files` : 'Upload';
  }

  // MIDI has no strings or frets: convert it to a GP file in the browser (guessed fingering), then upload that.
  let midiImportReady, midiWarnings = [];
  // Conversion notes (skipped tracks, loose timing) stay visible after the upload toast.
  function showMidiWarnings() {
    if (!midiWarnings.length) return;
    const node = $('toast');
    node.textContent = `MIDI converted with changes. ${midiWarnings.join(' ')}`;
    node.className = 'toast visible';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('visible'), 12000);
    midiWarnings = [];
  }
  function loadMidiImport() {
    const load = src => new Promise((resolve, reject) => { const el = document.createElement('script'); el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('The MIDI importer could not be loaded.')); document.head.appendChild(el); });
    return midiImportReady ||= (async () => { for (const src of ['/editor/vendor/tonejs-midi.js', '/editor/midi-fingering.js', '/editor/midi-drums.js', '/editor/midi-import.js']) await load(src); })().catch(error => { midiImportReady = null; throw error; });
  }
  async function prepareFile(file) {
    if (!/\.midi?$/i.test(file.name)) return file;
    if (file.size > 30 * 1024 * 1024) throw new Error('use a file smaller than 30 MB.');
    await loadMidiImport();
    const alphaTab = window.alphaTab, settings = new alphaTab.Settings();
    const {tex, warnings} = window.FretlarkMidiImport.toAlphaTex(new Uint8Array(await file.arrayBuffer()), {fileName: file.name});
    const bytes = new alphaTab.exporter.Gp7Exporter().export(alphaTab.importer.ScoreLoader.loadAlphaTex(tex, settings), settings);
    for (const warning of warnings || []) midiWarnings.push(`${file.name}: ${warning}`);
    const converted = new File([bytes], file.name.replace(/\.midi?$/i, '.gp'), {type: 'application/octet-stream'});
    converted.sourceFormat = 'midi';
    return converted;
  }

  async function inspect(file) {
    if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name}: use a file smaller than 30 MB.`);
    const alphaTab = window.alphaTab;
    const settings = new alphaTab.Settings();
    let score;
    if (/\.atex$/i.test(file.name)) {
      score = alphaTab.importer.ScoreLoader.loadAlphaTex(await file.text(), settings);
    } else {
      score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(await file.arrayBuffer()), settings);
    }
    if (!score.tracks.length || !score.masterBars.length) throw new Error(`${file.name} contains no playable tabs.`);
    return {
      title: score.title || file.name.replace(/\.[^.]+$/, ''),
      artist: score.artist || '',
      track_count: score.tracks.length,
      bar_count: score.masterBars.length,
      tempo: score.tempo
    };
  }

  function uploadOptions(file, metadata) {
    // source_format remembers that a song started as MIDI (it is stored as GP); the editor's saves omit it.
    const data = {...metadata, file_name: file.name, file_size: file.size, source_format: file.sourceFormat || 'file'};
    // Bound metadata before encoding it into the request header.
    data.title = String(data.title || '').slice(0, 180);
    data.artist = String(data.artist || '').slice(0, 180);
    data.file_name = data.file_name.length > 255 ? data.file_name.slice(0, 240) + (data.file_name.match(/\.[^.]+$/)?.[0] || '').slice(0, 15) : data.file_name;
    return {headers: {'Content-Type': 'application/octet-stream', 'X-Fretphrase-Metadata': encodeURIComponent(JSON.stringify(data))}, body: file};
  }

  function setUploadBusy(value) {
    uploading = value;
    $('upload-dialog').querySelectorAll('input, textarea, button').forEach(control => { control.disabled = value; });
    if (!value) renderUploadSelection();
  }

  async function submitUpload(event) {
    event.preventDefault();
    if (!files.length) {
      status('upload-status', 'Choose at least one file.', true);
      return;
    }

    const pending = files.slice();
    midiWarnings = [];
    const failedFiles = [];
    const failures = [];
    const uploaded = [];
    setUploadBusy(true);
    try {
      for (let index = 0; index < pending.length; index++) {
        const file = pending[index];
        status('upload-status', `Checking and uploading ${index + 1} of ${pending.length}: ${file.name}`);
        try {
          const upload = await prepareFile(file);
          const metadata = await inspect(upload);
          const lesson = await api('admin/lessons', {method: 'POST', ...uploadOptions(upload, metadata)});
          updateLesson(lesson);
          uploaded.push(lesson);
        } catch (error) {
          failedFiles.push(file);
          failures.push(`${file.name}: ${error.message}`);
        }
      }
    } finally {
      setUploadBusy(false);
    }

    if (failures.length) {
      files = failedFiles;
      renderUploadSelection();
      $('upload-submit').textContent = 'Retry remaining files';
      status('upload-status', `${uploaded.length} uploaded. ${failures.join(' ')}`, true);
      return;
    }

    closeDialog('upload-dialog');
    if (uploaded.length === 1) {
      librarySelectedId = uploaded[0].id;
      if (filter === 'overview') setFilter(document.querySelector('[data-filter="all"]'));
      render();
      $('selected-title').focus();
      toast('File uploaded. Only you have access.');
    }
    else toast(`${uploaded.length} songs uploaded. Select Share on a song to create its shared link.`);
    showMidiWarnings();
  }

  function showDetails(lesson, restoreTarget = document.activeElement) {
    selected = lesson;
    replacement = null;
    $('detail-title').value = lesson.title || '';
    $('detail-artist').value = lesson.artist || '';
    $('replace-file').value = '';
    $('replace-name').textContent = 'Keeps the same shared link';
    const settings = lessonSettings(lesson);
    $('detail-notation').value = settings.notation;
    $('setting-show-mixer').checked = settings.show_mixer;
    $('setting-track-controls').checked = settings.show_track_controls;
    $('setting-metronome').checked = settings.metronome;
    $('setting-count-in').checked = settings.count_in;
    $('setting-allow-print').checked = settings.allow_print;
    $('setting-allow-download').checked = settings.allow_download;
    const tracksNeedReview = settings.allowed_tracks?.length === 0;
    $('details-dialog').querySelector('.student-settings').disabled = tracksNeedReview;
    status('details-status', tracksNeedReview ? 'Review visible tracks in Share before changing shared player settings.' : '');
    detailsSnapshot = detailsValue();
    openDialog('details-dialog', 'detail-title', restoreTarget);
  }

  function studentSettingsForm() {
    return {
      ...lessonSettings(),
      allowed_notations:[...new Set([...lessonSettings().allowed_notations,$('detail-notation').value])],
      notation: $('detail-notation').value,
      show_mixer: $('setting-show-mixer').checked,
      show_track_controls: $('setting-track-controls').checked,
      metronome: $('setting-metronome').checked,
      count_in: $('setting-count-in').checked,
      allow_print: $('setting-allow-print').checked,
      allow_download: $('setting-allow-download').checked
    };
  }

  async function submitDetails(event) {
    event.preventDefault();
    if (!selected) return;
    savingDetails = true;
    $('details-dialog').querySelectorAll('input, textarea, select, button').forEach(control => { control.disabled = true; });
    status('details-status', 'Saving changes…');
    try {
      const body = {
        version: selected.version,
        title: $('detail-title').value,
        artist: $('detail-artist').value,
        notes: selected.notes || '',
        ...(lessonSettings().allowed_tracks?.length === 0 ? {} : {student_settings: studentSettingsForm()})
      };
      updateLesson(await api(`admin/lessons/${encodeURIComponent(selected.id)}`, json('PATCH', body)));
      if (replacement) {
        replacement = await prepareFile(replacement);
        const metadata = await inspect(replacement);
        metadata.title = $('detail-title').value;
        metadata.artist = $('detail-artist').value;
        metadata.version = selected.version;
        const updated = await api(`admin/lessons/${encodeURIComponent(selected.id)}/file`, {
          method: 'PUT', ...uploadOptions(replacement, metadata)
        });
        window.FretphrasePreview.clear();
        previewKey = null;
        updateLesson(updated);
        replacement = null;
        $('replace-file').value = '';
      }
      closeDialog('details-dialog');
      toast(lessonSettings().allowed_tracks?.length === 0 ? 'Shared link paused. Review and save visible tracks before sharing again.' : 'Song saved. Shared links load the latest version.');
      showMidiWarnings();
    } catch (error) {
      status('details-status', error.message || 'Could not save song.', true);
    } finally {
      savingDetails = false;
      $('details-dialog').querySelectorAll('input, textarea, select, button').forEach(control => { control.disabled = false; });
    }
  }

  async function deleteLesson(lesson) {
    if (savingDetails || !lesson || !await window.appConfirm(`Permanently delete “${lesson.title}”?\n\nIts shared link stops working. This cannot be undone.`, {ok: 'Delete', danger: true}) || savingDetails) return;
    savingDetails = true;
    for (const id of ['delete-lesson', 'selected-delete', 'details-save']) $(id).disabled = true;
    $('details-dialog').querySelectorAll('[data-close]').forEach(button => { button.disabled = true; });
    try {
      await api(`admin/lessons/${encodeURIComponent(lesson.id)}`, {method: 'DELETE'});
      lessons = lessons.filter(item => item.id !== lesson.id);
      if (librarySelectedId === lesson.id) librarySelectedId = lessons[0]?.id || null;
      if (selected?.id === lesson.id) { selected = null; closeDialog('details-dialog'); }
      render();
      toast('Song deleted.');
    } catch (error) {
      const message = error.message || 'Could not delete song.';
      if ($('details-dialog').open) status('details-status', message, true);
      else toast(message, true);
    } finally {
      savingDetails = false;
      for (const id of ['delete-lesson', 'selected-delete', 'details-save']) $(id).disabled = false;
      $('details-dialog').querySelectorAll('[data-close]').forEach(button => { button.disabled = false; });
    }
  }

  async function deleteLocalSong(song) {
    if(localCloudSaves.has(song.local_id || song.id))return;
    if (!await window.appConfirm(`Remove “${song.title || 'Untitled song'}” from local songs?\n\nIt isn’t in your Library, so this can’t be undone.`, {ok: 'Remove', danger: true}) || localCloudSaves.has(song.local_id || song.id)) return;
    try {
      window.LocalSongs.remove(localOwner, song.local_id || song.id);
      render();
      toast('Removed from local songs.');
    } catch (error) { toast(error.message || 'Could not remove the song.', true); }
  }

  async function saveLocalToCloud(song) {
    if(!song?.local_id || localCloudSaves.has(song.local_id))return;
    const id=song.local_id, owner=localOwner, source=window.LocalSongs.get(owner,id);
    if(!source){toast('This song is no longer saved locally.',true);return;}
    localCloudSaves.add(id);render();
    try {
      const score=window.ScoreModel.restore(source.json),at=window.alphaTab;
      score.title=source.title||score.title;score.artist=source.artist||score.artist;
      const bytes=new at.exporter.Gp7Exporter().export(score,new at.Settings());
      const reopened=at.importer.ScoreLoader.loadScoreFromBytes(bytes,new at.Settings());
      const notes=s=>{let count=0;for(const track of s.tracks)for(const staff of track.staves)for(const bar of staff.bars)for(const voice of bar.voices)for(const beat of voice.beats)count+=beat.notes.length;return count;};
      if(reopened.tracks.length!==score.tracks.length||reopened.masterBars.length!==score.masterBars.length||notes(reopened)!==notes(score))throw Error('GP export could not preserve all tracks, bars and notes. The local copy is safe.');
      const file=new File([bytes],`${(score.title||'Untitled').slice(0,240)}.gp`,{type:'application/octet-stream'});
      const metadata=await inspect(file);
      const row=await api('admin/lessons',{method:'POST',...uploadOptions(file,metadata)});
      if(localOwner!==owner)return;
      let kept=true;
      try{if(window.LocalSongs.get(owner,id)?.json===source.json){window.LocalSongs.remove(owner,id);kept=Boolean(window.LocalSongs.get(owner,id));}}catch{/* Cloud save succeeded; retain device copy if cleanup fails. */}
      if(librarySelectedId===song.id)librarySelectedId=row.id;
      updateLesson(row);
      toast(kept?'Saved to Library. A local copy was kept.':'Saved to Library.');
    } catch(error){toast(error.message||'Couldn’t save to Library. The local copy is safe.',true);}
    finally{localCloudSaves.delete(id);render();}
  }


  // Moves a cloud song into this browser only: the local copy is saved and checked before the cloud copy is deleted.
  async function keepOnDevice(lesson) {
    if (!lesson || savingDetails || !window.LocalSongs || !window.ScoreModel) return;
    const where = window.FRETLARK_DESKTOP ? 'in this app on this computer' : 'in this browser';
    if (!await window.appConfirm(`Keep “${lesson.title || 'Untitled song'}” locally only?\n\nIt leaves your Library and its share link stops working. It stays ${where}, isn’t backed up, and ${window.FRETLARK_DESKTOP ? 'removing the app’s data' : 'clearing browser data'} deletes it.`, {ok: 'Keep locally only'}) || savingDetails) return;
    savingDetails = true; $('selected-device').disabled = true;
    try {
      const response = await fetch(`/api/admin/lessons/${encodeURIComponent(lesson.id)}/file`, {credentials: 'same-origin', cache: 'no-store'});
      if (!response.ok) throw Error('Couldn’t download the song from your Library.');
      const bytes = new Uint8Array(await response.arrayBuffer()), at = window.alphaTab;
      const score = /\.atex$/i.test(lesson.file_name) ? at.importer.ScoreLoader.loadAlphaTex(new TextDecoder().decode(bytes), new at.Settings()) : at.importer.ScoreLoader.loadScoreFromBytes(bytes, new at.Settings());
      score.title = lesson.title || score.title; score.artist = lesson.artist || score.artist;
      const entry = window.LocalSongs.put(localOwner, {title: score.title, artist: score.artist, tracks: score.tracks.length, bars: score.masterBars.length, tempo: score.tempo, json: window.ScoreModel.snapshot(score)});
      if (!window.LocalSongs.get(localOwner, entry.id)) throw Error('Couldn’t save the song locally.');
      try { await api(`admin/lessons/${encodeURIComponent(lesson.id)}`, {method: 'DELETE'}); }
      catch (error) { window.LocalSongs.remove(localOwner, entry.id); throw error; }
      lessons = lessons.filter(item => item.id !== lesson.id);
      if (librarySelectedId === lesson.id) librarySelectedId = lessons[0]?.id || null;
      render();
      toast(`“${lesson.title || 'Untitled song'}” is now saved locally.`);
    } catch (error) {
      toast(error.message || 'Could not move the song.', true);
    } finally {
      savingDetails = false; $('selected-device').disabled = false;
    }
  }

  const notationNames={tab:'Tabs',standard:'Standard notes',both:'Tabs + standard',slash:'Rhythm',numbered:'Numbered'};
  function renderShareChoices(settings){
    const list=$('share-track-list');list.hidden=settings.allowed_tracks===null;
    list.querySelectorAll('input').forEach(input=>{input.checked=settings.allowed_tracks===null||settings.allowed_tracks.includes(Number(input.value));});
    $('share-tracks-summary').textContent=settings.allowed_tracks===null?'All tracks':settings.allowed_tracks.length+' selected tracks';
    $('share-default-notation').innerHTML=settings.allowed_notations.map(mode=>`<option value="${mode}">${notationNames[mode]}</option>`).join('');
    $('share-default-notation').value=settings.notation;
    $('share-notation-summary').textContent=settings.allowed_notations.length===5?'All views':settings.allowed_notations.map(mode=>notationNames[mode]).join(', ');
  }
  async function loadShareTracks(lesson){
    const request=++shareTrackRequest;
    $('share-track-list').replaceChildren();status('share-tracks-status','Loading tracks…');
    try{
      const response=await fetch(`/api/admin/lessons/${encodeURIComponent(lesson.id)}/file`,{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw Error('Could not load tracks. Reopen sharing to try again.');
      const bytes=new Uint8Array(await response.arrayBuffer()),at=window.alphaTab;
      const song=/\.atex$/i.test(lesson.file_name)?at.importer.ScoreLoader.loadAlphaTex(new TextDecoder().decode(bytes),new at.Settings()):at.importer.ScoreLoader.loadScoreFromBytes(bytes,new at.Settings());
      if(request!==shareTrackRequest||selected?.id!==lesson.id)return;
      $('share-track-list').innerHTML=song.tracks.map((track,i)=>`<label><input type="checkbox" name="share-visible-track" value="${i}">${esc(track.name||'Track '+(i+1))}</label>`).join('');
      if(savingShare) $('share-track-list').querySelectorAll('input').forEach(input=>{input.disabled=true;});
      renderShareChoices(lessonSettings());status('share-tracks-status','');
    }catch(error){if(request===shareTrackRequest&&selected?.id===lesson.id)status('share-tracks-status',error.message,true);}
  }
  // Violations on this account (added when the owner turns off a reported link).
  let violations = [], violationLimit = 3;
  const reasonNames = {copyright: 'Copyright', inappropriate: 'Inappropriate', broken: "Doesn't work", other: 'Other'};
  const sharingBlocked = () => violations.length >= violationLimit;
  const takenDown = lesson => !!lesson && violations.some(item => item.lesson_id === lesson.id);
  function renderViolations(session) {
    violations = Array.isArray(session.violations) ? session.violations : [];
    violationLimit = session.violationLimit || 3;
    $('violations-notice').hidden = !violations.length;
    if (!violations.length) return;
    $('violations-title').textContent = sharingBlocked() ? 'Sharing is turned off for your account' : `${violations.length} of ${violationLimit} violations`;
    $('violations-detail').innerHTML = (sharingBlocked()
      ? 'After repeated reports, your share links were turned off and you can no longer create new ones. Your songs are still in your library.'
      : `A share link was turned off after a report. Songs taken down can't be shared again. At ${violationLimit} violations, all your share links turn off.`)
      + ' If you think this was a mistake, contact the person who runs this site.';
    $('violations-list').innerHTML = violations.map(item => `<li><span><strong>${esc(item.title || 'Untitled song')}</strong><small>${esc(reasonNames[item.reason] || item.reason)} · ${new Date(item.created_at).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}</small></span></li>`).join('');
  }

  function renderShare() {
    if (!selected) return;
    const active = Boolean(selected.shared);
    const settings = lessonSettings();
    $('share-title').textContent = selected.title || 'Untitled song';
    syncCover($('share-cover'), selected);
    $('share-artist').textContent = selected.artist || selected.file_name || 'GP file';
    $('share-enabled').checked = active;
    $('share-enabled').disabled = savingShare || (!active && (sharingBlocked() || takenDown(selected)));
    $('link-card').classList.toggle('is-on', active);
    const locked = !active && (sharingBlocked() || takenDown(selected));
    $('share-access-note').textContent = active ? 'Anyone with the link can view and play along' : locked ? (takenDown(selected) ? 'Taken down after a report · cannot be shared' : 'Sharing is turned off for your account') : 'Off · only you can open this song';
    $('open-link').href = active ? shareUrl(selected) : '#';
    $('share-track-scope').value=settings.allowed_tracks===null?'all':'selected';
    document.querySelectorAll('[name="share-allowed-notation"]').forEach(input=>{input.checked=settings.allowed_notations.includes(input.value);});
    renderShareChoices(settings);
    $('share-track-controls').checked = settings.show_track_controls;
    $('share-show-mixer').checked = settings.show_mixer;
    $('share-metronome').checked = settings.metronome;
    $('share-count-in').checked = settings.count_in;
    $('share-allow-print').checked = settings.allow_print;
    $('share-allow-download').checked = settings.allow_download;
    $('share-url').value = active ? shareUrl(selected) : '';
    $('copy-link').disabled = !active || savingShare;
    $('embed-row').hidden = !active;
    $('share-embed').value = active ? embedSnippet(selected) : '';
    $('copy-embed').disabled = !active || savingShare;
  }

  function setShareBusy(busy) {
    savingShare = busy;
    $('share-dialog').querySelectorAll('select, input, textarea, button').forEach(control => { control.disabled = busy; });
    if (!busy) {
      $('copy-link').disabled = !selected?.shared;
      $('copy-embed').disabled = !selected?.shared;
    }
    $('share-save-state').textContent = busy ? 'Saving…' : '';
  }

  function showShare(lesson, restoreTarget = document.activeElement) {
    selected = lesson;
    status('share-message', lessonSettings(lesson).allowed_tracks?.length === 0 ? 'This file changed. Review and save visible tracks before enabling the shared link.' : '');
    $('share-save-state').textContent = '';
    document.querySelectorAll('.share-row').forEach(section=>section.open=false);
    renderShare();
    loadShareTracks(lesson);
    openDialog('share-dialog', 'share-enabled', restoreTarget);
  }

  let copyTimer;
  async function copyLink() {
    if (!selected?.shared) return;
    try {
      await navigator.clipboard.writeText(shareUrl(selected));
      const label = $('copy-link').lastChild;
      label.textContent = 'Copied';
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { label.textContent = 'Copy'; }, 1600);
    } catch {
      $('share-url').focus();
      $('share-url').select();
      status('share-message', 'Press Ctrl+C to copy the selected link.');
    }
  }

  let copyEmbedTimer;
  async function copyEmbed() {
    if (!selected?.shared) return;
    try {
      await navigator.clipboard.writeText(embedSnippet(selected));
      const label = $('copy-embed').lastChild;
      label.textContent = 'Copied';
      clearTimeout(copyEmbedTimer);
      copyEmbedTimer = setTimeout(() => { label.textContent = 'Copy'; }, 1600);
    } catch {
      $('share-embed').focus();
      $('share-embed').select();
      status('share-message', 'Press Ctrl+C to copy the selected embed code.');
    }
  }

  async function changeShareAccess() {
    if (!selected || savingShare) return;
    const enable = $('share-enabled').checked;
    if (enable === Boolean(selected.shared)) return;
    setShareBusy(true);
    status('share-message', '');
    try {
      const options = enable ? json('POST', {rotate: false}) : {method: 'DELETE'};
      updateLesson(await api(`admin/lessons/${encodeURIComponent(selected.id)}/share`, options));
      status('share-message', enable ? '' : 'Link turned off. It no longer opens this song.');
    } catch (error) {
      status('share-message', error.message || 'Could not change link access.', true);
    } finally {
      setShareBusy(false);
      renderShare();
    }
  }

  async function saveShareSettings() {
    if (!selected || savingShare) return;
    const settings = {
      notation: $('share-default-notation').value,
      allowed_notations: [...document.querySelectorAll('[name="share-allowed-notation"]:checked')].map(input=>input.value),
      allowed_tracks: $('share-track-scope').value==='all'?null:[...document.querySelectorAll('[name="share-visible-track"]:checked')].map(input=>Number(input.value)),
      show_track_controls: $('share-track-controls').checked,
      show_mixer: $('share-show-mixer').checked,
      metronome: $('share-metronome').checked,
      count_in: $('share-count-in').checked,
      allow_print: $('share-allow-print').checked,
      allow_download: $('share-allow-download').checked
    };
    if(!settings.allowed_notations.length || (settings.allowed_tracks!==null&&!settings.allowed_tracks.length)){
      status('share-message','Keep at least one track and one notation view.',true);renderShare();return;
    }
    if(!settings.allowed_notations.includes(settings.notation))settings.notation=settings.allowed_notations[0];
    setShareBusy(true);
    status('share-message', '');
    let saved = false;
    try {
      const {id, version, title, artist, notes} = selected;
      updateLesson(await api(`admin/lessons/${encodeURIComponent(id)}`, json('PATCH', {version, title, artist, notes, student_settings: settings})));
      saved = true;
    } catch (error) {
      status('share-message', error.message || 'Could not save viewer settings.', true);
    } finally {
      setShareBusy(false);
      $('share-save-state').textContent = saved ? 'Saved' : '';
      renderShare();
    }
  }

  async function rotateLink() {
    if (!selected || savingShare || !await window.appConfirm('Create a new link?\n\nThe old link will stop working.', {ok: 'Create new link', danger: true}) || savingShare) return;
    setShareBusy(true);
    try {
      updateLesson(await api(`admin/lessons/${encodeURIComponent(selected.id)}/share`, json('POST', {rotate: true})));
      status('share-message', 'New link created. The old link no longer works.');
    } catch (error) {
      status('share-message', error.message || 'Could not create a new link.', true);
    } finally {
      setShareBusy(false);
      renderShare();
    }
  }

  function onLessonAction(event) {
    const row = event.target.closest('[data-id]');
    if (!row) return;
    const lesson = librarySong(row.dataset.id);
    if (!lesson) return;
    librarySelectedId = lesson.id;
    render();
    $('workspace').classList.add('detail-open');
    if (window.matchMedia('(max-width: 767px)').matches) $('selected-title').focus();
    else Array.from($('lesson-list').children).find(item => item.dataset.id === librarySelectedId)?.focus();
  }

  function setFilter(button) {
    filter = button.dataset.filter;
    $('workspace').classList.remove('detail-open');
    document.querySelectorAll('[data-filter]').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    render();
  }

  function installUploadDrop() {
    const dropzone = $('dropzone');
    for (const eventName of ['dragenter', 'dragover']) {
      dropzone.addEventListener(eventName, event => {
        event.preventDefault();
        dropzone.classList.add('drag-over');
      });
      $('empty').addEventListener(eventName, event => {
        event.preventDefault();
        $('empty').classList.add('drag-over');
      });
    }
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    // Files dragged anywhere over the Overview open the upload sheet.
    const overview = $('overview'), overlay = $('overview-drop'), hasFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
    for (const eventName of ['dragenter', 'dragover']) overview.addEventListener(eventName, event => { if (!hasFiles(event)) return; event.preventDefault(); overlay.hidden = false; });
    overview.addEventListener('dragleave', event => { if (!overview.contains(event.relatedTarget)) overlay.hidden = true; });
    overview.addEventListener('drop', event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      overlay.hidden = true;
      if (uploading) return;
      openUpload();
      chooseFiles(event.dataTransfer.files);
    });
    dropzone.addEventListener('drop', event => {
      event.preventDefault();
      dropzone.classList.remove('drag-over');
      if (uploading) return;
      chooseFiles(event.dataTransfer.files);
    });
    $('empty').addEventListener('dragleave', () => $('empty').classList.remove('drag-over'));
    $('empty').addEventListener('drop', event => {
      event.preventDefault();
      $('empty').classList.remove('drag-over');
      openUpload();
      chooseFiles(event.dataTransfer.files);
    });
  }

  $('auth-form').addEventListener('submit', submitAuth);
  $('email-banner-resend').addEventListener('click', resendEmailConfirmation);
  document.querySelectorAll('[data-banner-dismiss]').forEach(button => button.addEventListener('click', () => dismissBanner(button.dataset.bannerDismiss)));
  $('forgot-link').addEventListener('click', () => { const email = $('auth-email').value; setAuthMode('forgot', 'email'); $('auth-email').value = email; $('auth-email').focus(); });
  $('forgot-recovery-link').addEventListener('click', () => { const email = $('auth-email').value; setAuthMode('forgot', 'recovery'); $('auth-email').value = email; $('auth-email').focus(); });
  $('reset-back').addEventListener('click', () => { resetToken = null; setAuthMode('forgot', 'email'); $('auth-email').focus(); });
  $('recovery-key-saved').addEventListener('change', () => { $('recovery-key-done').disabled = !$('recovery-key-saved').checked; });
  $('recovery-key-done').addEventListener('click', () => recoveryDone?.());
  $('recovery-show-dialog').addEventListener('cancel', event => event.preventDefault());
  $('recovery-key-copy').addEventListener('click', () => navigator.clipboard.writeText($('recovery-key-text').textContent).then(() => toast('Recovery key copied.'), () => toast('Could not copy. Select the key and copy it manually.', true)));
  $('recovery-key-download').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`Fretlark recovery key for ${localOwner}\n\n${$('recovery-key-text').textContent}\n\nUse this with your username to reset your password.\n`], {type: 'text/plain'}));
    link.download = 'fretlark-recovery-key.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  const openRecoveryForm = () => { closeDialog('account-dialog'); status('recovery-status', ''); $('recovery-form').reset(); openDialog('recovery-dialog', 'recovery-password'); };
  $('recovery-open').addEventListener('click', openRecoveryForm);
  $('recovery-form').addEventListener('submit', async event => {
    event.preventDefault(); const submit = $('recovery-submit'); submit.disabled = true; status('recovery-status', '');
    try {
      const result = await api('auth/recovery-key', json('POST', {current_password: $('recovery-password').value}));
      sessionState.hasRecoveryKey = true;
      closeDialog('recovery-dialog'); renderAccountBanners();
      await showRecoveryKey(result.recovery_key, 'Your new recovery key');
    } catch (error) { status('recovery-status', error.message || 'Could not create a key.', true); }
    finally { submit.disabled = false; }
  });
  $('username-open').addEventListener('click', () => { closeDialog('account-dialog'); status('username-status', ''); $('username-form').reset(); openDialog('username-dialog', 'username-new'); });
  $('username-form').addEventListener('submit', async event => {
    event.preventDefault(); const submit = $('username-submit'); submit.disabled = true; status('username-status', '');
    try {
      const previous = localOwner;
      const result = await api('auth/username', json('POST', {new_username: $('username-new').value, current_password: $('username-password').value}));
      window.LocalSongs?.move(previous, result.email);
      closeDialog('username-dialog'); toast(`Username changed to ${result.email}.`);
      await init();
    } catch (error) { status('username-status', error.message || 'Could not change the username.', true); }
    finally { submit.disabled = false; }
  });
  $('auth-toggle').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
  $('signout').addEventListener('click', signOut);
  $('password-open').addEventListener('click',()=>{closeDialog('account-dialog');status('password-status','');openDialog('password-dialog','current-password');});
  $('password-form').addEventListener('submit',changePassword);
  $('claim-lessons').addEventListener('click', claimLegacyLessons);
  $('retry-access').addEventListener('click', init);
  $('retry-library').addEventListener('click', loadLessons);
  $('lesson-list').addEventListener('click', onLessonAction);
  $('upload-form').addEventListener('submit', submitUpload);
  $('details-form').addEventListener('submit', submitDetails);
  $('delete-lesson').addEventListener('click', () => deleteLesson(selected));
  $('selected-device').addEventListener('click', () => { keepOnDevice(lessons.find(item => item.id === librarySelectedId)); });
  $('selected-delete').addEventListener('click', () => { const song = librarySong(librarySelectedId); if (song?.local_id) deleteLocalSong(song); else deleteLesson(song); });
  $('selected-cloud-save').addEventListener('click', () => saveLocalToCloud(librarySong(librarySelectedId)));
  $('local-songs').addEventListener('click', event => {const button=event.target.closest('[data-local-cloud]');if(button)saveLocalToCloud(librarySong(`local:${button.dataset.localCloud}`));});
  $('replace-file').addEventListener('change', event => {
    replacement = event.target.files[0] || null;
    $('replace-name').textContent = replacement?.name || 'Keeps the same shared link';
  });
  $('detail-share').addEventListener('click', () => {
    const lesson = lessons.find(item => item.id === librarySelectedId);
    if (lesson) showShare(lesson);
  });
  $('selected-settings').addEventListener('click', () => {
    const lesson = lessons.find(item => item.id === librarySelectedId);
    if (lesson) showDetails(lesson);
  });
  $('detail-back').addEventListener('click', () => {
    $('workspace').classList.remove('detail-open');
    (Array.from($('lesson-list').children).find(row => row.dataset.id === librarySelectedId) || $('search')).focus();
  });
  $('copy-link').addEventListener('click', copyLink);
  $('copy-embed').addEventListener('click', copyEmbed);
  $('rotate-link').addEventListener('click', rotateLink);
  $('share-enabled').addEventListener('change', changeShareAccess);
  $('share-dialog').addEventListener('change',event=>{
    const input=event.target;
    if(input.id==='share-enabled')return;
    if(input.name==='share-allowed-notation'){
      const modes=[...document.querySelectorAll('[name="share-allowed-notation"]:checked')].map(node=>node.value),previous=$('share-default-notation').value;
      if(!modes.length){input.checked=true;status('share-message','Keep at least one notation view.',true);return;}
      $('share-default-notation').innerHTML=modes.map(mode=>`<option value="${mode}">${notationNames[mode]}</option>`).join('');
      $('share-default-notation').value=modes.includes(previous)?previous:modes[0];
    }
    if(input.id==='share-track-scope'&&input.value==='selected'&&!$('share-track-list').children.length){status('share-message','Wait for tracks to load, then try again.',true);renderShare();return;}
    if(input.matches('input, select'))saveShareSettings();
  });
  $('search').addEventListener('input', render);
  $('overview').addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target.closest?.('[data-open-song], [data-copy-link], [data-share-song]');
    if (!target || event.target.closest('a,button,input,select,textarea')) return;
    event.preventDefault();
    target.click();
  });
  $('overview').addEventListener('click', event => {
    const target = event.target.closest('[data-copy-link], [data-share-song], [data-open-song], [data-goto-filter]');
    if (!target) return;
    if (target.dataset.gotoFilter) { setFilter(document.querySelector(`[data-filter="${target.dataset.gotoFilter}"]`)); return; }
    const lesson = librarySong(target.dataset.copyLink || target.dataset.shareSong || target.dataset.openSong);
    if (!lesson) return;
    if (target.dataset.copyLink) {
      navigator.clipboard.writeText(shareUrl(lesson)).then(() => toast(`Link to “${lesson.title}” copied.`), () => toast('Could not copy the link.', true));
    } else if (target.dataset.shareSong) {
      showShare(lesson, target);
    } else {
      librarySelectedId = lesson.id;
      setFilter(document.querySelector('[data-filter="all"]'));
      $('workspace').classList.add('detail-open');
      $('selected-title').focus();
    }
  });
  $('selected-preview').addEventListener('click', openAudienceView);
  $('upload-selection').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-upload]');
    if (!remove || uploading) return;
    files.splice(Number(remove.dataset.removeUpload), 1);
    $('upload-files').value = '';
    renderUploadSelection();
    $('upload-files').focus();
  });
  $('upload-files').addEventListener('change', event => chooseFiles(event.target.files));
  $('empty-upload').addEventListener('click', openUpload);
  document.querySelectorAll('[data-upload-open]').forEach(button => button.addEventListener('click', openUpload));
  document.querySelectorAll('[data-account-open]').forEach(button => button.addEventListener('click', openAccount));
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => setFilter(button)));
  document.addEventListener('click', event => {
    const close = event.target.closest('[data-close]');
    if (!close || close.disabled) return;
    requestDialogClose(close.dataset.close);
  });
  window.addEventListener('beforeunload', event => {
    if (($('details-dialog').open && hasUnsavedChanges('details-dialog')) || ($('upload-dialog').open && hasUnsavedChanges('upload-dialog')) || savingDetails || uploading || savingShare || savingPassword) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  $('lesson-list').addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('.lesson-row')) {
      event.preventDefault();
      onLessonAction(event);
      return;
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const row = event.target.closest('[data-id]');
    const lesson = row && lessons.find(item => item.id === row.dataset.id);
    if (lesson) { event.preventDefault(); deleteLesson(lesson); }
  });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !$('workspace').hidden) {
      event.preventDefault();
      if (filter === 'overview') setFilter(document.querySelector('[data-filter="all"]'));
      $('search').focus();
    }
  });
  accountControls=window.setupAccountControls({api,json,toast,openDialog,closeDialog,loadStorage,username:()=>localOwner,session:()=>sessionState,refreshSession});
  $('auth-factor-back').addEventListener('click',()=>{setAuthMode('login');$('access-message').textContent=authCopy.login;$('auth-password').focus();});
  $('auth-factor-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('auth-factor-submit');if(button.disabled)return;button.disabled=true;status('auth-factor-status','');
    try{
      await api('auth/verify',json('POST',{challenge:authChallenge,code:$('auth-factor-code').value}));
      authChallenge=null;$('auth-factor-code').value='';if(nextPath){location.replace(nextPath);return;}await init();
    }catch(error){status('auth-factor-status',error.message,true);}finally{button.disabled=false;}
  });
  installUploadDrop();
  wireDialogs();

  $('search-shortcut').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  $('password-toggle').addEventListener('click', () => {
    const show = $('auth-password').type === 'password';
    $('auth-password').type = show ? 'text' : 'password';
    $('password-toggle').setAttribute('aria-pressed', String(show));
    $('password-toggle').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  setAuthMode(authMode);
  (async () => { await handleEmailVerify(); await init(); })();
})();
