#!/usr/bin/env node
// Makes an existing account the owner (the account that can manage other users).
//   npm run make-owner -- your-username
//   node scripts/make-owner.mjs your-username --local --persist-to /data
//
// Remote (Cloudflare) mode updates wrangler.jsonc and redeploys.
// Local mode writes <persist-to>/owner-account-id; restart the app to apply it.
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const local = args.includes('--local');
const persistTo = option('persist-to') || process.env.PERSIST_TO || '.wrangler/state';
const username = (args.find((arg, i) => !arg.startsWith('--') && !(i > 0 && ['--persist-to'].includes(args[i - 1])) ) || '').trim().toLowerCase();

if (!/^[a-z0-9][a-z0-9._@-]{1,253}$/.test(username)) {
  console.error('Usage: npm run make-owner -- <username>\n       npm run make-owner -- <username> --local [--persist-to /data]\nCreate your account on the site first, then run this with the same username.');
  process.exit(1);
}

const run = args => execFileSync('npx', ['--no-install', 'wrangler', ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const database = config.d1_databases[0].database_name;
const query = `SELECT id FROM teachers WHERE email='${username}' LIMIT 1`;

if (local) {
  const out = run(['d1', 'execute', database, '--local', '--persist-to', persistTo, '--json', '--command', query]);
  const start = out.search(/\[\s*\{/);
  const id = start >= 0 ? JSON.parse(out.slice(start))?.[0]?.results?.[0]?.id : undefined;
  if (!id) { console.error(`No account named "${username}" was found. Create it on your site first.`); process.exit(1); }
  mkdirSync(persistTo, {recursive: true});
  writeFileSync(path.join(persistTo, 'owner-account-id'), id + '\n', {mode: 0o600});
  console.log(`"${username}" is now the owner (${id}).`);
  console.log(`Wrote ${path.join(persistTo, 'owner-account-id')}. Restart the app to apply it.`);
  if (process.env.PERSIST_TO || persistTo !== '.wrangler/state') console.log('With Docker: docker compose restart fretlark');
  process.exit(0);
}

const out = run(['d1', 'execute', database, '--remote', '--json', '--command', query]);
const id = JSON.parse(out)?.[0]?.results?.[0]?.id;
if (!id) { console.error(`No account named "${username}" was found. Create it on your site first.`); process.exit(1); }

config.vars = {...config.vars, OWNER_ACCOUNT_ID: id};
writeFileSync('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n');
console.log(`"${username}" is now the owner. Redeploying...`);
execFileSync('npx', ['--no-install', 'wrangler', 'deploy', '--config', 'wrangler.jsonc', '--keep-vars'], {stdio: 'inherit'});
console.log('Done. The Users panel now appears in your account settings.');
