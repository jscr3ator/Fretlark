/* Owner-only song reports: sidebar count, overview notice and the review dialog. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const reasons = {copyright: 'Copyright', inappropriate: 'Inappropriate', broken: "Doesn't work", other: 'Other'};
  const linkStates = {live: ['Link live', 'is-on'], off: ['Link off', ''], deleted: ['Song deleted', '']};
  const relative = new Intl.RelativeTimeFormat(undefined, {numeric: 'auto'});
  const ago = ms => {
    const seconds = Math.min(0, (ms - Date.now()) / 1000);
    for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]])
      if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
    return 'just now';
  };
  const LIMIT = 3;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  let owner = false, filter = 'open', busy = false, timer = null, requestId = 0;

  async function call(path, method = 'GET', body) {
    const response = await fetch(`/api/owner/reports${path}`, {method, cache: 'no-store', credentials: 'same-origin',
      headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  function showCount(open) {
    document.querySelectorAll('[data-report-count]').forEach(node => { node.textContent = open ? String(open) : ''; });
    document.querySelectorAll('.reports-link').forEach(node => node.classList.toggle('has-open', open > 0));
    const notice = $('reports-notice');
    if (notice) {
      notice.hidden = !owner || !open;
      $('reports-notice-title').textContent = open === 1 ? '1 song reported' : `${open} songs reported`;
    }
  }

  async function refreshCount() {
    if (!owner || document.hidden) return;
    try { showCount((await call('')).open); } catch { /* Counts retry on the next refresh. */ }
  }

  function card(report) {
    const [linkLabel, linkClass] = linkStates[report.link_state] || linkStates.off;
    const live = report.link_state === 'live', resolved = report.status === 'resolved';
    const title = report.title || 'Untitled song';
    return `<article class="report-card${resolved ? ' is-resolved' : ''}" data-report="${esc(report.id)}">
      <div class="report-card-head">
        <div class="report-card-title"><strong>${esc(title)}</strong>${report.artist ? `<span>${esc(report.artist)}</span>` : ''}</div>
        <div class="report-badges"><span class="status-badge report-reason is-${esc(report.reason)}">${esc(reasons[report.reason] || report.reason)}</span><span class="status-badge ${linkClass}">${linkLabel}</span>${resolved ? '<span class="status-badge">Resolved</span>' : ''}</div>
      </div>
      <p class="report-meta">Shared by ${esc(report.uploader || 'a deleted account')}${report.uploader && report.violations ? ` · <span class="report-strikes">${plural(report.violations, 'violation')}</span>` : ''} · reported ${esc(ago(report.created_at))}</p>
      ${report.details ? `<p class="report-details">${esc(report.details)}</p>` : ''}
      ${report.contact ? `<p class="report-contact">Reply to <a href="mailto:${esc(report.contact)}">${esc(report.contact)}</a></p>` : ''}
      <div class="report-actions-row">
        ${live ? `<a class="button" href="/view/${esc(report.share_token)}" target="_blank" rel="noopener">Open song</a><button class="button danger-button" type="button" data-report-action="takedown">Turn off link</button>` : ''}
        <button class="button" type="button" data-report-action="${resolved ? 'reopen' : 'resolve'}">${resolved ? 'Reopen' : 'Mark resolved'}</button>
        <button class="text-button danger-text" type="button" data-report-action="delete">Delete</button>
      </div>
      ${live ? takedown(report) : ''}
    </article>`;
  }

  // Inline confirm for turning a link off, with the option to add a violation to the uploader's account.
  function takedown(report) {
    const canStrike = !!report.uploader, next = (report.violations || 0) + 1;
    const note = next >= LIMIT ? `This is their ${next === LIMIT ? 'third' : `${next}th`} violation: all their share links turn off and they can't share again.`
      : `They'll have ${next} of ${LIMIT}. At ${LIMIT}, all their share links turn off.`;
    return `<div class="report-takedown" hidden>
      <p><strong>Turn off this link?</strong> People with it can no longer open the song. The uploader keeps the song.</p>
      ${canStrike ? `<label class="report-strike"><input type="checkbox" data-report-strike ${report.reason === 'broken' ? '' : 'checked'}><span>Add a violation to ${esc(report.uploader)}<small>${esc(note)} They can't share this song again.</small></span></label>` : ''}
      <div class="report-actions-row"><button class="button" type="button" data-report-action="cancel">Cancel</button><button class="button danger-button" type="button" data-report-action="disable">Turn off link</button></div>
    </div>`;
  }

  async function load() {
    const id = ++requestId, list = $('reports-list');
    $('reports-status').textContent = '';
    if (!list.children.length) list.innerHTML = '<p class="reports-empty">Loading…</p>';
    try {
      const data = await call(filter === 'all' ? '?status=all' : '');
      if (id !== requestId) return;
      showCount(data.open);
      list.innerHTML = data.reports.length ? data.reports.map(card).join('')
        : `<div class="reports-empty"><svg class="icon"><use href="#i-flag"/></svg><strong>${filter === 'open' ? 'No open reports' : 'No reports yet'}</strong><span>When someone reports a shared song, it shows up here.</span></div>`;
    } catch (error) {
      if (id === requestId) { list.innerHTML = ''; $('reports-status').textContent = error.message; $('reports-status').classList.add('error'); }
    }
  }

  function setFilter(next) {
    filter = next;
    document.querySelectorAll('[data-report-filter]').forEach(button => {
      const active = button.dataset.reportFilter === next;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    });
    $('reports-list').innerHTML = '';
    load();
  }

  function open() {
    if (!owner) return;
    const account = $('account-dialog');
    if (account?.open) account.close();
    const dialog = $('reports-dialog');
    if (!dialog.open) dialog.showModal();
    setFilter('open');
  }

  document.addEventListener('click', async event => {
    if (event.target.closest('[data-reports-open]')) { open(); return; }
    const tab = event.target.closest('[data-report-filter]');
    if (tab) { setFilter(tab.dataset.reportFilter); return; }
    const button = event.target.closest('[data-report-action]');
    if (!button || busy) return;
    const cardNode = button.closest('[data-report]'), reportId = cardNode?.dataset.report, action = button.dataset.reportAction;
    if (action === 'takedown' || action === 'cancel') {
      const panel = cardNode.querySelector('.report-takedown');
      panel.hidden = action === 'cancel';
      cardNode.querySelector('.report-actions-row').hidden = action === 'takedown';
      (action === 'takedown' ? panel.querySelector('input, [data-report-action=disable]') : cardNode.querySelector('[data-report-action=takedown]'))?.focus();
      return;
    }
    if (action === 'delete' && !await window.appConfirm('Delete this report?\n\nThis cannot be undone.', {ok: 'Delete', danger: true})) return;
    busy = true; button.disabled = true;
    try {
      const data = action === 'disable' ? await call(`/${reportId}/disable-link`, 'POST', {violation: !!cardNode.querySelector('[data-report-strike]')?.checked})
        : action === 'delete' ? await call(`/${reportId}`, 'DELETE')
        : await call(`/${reportId}`, 'PATCH', {status: action === 'resolve' ? 'resolved' : 'open'});
      showCount(data.open);
      await load();
    } catch (error) {
      $('reports-status').textContent = error.message; $('reports-status').classList.add('error');
      button.disabled = false;
    } finally { busy = false; }
  });
  document.addEventListener('visibilitychange', refreshCount);

  window.fretlarkReports = {
    setOwner(value) {
      owner = value === true;
      for (const id of ['sidebar-admin', 'manage-reports']) if ($(id)) $(id).hidden = !owner;
      clearInterval(timer);
      if (owner) { refreshCount(); timer = setInterval(refreshCount, 5 * 60 * 1000); } else showCount(0);
    }
  };
})();
