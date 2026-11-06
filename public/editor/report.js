// "More" menu on shared songs: lets a visitor report the song to the instance owner.
(() => {
  const $ = id => document.getElementById(id);
  const token = new URLSearchParams(location.search).get('share');
  const more = $('btn-more'), menu = $('more-menu'), dialog = $('report-dialog');
  // Only real share links get the menu; previews of your own songs do not.
  if (!more || !menu || !dialog || !/^[a-f0-9]{64}$/.test(token || '')) return;
  more.hidden = false;
  const form = $('report-form'), status = $('report-status'), submit = $('report-submit'), done = $('report-done');

  menu.addEventListener('toggle', event => more.setAttribute('aria-expanded', String(event.newState === 'open')));
  const say = (text, error = true) => { status.textContent = text; status.classList.toggle('error', error && !!text); };

  $('open-report').addEventListener('click', () => {
    menu.hidePopover();
    form.reset(); say(''); form.hidden = false; done.hidden = true; submit.disabled = false; submit.textContent = 'Send report';
    dialog.showModal();
    form.querySelector('input[name=reason]').focus();
  });
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-close-report]') || event.target === dialog) dialog.close();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const reason = form.elements.reason.value, details = $('report-details').value.trim(), contact = $('report-contact').value.trim();
    if (!reason) return say('Choose a reason.');
    if ((reason === 'copyright' || reason === 'other') && details.length < 10) { $('report-details').focus(); return say('Add a few words so we can review it.'); }
    if (contact && !$('report-contact').checkValidity()) { $('report-contact').focus(); return say('Enter a valid email, or leave it empty.'); }
    submit.disabled = true; submit.textContent = 'Sending…'; say('');
    try {
      const response = await fetch(`/api/shared/${token}/report`, {method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify({reason, details, contact})});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || 'The report could not be sent. Try again.');
      form.hidden = true; done.hidden = false; done.querySelector('button').focus();
    } catch (error) {
      say(error.message || 'The report could not be sent. Try again.');
      submit.disabled = false; submit.textContent = 'Send report';
    }
  });
})();
