#!/usr/bin/env node
// Makes an existing account the owner (the account that can manage other users), then redeploys.
//   npm run make-owner -- your-username
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

const username = (process.argv[2] || '').trim().toLowerCase();
if (!/^[a-z0-9][a-z0-9._@-]{1,253}$/.test(username)) {
  console.error('Usage: npm run make-owner -- <username>\nCreate your account on the site first, then run this with the same username.');
  process.exit(1);
}
const run = args => execFileSync('npx', ['--no-install', 'wrangler', ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const database = config.d1_databases[0].database_name;

const out = run(['d1', 'execute', database, '--remote', '--json', '--command', `SELECT id FROM teachers WHERE email='${username}' LIMIT 1`]);
const id = JSON.parse(out)?.[0]?.results?.[0]?.id;
if (!id) { console.error(`No account named "${username}" was found. Create it on your site first.`); process.exit(1); }

config.vars = {...config.vars, OWNER_ACCOUNT_ID: id};
writeFileSync('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n');
console.log(`"${username}" is now the owner. Redeploying...`);
execFileSync('npx', ['--no-install', 'wrangler', 'deploy', '--config', 'wrangler.jsonc', '--keep-vars'], {stdio: 'inherit'});
console.log('Done. The Users panel now appears in your account settings.');
