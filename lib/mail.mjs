// Account emails are optional. They go out through Resend (RESEND_API_KEY secret) or the Cloudflare Email
// Service binding (EMAIL), and always need MAIL_FROM.
const escapeHtml = value => String(value).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const fail = (message, status = 503) => Object.assign(new Error(message), {status});
// Local development only: MAIL_DEBUG=log prints emails to the terminal instead of sending them.
const mailDebug = env => String(env?.MAIL_DEBUG ?? '') === 'log' && !env?.EMAIL;

const resendKey = env => String(env?.RESEND_API_KEY ?? '').trim();

export function mailConfigured(env) {
 const hasFrom = !!String(env?.MAIL_FROM ?? '').trim();
 if (mailDebug(env)) return hasFrom;
 return hasFrom && (!!resendKey(env) || typeof env?.EMAIL?.send === 'function');
}

function parseFrom(value) {
 const text = String(value ?? '').trim();
 const named = text.match(/^(.*?)\s*<([^<>]+)>$/);
 if (named) return {email:named[2].trim(), ...(named[1].trim() ? {name:named[1].trim().replace(/^["']|["']$/g, '')} : {})};
 return {email:text};
}

export async function sendMail(env, {to, subject, text, html}) {
 if (!mailConfigured(env)) throw fail('Email sending is not configured on this server.');
 if (mailDebug(env)) {
  console.log(JSON.stringify({event:'mail-debug', to, subject, text}));
  return {sent:true};
 }
 if (resendKey(env)) {
  const response = await fetch('https://api.resend.com/emails', {
   method: 'POST',
   headers: {Authorization: `Bearer ${resendKey(env)}`, 'Content-Type': 'application/json'},
   body: JSON.stringify({from: String(env.MAIL_FROM).trim(), to: [to], subject, text, html})
  });
  // Never include the response body or the key in the error; callers log only a generic event.
  if (!response.ok) throw fail('The email provider rejected the message.', 502);
  return {sent:true};
 }
 await env.EMAIL.send({from:parseFrom(env.MAIL_FROM), to, subject, text, html});
 return {sent:true};
}

function layout({heading, intro, button, url, note}) {
 const text = `${heading}\n\n${intro}\n\n${button}: ${url}\n\n${note}\n\nFretlark`;
 const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1d1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#fff;border-radius:16px;padding:32px">
<tr><td style="font-size:15px;font-weight:700;padding-bottom:20px">Fretlark</td></tr>
<tr><td style="font-size:22px;font-weight:700;padding-bottom:12px">${escapeHtml(heading)}</td></tr>
<tr><td style="font-size:15px;line-height:1.5;color:#424245;padding-bottom:24px">${escapeHtml(intro)}</td></tr>
<tr><td style="padding-bottom:24px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:99px">${escapeHtml(button)}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#6e6e73">${escapeHtml(note)}<br><br>Button not working? Paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(url)}</span></td></tr>
</table></td></tr></table></body></html>`;
 return {text, html};
}

export function verifyEmailMessage(origin, token) {
 const url = `${origin}/admin?verify=${encodeURIComponent(token)}`;
 return {
  subject: 'Confirm your Fretlark email',
  ...layout({
   heading: 'Confirm your email address',
   intro: 'Confirm this email address so it can be used to help you get back into your Fretlark account if you forget your password.',
   button: 'Confirm email address',
   url,
   note: 'This link expires in 24 hours and can only be used once. If you did not ask for this, ignore this email.'
  })
 };
}

export function resetPasswordMessage(origin, token) {
 const url = `${origin}/admin?reset=${encodeURIComponent(token)}`;
 return {
  subject: 'Reset your Fretlark password',
  ...layout({
   heading: 'Reset your password',
   intro: 'Choose a new password for your Fretlark account; every device will need to sign in again afterwards.',
   button: 'Choose a new password',
   url,
   note: 'This link expires in 30 minutes and can only be used once. If you did not ask for this, ignore this email.'
  })
 };
}
