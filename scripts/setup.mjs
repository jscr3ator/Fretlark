#!/usr/bin/env node
// One-command setup: creates the database and storage on your Cloudflare account, applies the schema,
// sets the secrets, and deploys. Safe to run again; it reuses what already exists.
//
//   npm run setup                                  (interactive questions)
//   npm run setup -- --yes                         (accept every default)
//   npm run setup -- --name my-tabs --domain tabs.example.com
//   npm run setup -- --dry-run                     (show what would happen, change nothing)
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import readline from 'node:readline/promises';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const dry = flag('dry-run'), assumeYes = flag('yes') || dry;
const log = message => console.log(message);
const step = message => console.log(`\n→ ${message}`);
const die = message => { console.error(`\n✗ ${message}\n`); process.exit(1); };

if (Number(process.versions.node.split('.')[0]) < 22) die(`Node.js 22 or newer is required (you have ${process.versions.node}).`);

function wrangler(wranglerArgs, {input, allowFail = false} = {}) {
  if (dry) { log(`  [dry run] wrangler ${wranglerArgs.join(' ')}`); return ''; }
  try {
    return execFileSync('npx', ['--no-install', 'wrangler', ...wranglerArgs], {encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe']});
  } catch (error) {
    if (allowFail) return `${error.stdout || ''}${error.stderr || ''}`;
    die(`wrangler ${wranglerArgs.join(' ')} failed:\n${error.stdout || ''}${error.stderr || error.message}`);
  }
}

const rl = assumeYes ? null : readline.createInterface({input: process.stdin, output: process.stdout});
const ask = async (question, fallback) => {
  if (!rl) return fallback;
  const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `)).trim();
  return answer || fallback;
};

const slug = value => /^[a-z0-9][a-z0-9-]{1,40}$/.test(value);
const name = option('name') || await ask('Name for your deployment (letters, numbers, dashes)', 'fretlark');
if (!slug(name)) die('The name must be 2 to 41 lowercase letters, numbers or dashes.');
const domain = option('domain') ?? (await ask('Custom domain, or leave empty for a free workers.dev address', '')) ;
if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) die('That does not look like a domain name.');
const registration = flag('closed') ? 'false' : 'true';
rl?.close();

step('Checking your Cloudflare login');
if (!dry) {
  const who = wrangler(['whoami'], {allowFail: true});
  if (/not authenticated|not logged in|You are not/i.test(who) || !/@|Account ID|account/i.test(who)) die('You are not logged in. Run  npx wrangler login  and then  npm run setup  again.');
}
log('  logged in');

step(`Creating the database "${name}"`);
let databaseId = '00000000-0000-0000-0000-000000000000';
const created = wrangler(['d1', 'create', name], {allowFail: true});
databaseId = created.match(/"?database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/i)?.[1] || '';
if (!databaseId && !dry) {
  const list = JSON.parse(wrangler(['d1', 'list', '--json']) || '[]');
  databaseId = (list.find(db => db.name === name) || {}).uuid || (list.find(db => db.name === name) || {}).database_id || '';
}
if (!databaseId && !dry) die(`Could not create or find a database named "${name}".\n${created}`);
log(dry ? '  (database id would be filled in here)' : `  ready (${databaseId})`);

step(`Creating the file storage "${name}-files"`);
const bucket = `${name}-files`;
const bucketResult = wrangler(['r2', 'bucket', 'create', bucket], {allowFail: true});
if (!dry && /error/i.test(bucketResult) && !/already exists/i.test(bucketResult)) die(`Could not create the storage bucket. Is R2 enabled for your account? (Cloudflare dashboard > R2)\n${bucketResult}`);
log('  ready');

step('Writing wrangler.jsonc');
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
config.name = name;
config.d1_databases[0].database_name = name;
config.d1_databases[0].database_id = dry ? config.d1_databases[0].database_id : databaseId;
config.r2_buckets[0].bucket_name = bucket;
config.vars = {...config.vars, REGISTRATION_OPEN: registration};
if (domain) config.routes = [{pattern: domain, custom_domain: true}];
if (!dry) writeFileSync('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n');
log('  saved');

step('Preparing the site files');
if (!dry) execFileSync('node', ['scripts/version-assets.mjs'], {stdio: 'inherit'});

step('Creating the database tables');
wrangler(['d1', 'migrations', 'apply', 'DB', '--remote'], {input: 'y\n'});
log('  done');

step('Deploying');
const deployed = wrangler(['deploy', '--config', 'wrangler.jsonc']);
const url = deployed.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] || (domain ? `https://${domain}` : '(see the output above)');
log(`  live at ${url}`);

step('Setting secrets');
const secrets = wrangler(['secret', 'list', '--config', 'wrangler.jsonc'], {allowFail: true});
if (!/MFA_ENCRYPTION_KEY/.test(secrets)) {
  const key = randomBytes(32).toString('base64');
  wrangler(['secret', 'put', 'MFA_ENCRYPTION_KEY', '--config', 'wrangler.jsonc'], {input: key + '\n'});
  log('  MFA_ENCRYPTION_KEY created. It encrypts two-factor secrets and must never change.');
  if (!dry) { writeFileSync('.mfa-key.backup', key + '\n', {mode: 0o600}); log('  A copy was saved to .mfa-key.backup (git-ignored). Store it somewhere safe, then delete the file.'); }
} else log('  MFA_ENCRYPTION_KEY already set');

log(`
Done. Your Fretlark is live at ${url}

Next:
  1. Open it and create your account.
  2. Make yourself the owner:   npm run make-owner -- your-username
`);
