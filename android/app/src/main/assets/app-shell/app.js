// Fretlark for Android: loaded into every page by the app (see AppAssets.kt).
//
// The pages are the same ones the website serves. This file adds what a phone app needs on top:
// the floating tab bar, tab pages, a create sheet, file saving, the back button and the colour of
// the system bars. Everything here is skipped on the website.
(() => {
  if (window.__fretlarkApp) return;
  window.__fretlarkApp = true;

  const root = document.documentElement;
  const top = window.self === window.top;
  const path = location.pathname;
  const page = /^\/admin\/?$/.test(path) ? 'admin'
    : /^\/editor\/player\.html$/.test(path) ? 'player'
    : /^\/editor\/video\.html$/.test(path) ? 'video'
    : /^\/editor(\/|\/index\.html)?$/.test(path) ? 'editor'
    : /^\/set\//.test(path) ? 'set' : 'page';
  root.classList.add('fl-app', 'fl-' + page);
  if (!top) root.classList.add('fl-framed');

  // ---------- bridge to the app ----------
  const bridge = window.FretlarkApp;
  const send = message => { try { if (bridge) bridge.postMessage(JSON.stringify(message)); } catch {} return Boolean(bridge); };
  const toUrl = value => { try { return new URL(value, location.href); } catch { return null; } };
  const tick = () => send({t: 'haptic'});

  // Printing. The score library prints by opening a small window, drawing the print layout into it
  // and printing that window. The app has no extra windows, so the layout is drawn into a hidden
  // part of this page instead, and only that part is printed.
  let printJob = null;
  function printWindow() {
    if (printJob) printJob.close();
    const host = document.createElement('div');
    host.className = 'fl-print-host';
    document.body.appendChild(host);
    let sent = false, title = '';
    const job = {
      document: {
        createElement: tag => document.createElement(tag),
        write() {},
        get title() { return title; },
        set title(value) { title = String(value); },
        body: host
      },
      onunload: null,
      resizeTo() {}, moveTo() {}, focus() {},
      print() {
        if (sent) return;
        sent = true;
        root.classList.add('fl-printing');
        send({t: 'print', title});
        // The print screen covers the app. When the app is visible again, tidy up.
        let wasHidden = false;
        const done = () => {
          if (document.hidden) { wasHidden = true; return; }
          if (wasHidden) job.close();
        };
        job.watch = done;
        document.addEventListener('visibilitychange', done);
        job.timer = setTimeout(() => job.close(), 5 * 60 * 1000);
      },
      close() {
        if (printJob !== job) return;
        printJob = null;
        clearTimeout(job.timer);
        if (job.watch) document.removeEventListener('visibilitychange', job.watch);
        root.classList.remove('fl-printing');
        try { if (job.onunload) job.onunload(); } catch {}
        host.remove();
      }
    };
    printJob = job;
    return job;
  }

  // New tabs do not exist in the app: the app decides where a link opens.
  const nativeOpen = window.open.bind(window);
  window.open = (value, target, features) => {
    if (bridge && !value) return printWindow();
    const url = toUrl(value);
    if (!bridge || !value || !url || url.protocol === 'blob:' || url.protocol === 'about:') return nativeOpen(value, target, features);
    send({t: 'open', url: url.href});
    return null;
  };

  if (bridge) {
    window.print = () => send({t: 'print', title: document.title.replace(/\s*[—-]\s*Fretlark$/, '')});
    try {
      const clipboard = navigator.clipboard || {};
      const write = text => { send({t: 'copy', text: String(text)}); return Promise.resolve(); };
      if (navigator.clipboard) navigator.clipboard.writeText = write;
      else Object.defineProperty(navigator, 'clipboard', {value: Object.assign(clipboard, {writeText: write}), configurable: true});
    } catch {}
  }

  // ---------- saving files the page creates ----------
  // The page builds exports (GP, MIDI, WAV, video...) in memory and "downloads" them through a
  // link. A web view cannot do that, so the bytes go to the app in pieces and land in Downloads.
  let saveCount = 0;
  const CHUNK = 3 * 128 * 1024; // A multiple of 3, so each piece is valid base64 on its own.
  async function saveBlob(blob, name) {
    const id = `${Date.now()}-${++saveCount}`;
    send({t: 'save-begin', id, name: name || 'fretlark-file', mime: blob.type || ''});
    try {
      for (let offset = 0; offset < blob.size; offset += CHUNK) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        send({t: 'save-chunk', id, data: btoa(binary)});
        // Yield so a long export never freezes the screen.
        if (offset % (CHUNK * 8) === 0) await new Promise(resolve => setTimeout(resolve));
      }
      send({t: 'save-end', id});
    } catch {
      send({t: 'save-abort', id});
    }
  }
  const memoryLink = link => link instanceof HTMLAnchorElement && link.hasAttribute('download') && /^(blob|data):/.test(link.href);
  function saveLink(link) {
    // Start reading at once: pages revoke the address right after the click.
    const name = link.getAttribute('download');
    fetch(link.href).then(response => response.blob()).then(blob => saveBlob(blob, name)).catch(() => {});
  }
  if (bridge) {
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (memoryLink(this)) { saveLink(this); return; }
      return nativeClick.call(this);
    };
    document.addEventListener('click', event => {
      const link = event.target.closest && event.target.closest('a[download]');
      if (!link || !memoryLink(link)) return;
      event.preventDefault();
      saveLink(link);
    }, true);
  }

  // ---------- leaving the editor or player ----------
  // Asks the page the same question a browser asks before closing a tab with unsaved work.
  const unsaved = () => {
    const event = new Event('beforeunload', {cancelable: true});
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  async function leave() {
    if (unsaved()) {
      const ask = window.appConfirm || (text => Promise.resolve(window.confirm(text)));
      if (!await ask('Leave without saving?\n\nYour latest changes are not saved to your Library yet.', {ok: 'Leave', danger: true})) return;
    }
    if (!send({t: 'close'})) location.href = '/admin';
  }
  if (page !== 'admin' && page !== 'page' && top) {
    document.addEventListener('click', event => {
      const link = event.target.closest && event.target.closest('a[href]');
      if (!link || event.defaultPrevented) return;
      const url = toUrl(link.getAttribute('href'));
      if (!url || url.origin !== location.origin || !/^\/(admin\/?)?$/.test(url.pathname) || url.search) return;
      event.preventDefault();
      leave();
    }, true);
  }

  // ---------- the back button ----------
  // Returns true when the page used the press (closed a sheet, a menu, a song). Otherwise the app
  // goes back a screen.
  const openModal = () => Array.from(document.querySelectorAll('dialog[open]')).filter(dialog => dialog.matches(':modal')).pop();
  const backHandlers = [];
  function back() {
    const frame = Array.from(document.querySelectorAll('iframe')).find(item => { try { return item.contentWindow.FretlarkShell && item.offsetParent; } catch { return false; } });
    try { if (frame && frame.contentWindow.FretlarkShell.back(true)) return true; } catch {}
    const modal = openModal();
    if (modal) {
      const closer = modal.querySelector('[data-close],[data-close-report],.dialog-head .icon-button,.dialog-header .icon-button,.settings-header .icon-button,[aria-label^="Close"]');
      if (closer && !closer.disabled) closer.click(); else modal.close();
      return true;
    }
    const popover = document.querySelector(':popover-open');
    if (popover) { popover.hidePopover(); return true; }
    for (const handler of backHandlers) if (handler()) return true;
    if (arguments[0] === true) return false; // Asked by the page around this frame.
    if (page !== 'admin' && page !== 'page' && top && unsaved()) { leave(); return true; }
    return false;
  }

  // ---------- system bar colours ----------
  // The strips behind the status bar and the gesture bar take the colour of the page edge they
  // touch, including the dimming behind an open sheet.
  const parse = value => {
    const m = /rgba?\(([^)]+)\)/.exec(value || '');
    if (!m) return null;
    const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1};
  };
  const over = (front, behind) => ({r: front.r * front.a + behind.r * (1 - front.a), g: front.g * front.a + behind.g * (1 - front.a), b: front.b * front.a + behind.b * (1 - front.a), a: 1});
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  function colourAt(x, y) {
    const base = parse(getComputedStyle(document.body).backgroundColor);
    const canvas = parse(getComputedStyle(root).backgroundColor);
    let colour = {r: 255, g: 255, b: 255, a: 1};
    if (canvas && canvas.a) colour = over(canvas, colour);
    if (base && base.a) colour = over(base, colour);
    const stack = [];
    for (let node = document.elementFromPoint(x, y); node && node !== root; node = node.parentElement) stack.unshift(node);
    for (const node of stack) {
      if (node === document.body) continue;
      const layer = parse(getComputedStyle(node).backgroundColor);
      if (layer && layer.a) colour = over(layer, colour);
    }
    return colour;
  }
  let lastChrome = '';
  function reportChrome() {
    if (!top || !document.body) return;
    const width = innerWidth, height = innerHeight;
    let above = colourAt(width / 2, 1), below = colourAt(width / 2, height - 2);
    const modal = openModal();
    if (modal) {
      const box = modal.getBoundingClientRect();
      const dim = parse(getComputedStyle(modal, '::backdrop').backgroundColor);
      if (dim && dim.a) {
        if (box.top > 2) above = over(dim, above);
        if (box.bottom < height - 2) below = over(dim, below);
      }
    }
    const next = hex(above) + hex(below);
    if (next === lastChrome) return;
    lastChrome = next;
    send({t: 'chrome', top: hex(above), bottom: hex(below)});
  }
  let chromeTimer = 0;
  const queueChrome = () => {
    if (!top) return;
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(() => { reportChrome(); setTimeout(reportChrome, 380); }, 30);
  };

  // ---------- keyboard ----------
  // While typing, the keyboard takes the bottom of the screen: move the tab bar out of its way.
  const typing = node => node && node.matches && node.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]),textarea,[contenteditable=""],[contenteditable=true]');
  document.addEventListener('focusin', event => root.classList.toggle('fl-typing', Boolean(typing(event.target))));
  document.addEventListener('focusout', () => setTimeout(() => root.classList.toggle('fl-typing', Boolean(typing(document.activeElement))), 60));

  window.FretlarkShell = {back, resume: () => { lastChrome = ''; queueChrome(); window.dispatchEvent(new Event('fretlark:resume')); }};

  const icon = paths => `<svg class="fl-icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    home: icon('<path d="M4 10.6 12 4l8 6.6V19a1.5 1.5 0 0 1-1.5 1.5h-3.75V15a1 1 0 0 0-1-1h-3.5a1 1 0 0 0-1 1v5.5H5.5A1.5 1.5 0 0 1 4 19Z"/>'),
    songs: icon('<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
    setlists: icon('<rect x="3.5" y="8.5" width="17" height="12" rx="2.5"/><path d="M6.5 5.5h11M8.5 2.75h7"/>'),
    settings: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
    account: icon('<circle cx="12" cy="8.5" r="3.75"/><path d="M4.75 20.25c.9-3.6 3.75-5.5 7.25-5.5s6.35 1.9 7.25 5.5"/>'),
    plus: icon('<path d="M12 5v14M5 12h14"/>'),
    pencil: icon('<path d="M15.5 5.5 18.5 8.5M4 20l1-4L16.2 4.8a2.1 2.1 0 0 1 3 3L8 19z"/>'),
    upload: icon('<path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5"/><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/>'),
    chevron: icon('<path d="m9.5 5 7 7-7 7"/>'),
    back: icon('<path d="m14.5 5-7 7 7 7"/>'),
    close: icon('<path d="m6 6 12 12M6 18 18 6"/>'),
    share: icon('<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="5.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.1-4.1M8.2 13.2l7.1 4.1"/>')
  };

  // ---------- account page (opened from the native Settings tab) ----------
  // Shows only the account sheet. Closing it, or signing out, returns to the native app.
  function accountOnly(workspace) {
    root.classList.add('fl-account-only');
    let opened = false, idle = 0;
    const timer = setInterval(() => {
      const button = document.querySelector('[data-account-open]');
      if (!opened) {
        if (button && !workspace.hidden) { button.click(); opened = true; }
        else if (++idle > 80) { clearInterval(timer); send({t: 'close'}); }
        return;
      }
      if (workspace.hidden) { clearInterval(timer); send({t: 'signed-out'}); return; }
      // Password, recovery and two-factor forms replace the account sheet for a moment.
      if (document.querySelector('dialog[open]')) idle = 0;
      else if (++idle > 3) { clearInterval(timer); send({t: 'close'}); }
    }, 150);
  }

  // ---------- dashboard ----------
  function dashboard() {
    const $ = id => document.getElementById(id);
    const workspace = $('workspace');
    if (!workspace) return;
    if (location.hash === '#account') { accountOnly(workspace); return; }
    const phone = window.matchMedia('(max-width: 767px)');
    const PAGES = ['setlists-dialog', 'account-dialog'];
    const filterButton = name => document.querySelector(`.library-filters [data-filter="${name}"]`);
    let libraryFilter = 'all';

    // Setlists and Account are sheets on the website. On a phone they are tabs: full pages that
    // stay under the tab bar.
    const nativeShowModal = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () {
      if (PAGES.includes(this.id) && phone.matches) {
        for (const id of PAGES) if (id !== this.id && $(id) && $(id).open) $(id).close();
        this.classList.add('fl-tab-page');
        this.show();
        this.scrollTop = 0;
        return;
      }
      this.classList.remove('fl-tab-page');
      return nativeShowModal.call(this);
    };
    const closePages = () => { for (const id of PAGES) if ($(id) && $(id).open) $(id).close(); };

    const bar = document.createElement('nav');
    bar.className = 'fl-tabbar';
    bar.setAttribute('aria-label', 'Main');
    bar.innerHTML = `<div class="fl-tabs" role="tablist">
        <span class="fl-tab-pill" aria-hidden="true"></span>
        <button type="button" role="tab" class="fl-tab" data-tab="home">${ICONS.home}<span>Home</span></button>
        <button type="button" role="tab" class="fl-tab" data-tab="songs">${ICONS.songs}<span>Songs</span></button>
        <button type="button" role="tab" class="fl-tab" data-tab="setlists">${ICONS.setlists}<span>Setlists</span></button>
        <button type="button" role="tab" class="fl-tab" data-tab="account">${ICONS.settings}<span>Settings</span><i class="fl-dot" hidden></i></button>
      </div>
      <button type="button" class="fl-create" aria-label="Create" aria-haspopup="dialog">${ICONS.plus}</button>`;
    document.body.appendChild(bar);

    const sheet = document.createElement('dialog');
    sheet.className = 'fl-sheet';
    sheet.setAttribute('aria-label', 'Create');
    sheet.innerHTML = `<div class="fl-sheet-grip" aria-hidden="true"></div>
      <h2>Create</h2>
      <button type="button" class="fl-action" data-create="new"><span class="fl-action-icon">${ICONS.pencil}</span><span class="fl-action-copy"><strong>New song</strong><small>Start a tab from scratch in the editor</small></span>${ICONS.chevron}</button>
      <button type="button" class="fl-action" data-create="upload"><span class="fl-action-icon">${ICONS.upload}</span><span class="fl-action-copy"><strong>Upload files</strong><small>Guitar Pro, MusicXML, alphaTex or MIDI</small></span>${ICONS.chevron}</button>
      <button type="button" class="fl-action" data-create="setlist"><span class="fl-action-icon">${ICONS.setlists}</span><span class="fl-action-copy"><strong>New setlist</strong><small>Group songs and share them with one link</small></span>${ICONS.chevron}</button>`;
    document.body.appendChild(sheet);
    sheet.addEventListener('click', event => {
      const action = event.target.closest('[data-create]');
      if (!action) { if (event.target === sheet) sheet.close(); return; }
      sheet.close();
      if (action.dataset.create === 'new') location.href = '/editor/index.html?new=1';
      else if (action.dataset.create === 'upload') document.querySelector('[data-upload-open]').click();
      else {
        go('setlists');
        // The list loads first; press its own "New setlist" as soon as it is there.
        let tries = 0;
        const press = () => {
          const button = document.querySelector('#setlists-dialog [data-setlists-new]');
          if (button && button.offsetParent) button.click();
          else if (++tries < 20) setTimeout(press, 100);
        };
        setTimeout(press, 120);
      }
    });

    // Filter chips: All, Shared and Private move from the old tab bar to the top of the library.
    const chips = document.createElement('div');
    chips.className = 'fl-chips';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Filter songs');
    chips.innerHTML = [['all', 'All'], ['shared', 'Shared'], ['private', 'Private']]
      .map(([name, label]) => `<button type="button" class="fl-chip" data-chip="${name}">${label}<b></b></button>`).join('');
    const heading = document.querySelector('.library-heading');
    if (heading) heading.appendChild(chips);
    chips.addEventListener('click', event => {
      const chip = event.target.closest('[data-chip]');
      if (!chip) return;
      tick();
      filterButton(chip.dataset.chip).click();
    });

    const current = () => {
      if ($('account-dialog') && $('account-dialog').open && $('account-dialog').classList.contains('fl-tab-page')) return 'account';
      if ($('setlists-dialog') && $('setlists-dialog').open && $('setlists-dialog').classList.contains('fl-tab-page')) return 'setlists';
      const active = document.querySelector('.library-filters [data-filter].active');
      return !active || active.dataset.filter === 'overview' ? 'home' : 'songs';
    };
    function go(tab) {
      const was = current();
      if (tab === 'home' || tab === 'songs') {
        closePages();
        const target = filterButton(tab === 'home' ? 'overview' : libraryFilter);
        // Tapping the tab you are on scrolls it back to the top, as phone apps do.
        if (was === tab && !workspace.classList.contains('detail-open')) {
          const scroller = tab === 'home' ? $('overview') : document.querySelector('.library-results');
          if (scroller) scroller.scrollTo({top: 0, behavior: 'smooth'});
        } else target.click();
      } else if (tab === 'setlists') {
        if (was !== 'setlists') document.querySelector('[data-setlists-open]').click();
      } else if (was !== 'account') document.querySelector('[data-account-open]').click();
      sync();
    }
    bar.addEventListener('click', event => {
      const tab = event.target.closest('[data-tab]');
      if (tab) { tick(); go(tab.dataset.tab); return; }
      if (event.target.closest('.fl-create')) { tick(); nativeShowModal.call(sheet); }
    });

    // Writes only real changes, so the observers below never see their own work.
    const attr = (node, name, value) => { if (node.getAttribute(name) !== value) node.setAttribute(name, value); };
    const hide = (node, hidden) => { if (node.hidden !== hidden) node.hidden = hidden; };
    function render() {
      syncQueued = false;
      const signedIn = !workspace.hidden;
      const tab = current();
      root.classList.toggle('fl-signed-in', signedIn);
      root.classList.toggle('fl-detail', workspace.classList.contains('detail-open') && (tab === 'songs' || tab === 'home'));
      if (root.dataset.flTab !== tab) root.dataset.flTab = tab;
      Array.from(bar.querySelectorAll('.fl-tab')).forEach((button, index) => {
        const on = button.dataset.tab === tab;
        button.classList.toggle('active', on);
        attr(button, 'aria-selected', String(on));
        if (on) bar.querySelector('.fl-tabs').style.setProperty('--fl-index', index);
      });
      const active = document.querySelector('.library-filters [data-filter].active');
      if (active && active.dataset.filter !== 'overview') libraryFilter = active.dataset.filter;
      for (const chip of chips.children) {
        const on = chip.dataset.chip === libraryFilter;
        chip.classList.toggle('active', on);
        attr(chip, 'aria-pressed', String(on));
        const count = document.querySelector(`.library-filters [data-count="${chip.dataset.chip}"]`);
        const text = count ? count.textContent : '';
        if (chip.lastElementChild.textContent !== text) chip.lastElementChild.textContent = text;
      }
      // Reports waiting for the owner show as a dot on Account.
      const reports = document.querySelector('.sidebar [data-report-count]');
      hide(bar.querySelector('.fl-dot'), !(reports && reports.textContent.trim() && !$('sidebar-admin').hidden));
      queueChrome();
    }
    let syncQueued = false;
    const sync = () => { if (!syncQueued) { syncQueued = true; queueMicrotask(render); } };
    new MutationObserver(sync).observe(document.body, {subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'class', 'aria-pressed'], childList: false});
    new MutationObserver(sync).observe(document.querySelector('.library-filters'), {subtree: true, characterData: true, childList: true});
    phone.addEventListener('change', () => { if (!phone.matches) closePages(); sync(); });
    render();

    // Back: an open song first, then tab pages, then the library before Home.
    backHandlers.push(() => {
      if (!phone.matches || workspace.hidden) return false;
      const search = $('search');
      if (document.activeElement === search) { search.blur(); return true; }
      if (root.classList.contains('fl-detail')) { $('detail-back').click(); return true; }
      if (current() !== 'home') { go('home'); return true; }
      return false;
    });

    // Coming back from the editor: show what was just saved.
    addEventListener('fretlark:resume', () => { if (!workspace.hidden) $('retry-library').click(); });

    // A native share sheet next to "Copy link".
    document.addEventListener('click', event => {
      const share = event.target.closest('[data-fl-share]');
      if (!share) return;
      const field = document.querySelector(share.dataset.flShare);
      const text = field && (field.value || field.textContent || '').trim();
      if (!text) return;
      if (!send({t: 'share', text}) && navigator.share) navigator.share({url: text}).catch(() => {});
    });
    const addShare = () => {
      for (const [selector, field] of [['#copy-link', '#share-url'], ['[data-setlist-copy]', '#setlist-url']]) {
        const copy = document.querySelector(selector);
        if (!copy || !document.querySelector(field) || copy.parentElement.querySelector('[data-fl-share]')) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button fl-share-button';
        button.dataset.flShare = field;
        button.innerHTML = `${ICONS.share}<span>Send</span>`;
        copy.after(button);
      }
    };
    new MutationObserver(addShare).observe(document.body, {subtree: true, childList: true});
    addShare();
  }

  // ---------- player ----------
  function player() {
    if (!top) return;
    // The app has no address bar or tab strip, so every song needs a way back.
    const backLink = document.getElementById('back-library');
    const header = document.querySelector('.player-header');
    if (backLink && header) {
      backLink.classList.add('fl-back');
      header.prepend(backLink);
      const show = () => { if (backLink.hidden) backLink.hidden = false; };
      show();
      new MutationObserver(show).observe(backLink, {attributes: true, attributeFilter: ['hidden']});
    }
    // Back closes the small practice sheets before it leaves the song.
    backHandlers.push(() => {
      const range = document.getElementById('repeat-range');
      if (range && !range.hidden) { document.getElementById('close-range')?.click(); return true; }
      const hand = document.getElementById('hand-guide');
      if (hand && !hand.hidden) { document.getElementById('close-hand-guide')?.click(); return true; }
      return false;
    });
  }

  // ---------- shared setlist ----------
  function setlist() {
    // The brand link at the top becomes the way back.
    const brand = document.querySelector('.set-brand');
    if (!brand || !top) return;
    // Each song loads in a frame, which would make Back step through songs already played.
    // Back leaves the setlist instead.
    backHandlers.push(() => { leave(); return true; });
    brand.classList.add('fl-back');
    brand.setAttribute('aria-label', 'Back');
    brand.innerHTML = `${ICONS.back}<span>Back</span>`;
  }

  // ---------- editor ----------
  function editor() {
    const toolbar = document.querySelector('.mobile-toolbar');
    if (!toolbar || toolbar.querySelector('.fl-back')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button fl-back';
    button.setAttribute('aria-label', 'Back to library');
    button.innerHTML = ICONS.back;
    button.addEventListener('click', leave);
    toolbar.prepend(button);

    // One open song needs no tab strip: the header already names it. Keep the strip (and the
    // unsaved dot in it) once there is more than one document, and mirror the dot in the header.
    const tabs = document.querySelector('.file-tabs');
    const dirty = document.querySelector('.tab-dirty');
    if (tabs) {
      const sync = () => {
        const multi = tabs.querySelectorAll('.file-tab').length > 1;
        const unsaved = Boolean(dirty && dirty.classList.contains('unsaved')) ||
          Array.from(tabs.querySelectorAll('.tab-unsaved')).some(node => node.textContent.trim() !== '');
        root.classList.toggle('fl-multi-doc', multi);
        root.classList.toggle('fl-dirty', unsaved);
      };
      new MutationObserver(sync).observe(tabs, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class']});
      sync();
    }

    // The palette and inspector are drawers on a phone: tapping the dimmed page, or Back,
    // closes them like any other sheet.
    const phone = window.matchMedia('(max-width: 767px)');
    const openPanel = () => document.body.classList.contains('show-palette') || document.body.classList.contains('show-inspector');
    const closePanel = () => { document.body.classList.remove('show-palette', 'show-inspector'); };
    document.addEventListener('click', event => {
      if (!phone.matches || !openPanel()) return;
      if (event.target.closest('dialog,.palette,.inspector,#btn-toggle-palette,#btn-toggle-inspector,[data-click="btn-toggle-palette"],[data-click="btn-toggle-inspector"]')) return;
      closePanel();
    });
    backHandlers.push(() => { if (!phone.matches || !openPanel()) return false; closePanel(); return true; });

    // The track mixer is a sheet too. It starts closed so the touch keyboard owns the bottom,
    // and its More > Track mixer action opens it; the close button or the page behind closes it.
    if (phone.matches) document.body.classList.add('hide-mixer');
    const dock = document.querySelector('.track-dock');
    if (phone.matches && dock && !dock.querySelector('.fl-dock-close')) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'fl-dock-close';
      close.setAttribute('aria-label', 'Close track mixer');
      close.innerHTML = ICONS.close;
      close.addEventListener('click', event => { event.stopPropagation(); document.body.classList.add('hide-mixer'); });
      dock.querySelector('.dock-topline')?.append(close);
    }
    document.addEventListener('click', event => {
      if (!phone.matches || document.body.classList.contains('hide-mixer')) return;
      if (event.target.closest('dialog,.track-dock,#btn-toggle-mixer,[data-click="btn-toggle-mixer"]')) return;
      document.body.classList.add('hide-mixer');
    });
    backHandlers.push(() => {
      if (!phone.matches || document.body.classList.contains('hide-mixer')) return false;
      document.body.classList.add('hide-mixer');
      return true;
    });

    // The More sheet is a menu, not a dump: group its actions under quiet headings and drop
    // the desktop-only proxies (keyboard shortcuts, fullscreen, focus mode, the Library link).
    const grid = document.querySelector('.more-grid');
    if (grid && !grid.querySelector('.fl-more-heading')) {
      const buttons = new Map();
      for (const node of grid.children) if (node.matches('button[data-click]')) buttons.set(node.dataset.click, node);
      const labels = new Map();
      for (const node of grid.children) if (node.matches('label')) {
        const field = node.querySelector('input,select');
        if (field) labels.set(field.id, node);
      }
      const groups = [
        ['Song', ['btn-cloud-save', 'btn-device-save', 'btn-save', 'btn-download']],
        ['Open', ['btn-new', 'btn-open']],
        ['Practice', ['btn-stop', 'btn-loop', 'loop-current', 'loop-full', 'btn-metronome', 'btn-count-in']],
        ['Export', ['btn-midi', 'btn-wav', 'btn-ascii', 'btn-print']],
        ['View', ['btn-toggle-palette', 'btn-toggle-inspector', 'btn-toggle-mixer', 'btn-fretboard']],
        ['Settings', ['mobile-loop-start', 'mobile-loop-end', 'mobile-tempo-input', 'mobile-master-volume', 'mobile-speed-select', 'mobile-layout-select', 'mobile-notation-select', 'mobile-zoom-select']]
      ];
      grid.textContent = '';
      for (const [title, keys] of groups) {
        const heading = document.createElement('div');
        heading.className = 'fl-more-heading';
        heading.textContent = title;
        grid.append(heading);
        for (const key of keys) {
          const node = buttons.get(key) || labels.get(key);
          if (node) grid.append(node);
        }
      }
      // The fretboard lives in the inspector, which is a drawer on a phone. Opening the
      // fretboard from More should bring its drawer along, not toggle a hidden panel.
      grid.addEventListener('click', event => {
        if (!phone.matches || !event.target.closest('[data-click="btn-fretboard"]')) return;
        document.body.classList.remove('show-palette');
        document.body.classList.add('show-inspector');
      });
    }
  }

  function start() {
    try {
      if (page === 'admin') dashboard();
      else if (page === 'player') player();
      else if (page === 'editor') editor();
      else if (page === 'set') setlist();
    } catch (error) { console.error('Fretlark app shell', error); }
    if (top) {
      new MutationObserver(queueChrome).observe(root, {subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'data-theme', 'class']});
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', queueChrome);
      addEventListener('resize', queueChrome);
      addEventListener('load', queueChrome);
      queueChrome();
      send({t: 'ready'});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
