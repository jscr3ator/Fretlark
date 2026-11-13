// Preview the app's web layer in a desktop browser, without a phone or emulator.
//
//   npm run dev                      (in the repository root: the site on http://127.0.0.1:8787)
//   node android/tools/preview.mjs   (this: the same site as the app shows it, on http://127.0.0.1:8790)
//
// Open http://127.0.0.1:8790/admin with the browser's phone emulation on. Pages get the same
// script and stylesheet the Android app injects (see AppAssets.kt). The native bridge is absent,
// so native-only actions (saving files, share sheet, opening a second screen) fall back to the web.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const upstream = process.env.FRETLARK_UPSTREAM || 'http://127.0.0.1:8787';
const port = Number(process.env.PORT || 8790);
const shell = join(dirname(fileURLToPath(import.meta.url)), '../app/src/main/assets/app-shell');
const script = origin => `<script>window.FRETLARK_ORIGIN=${JSON.stringify(origin)};window.FRETLARK_APP="android";window.FRETLARK_APP_VERSION="preview";</script><script src="/app-shell/app.js"></script>`;
const style = '<link rel="stylesheet" href="/app-shell/app.css">';

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const asset = url.pathname.match(/^\/app-shell\/([a-z-]+\.(js|css))$/);
    if (asset) {
      res.writeHead(200, {'content-type': asset[2] === 'js' ? 'text/javascript' : 'text/css', 'cache-control': 'no-store'});
      res.end(await readFile(join(shell, asset[1])));
      return;
    }
    const token = url.pathname.match(/^\/(view|embed)\/([a-f0-9]{64})\/?$/);
    if (url.pathname === '/' || token) {
      res.writeHead(302, {location: token ? `/editor/player.html?share=${token[2]}${token[1] === 'embed' ? '&embed=1' : ''}` : '/admin'});
      res.end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = {...req.headers, host: new URL(upstream).host};
    delete headers['accept-encoding'];
    if (headers.origin) headers.origin = upstream;
    const up = await fetch(upstream + url.pathname + url.search, {method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: 'manual'});
    const out = {};
    up.headers.forEach((value, key) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'content-security-policy', 'set-cookie'].includes(key)) out[key] = value; });
    const cookies = up.headers.getSetCookie();
    if (cookies.length) out['set-cookie'] = cookies;
    let body = Buffer.from(await up.arrayBuffer());
    if ((up.headers.get('content-type') || '').startsWith('text/html')) {
      let doc = body.toString('utf8');
      const head = doc.indexOf('<head>');
      if (head >= 0) {
        doc = doc.slice(0, head + 6) + script(`http://${req.headers.host}`) + doc.slice(head + 6);
        const end = doc.indexOf('</head>');
        if (end >= 0) doc = doc.slice(0, end) + style + doc.slice(end);
      }
      body = Buffer.from(doc);
    }
    res.writeHead(up.status, out);
    res.end(body);
  } catch (error) {
    res.writeHead(502, {'content-type': 'text/plain'});
    res.end(`Preview could not reach ${upstream}: ${error.message}`);
  }
}).listen(port, '127.0.0.1', () => console.log(`Fretlark app preview: http://127.0.0.1:${port}/admin (site: ${upstream})`));
