import {handleApi} from '../lib/lessons.mjs';
import {backupLibrary} from '../lib/library-backup.mjs';

const security = {'Content-Security-Policy':"frame-ancestors 'self'; object-src 'none'; base-uri 'self'",'X-Frame-Options':'SAMEORIGIN','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};

export default {
 // Backups are optional: they only run when a BACKUP_BUCKET is bound.
 async scheduled(_event,env) { if (env.BACKUP_BUCKET) await backupLibrary(env); },
 async fetch(request, env) {
  const url = new URL(request.url), headers = new Headers(request.headers);
  // These identity headers are trusted only inside the retired Sites gateway.
  headers.delete('oai-authenticated-user-id');
  headers.delete('oai-authenticated-user-email');
  const cleanRequest = new Request(request, {headers});
  let response;
  if(url.pathname.startsWith('/api/')) response = await handleApi(cleanRequest, env);
  else if(url.pathname === '/editor/player.html' && (url.searchParams.has('lesson') || url.searchParams.has('preview'))) {
   // The preview page and its score both require the owner's session.
   const lesson = url.searchParams.get('lesson');
   const access = lesson ? await handleApi(new Request(new URL('/api/admin/lessons/' + encodeURIComponent(lesson), url), {headers}), env) : null;
   if (!access?.ok) response = new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private preview</title><body style="font:15px system-ui;margin:40px;line-height:1.6"><h1>Private preview</h1><p>Sign in to the account that owns this song.</p><a href="/admin" target="_top">Sign in</a></body></html>', {status:access?.status || 403,headers:{'Content-Type':'text/html; charset=utf-8'}});
   else response = await env.ASSETS.fetch(cleanRequest);
   response = new Response(response.body, response);
   response.headers.set('Cache-Control','private, no-store');
   response.headers.set('Content-Security-Policy',"frame-ancestors 'self'");
   response.headers.set('X-Frame-Options','SAMEORIGIN');
  }
  else if(/^\/view\/[a-f0-9]{64}\/?$/.test(url.pathname)) {
   const token = url.pathname.split('/')[2];
   response = new Response(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fretlark</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}iframe{position:fixed;inset:0}</style></head><body><iframe title="Lesson practice player" src="/editor/player.html?share=${token}" allow="fullscreen"></iframe></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  } else if(url.pathname === '/') {
   response = await env.ASSETS.fetch(new Request(new URL('/admin.html',url),cleanRequest));
  } else if(['/admin', '/admin/'].includes(url.pathname)) {
   response = await env.ASSETS.fetch(new Request(new URL('/admin.html',url),cleanRequest));
  } else response = await env.ASSETS.fetch(cleanRequest);
  const result = new Response(response.body,response);
  for(const [key,value] of Object.entries(security)) result.headers.set(key,value);
  return result;
 }
};
