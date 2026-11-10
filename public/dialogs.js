// In-app replacements for the browser's confirm() and prompt() popups, which look out of place
// (and show the page address) in browsers and the desktop app. Both return promises.
(() => {
  'use strict';
  const css = `
.app-ask{border:0;padding:0;border-radius:18px;width:min(420px,calc(100vw - 32px));background:var(--ask-bg);color:var(--ask-text);box-shadow:0 30px 80px -20px rgba(0,0,0,.55),0 0 0 1px var(--ask-line);font:14px/1.45 Inter,-apple-system,BlinkMacSystemFont,system-ui,sans-serif}
.app-ask::backdrop{background:rgba(0,0,0,.45)}
.app-ask form{margin:0;padding:22px 22px 18px}
.app-ask p{margin:0;white-space:pre-line}
.app-ask p:first-child{font-size:15.5px;font-weight:650;letter-spacing:-.01em}
.app-ask p+p{margin-top:8px;color:var(--ask-muted)}
.app-ask input{display:block;width:100%;box-sizing:border-box;margin-top:14px;padding:10px 12px;border:1px solid var(--ask-line);border-radius:10px;background:var(--ask-field);color:inherit;font:inherit}
.app-ask .app-ask-row{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.app-ask button{min-width:84px;height:36px;padding:0 16px;border:0;border-radius:999px;font:600 13.5px Inter,-apple-system,system-ui,sans-serif;cursor:pointer;background:var(--ask-field);color:inherit}
.app-ask button.primary{background:#0a84ff;color:#fff}
.app-ask button.danger{background:#ff3b30;color:#fff}
.app-ask button:focus-visible{outline:2px solid #0a84ff;outline-offset:2px}
:root{--ask-bg:#fff;--ask-text:#1d1d1f;--ask-muted:#6e6e73;--ask-line:rgba(0,0,0,.1);--ask-field:#f2f2f5}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .app-ask.follows-theme{--ask-bg:#1f1f22;--ask-text:#f5f5f7;--ask-muted:#a1a1a6;--ask-line:rgba(255,255,255,.12);--ask-field:rgba(118,118,128,.24)}}
:root[data-theme="dark"] .app-ask.follows-theme{--ask-bg:#1f1f22;--ask-text:#f5f5f7;--ask-muted:#a1a1a6;--ask-line:rgba(255,255,255,.12);--ask-field:rgba(118,118,128,.24)}`;
  let styled = false;
  function ask(message, {ok = 'OK', cancel = 'Cancel', danger = false, input = null} = {}) {
    if (!styled) { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); styled = true; }
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      // Pages whose own colours follow the system theme get a matching dark dialog.
      dialog.className = 'app-ask' + (document.querySelector('meta[name="color-scheme"][content="light"]') ? '' : ' follows-theme');
      const form = document.createElement('form');
      form.method = 'dialog';
      // First paragraph is the question, the rest are details.
      String(message).split(/\n\s*\n/).forEach(text => { const p = document.createElement('p'); p.textContent = text; form.appendChild(p); });
      let field = null;
      if (input !== null) { field = document.createElement('input'); field.value = input; field.setAttribute('aria-label', String(message)); form.appendChild(field); }
      const row = document.createElement('div'); row.className = 'app-ask-row';
      const no = document.createElement('button'); no.type = 'button'; no.textContent = cancel;
      const yes = document.createElement('button'); yes.type = 'submit'; yes.value = 'ok'; yes.textContent = ok; yes.className = danger ? 'danger' : 'primary';
      row.append(no, yes); form.appendChild(row); dialog.appendChild(form);
      let answer = null;
      no.addEventListener('click', () => dialog.close());
      form.addEventListener('submit', () => { answer = field ? field.value : true; });
      dialog.addEventListener('close', () => { dialog.remove(); resolve(field ? answer : answer === true); });
      document.body.appendChild(dialog);
      dialog.showModal();
      (field || (danger ? no : yes)).focus();
      if (field) field.select();
    });
  }
  /** Resolves true when confirmed. */
  window.appConfirm = (message, options) => ask(message, options);
  /** Resolves the entered text, or null when cancelled. */
  window.appPrompt = (message, value = '', options = {}) => ask(message, {...options, input: String(value)});
})();
