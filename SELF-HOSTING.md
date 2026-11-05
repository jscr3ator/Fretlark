# Self-hosting Fretlark

This guide covers everything: setup, every setting, optional features, updating, and fixes. If you only want the short version, run the four commands in the [README](README.md#quick-start).

## What it runs on

| Piece | Cloudflare product | Free plan enough? |
| --- | --- | --- |
| App and API | Workers | Yes for personal or small-group use |
| Accounts, song list | D1 (SQLite) | Yes |
| Song files | R2 | Yes (needs R2 enabled on the account; a payment method may be requested, the free allowance still applies) |

No email service is required, there is no third-party database and there is no build step for the front end. Email is optional; without it, accounts use a recovery key instead.

## Requirements

- Node.js 22.13 or newer
- A Cloudflare account ([sign up](https://dash.cloudflare.com/sign-up))
- R2 enabled: Cloudflare dashboard → **R2 Object Storage** → enable it once

## 1. Install

```bash
git clone https://github.com/jscr3ator/Fretlark.git
cd Fretlark
npm install
```

## 2. Try it locally (optional)

```bash
npm run dev
```

Open http://127.0.0.1:8787. Data is stored in `.wrangler/state` and stays on your computer. To set up two-factor locally, copy `.dev.vars.example` to `.dev.vars` and fill in `MFA_ENCRYPTION_KEY`. `npm run dev` uses a local mail debug mode and prints confirmation and reset links to the terminal instead of sending email.

## 3. Deploy

```bash
npx wrangler login
npm run setup
```

Setup asks a few questions (all optional, press Enter for defaults):

| Question | Flag | Meaning |
| --- | --- | --- |
| Deployment name | `--name` | Names the worker, database (`<name>`) and bucket (`<name>-files`) |
| Custom domain | `--domain tabs.example.com` | Serves the site on your own domain (the domain must already be on Cloudflare) |
| Close sign-ups | `--closed` | Only existing accounts can sign in |
| | `--yes` | Accept all defaults without asking |
| | `--dry-run` | Print what would happen and change nothing |

Setup is safe to run again. It reuses the database and bucket, and never regenerates an existing secret.

What it does, in order: checks your login, creates the D1 database, creates the R2 bucket, writes `wrangler.jsonc`, applies the migrations in `drizzle/`, deploys, and creates the `MFA_ENCRYPTION_KEY` secret.

## 4. Create the owner account

1. Open the address setup printed and choose **Create an account**. You get a **recovery key**: save it.
2. Run `npm run make-owner -- your-username`.

The owner sees a **Users** panel in account settings (create users, suspend or delete them, sign them out everywhere). Everyone else only sees their own library.

## Settings reference

Plain settings live in the `vars` block of `wrangler.jsonc`. Secrets are set with `npx wrangler secret put NAME`.

| Name | Kind | Default | What it does |
| --- | --- | --- | --- |
| `REGISTRATION_OPEN` | var | `"true"` | `"false"` hides sign-up and rejects new accounts |
| `OWNER_ACCOUNT_ID` | var | none | Account id of the owner |
| `MFA_ENCRYPTION_KEY` | secret | created by setup | Base64 of 32 random bytes. **Never change it** or two-factor logins stop working |
| `MAIL_FROM` | var | none | From address for account email, for example `"Fretlark <noreply@example.com>"`. Required when email is enabled |
| `RESEND_API_KEY` | secret | none | API key from [Resend](https://resend.com) (free plan: 3,000 emails a month, 100 a day). Optional way to send account email |
| `EMAIL` | send_email binding | none | Cloudflare Email Service binding used to send account email instead of Resend. Optional |
| `STORAGE_LIMIT_MB` | var | `"500"` | Cloud storage per account in MB |
| `BACKUP_BUCKET` | R2 binding | none | Turns on the daily backup |

After editing `wrangler.jsonc`, run `npm run deploy`.

## Optional features

### Close sign-ups

Set `"REGISTRATION_OPEN": "false"` and deploy once your people have accounts. As owner you can still add users from the Users panel.

### Custom domain

1. Add the domain to Cloudflare (DNS must be on Cloudflare).
2. `npm run setup -- --domain tabs.example.com` (reuses everything, adds the route, redeploys).

### Email password reset (optional)

Email is optional. Without it, everything works as before: people sign up with a username and password and save a one-time **recovery key** to reset a forgotten password. Sign-up and Settings hide every email control.

To let people confirm an address and reset their password by email, pick one sender. Both need `MAIL_FROM` set to an address on a domain you own.

**Option A: Resend (free plan available)**

1. Create a [Resend](https://resend.com) account, add your domain and add the DNS records it shows (SPF and DKIM). Wait until the domain shows as verified.
2. Create an API key in Resend with permission to send email.
3. Set the sender address in `wrangler.jsonc`:
   ```jsonc
   "vars": {
     "MAIL_FROM": "Fretlark <noreply@example.com>"
   }
   ```
4. Store the key as a secret, then deploy: `npx wrangler secret put RESEND_API_KEY` and `npm run deploy`.

**Option B: Cloudflare Email Service (Workers Paid plan)**

1. Cloudflare Email Service needs the Workers Paid plan and a domain on Cloudflare DNS. In the dashboard, open **Compute → Email Service → Email Sending** and onboard the domain you will send from.
2. Add the binding and sender address to `wrangler.jsonc`:
   ```jsonc
   "vars": {
     "MAIL_FROM": "Fretlark <noreply@example.com>"
   },
   "send_email": [{ "name": "EMAIL" }]
   ```
3. Run `npm run deploy`.

If both are set, Resend is used.

Confirmation links expire after 24 hours; password reset links expire after 30 minutes. Recovery keys still work, and people can add or remove an email later in **Settings → Security**.

### Storage limits

Each account gets one cloud storage limit, 500 MB by default. Change `STORAGE_LIMIT_MB` in `wrangler.jsonc` to set a different limit. Songs saved only on the device use browser storage and never count toward it.

### Daily backup

1. `npx wrangler r2 bucket create fretlark-backups`
2. Add to `wrangler.jsonc`:
   ```jsonc
   "r2_buckets": [
     { "binding": "BUCKET", "bucket_name": "fretlark-files" },
     { "binding": "BACKUP_BUCKET", "bucket_name": "fretlark-backups" }
   ],
   "triggers": { "crons": ["0 11 * * *"] }
   ```
3. `npm run deploy`.

A snapshot (database rows plus song files) is written to the backup bucket each day. This is a simple backup for small libraries (up to 400 songs).

To pull an encrypted copy onto your own computer, set `CLOUDFLARE_API_TOKEN` (an R2 read token) and run `npm run backup`. Read `scripts/backup.mjs` for the options and restore command.

### Album art

Cover images are looked up server-side from public Apple Music and Deezer catalog search using the song title and artist. No keys are needed and nothing is stored except the lookup cache. Remove `lib/artwork.mjs` calls if you don't want any outside requests.

## Updating

```bash
git pull
npm install
npm run deploy:update
```

`deploy:update` applies new migrations, then deploys. Your data is kept. Read release notes before updating if you have changed core files.

## How accounts work

- Username + password (12+ characters). Passwords are salted and hashed; sessions are cookie-based.
- A one-time **recovery key** resets a forgotten password. Email reset is optional; when it is off, the recovery key is the only way back in.
- Optional two-factor (authenticator app) with recovery codes.
- Rate limiting on sign-in and recovery.

## Troubleshooting

**`You are not logged in`** → `npx wrangler login`, then run setup again.

**`R2 ... not enabled`** → Cloudflare dashboard → R2 Object Storage → enable, then run setup again.

**`database already exists`** → fine, it is reused. Use `--name` for a different one.

**Blank page or 404 on the new site** → wait a minute for first deploy to propagate, then hard refresh.

**Can't enable two-factor (503)** → `MFA_ENCRYPTION_KEY` isn't set. Run `npm run setup` again (it only creates what is missing) or `npx wrangler secret put MFA_ENCRYPTION_KEY` with a base64 32-byte value.

**Email setup returns 503** → email is optional. Set `MAIL_FROM` and either the `RESEND_API_KEY` secret (with your domain verified in Resend) or the `EMAIL` send_email binding (with the sending domain onboarded under **Compute → Email Service → Email Sending**).

**Two-factor stopped working after redeploying** → the key changed. Restore the original value from your backup.

**No sound** → click or tap the page first (browsers block audio until then) and use HTTPS. `workers.dev` addresses are HTTPS.

**Local dev: `no such table`** → run `npm run dev` (it migrates first), not `wrangler dev` directly.

**Tests fail on a fresh clone** → use Node 22.13+ and run `npm install` first.

## Deploy by hand (without `npm run setup`)

```bash
npx wrangler d1 create fretlark                 # copy database_id into wrangler.jsonc
npx wrangler r2 bucket create fretlark-files
npm run deploy:update
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put MFA_ENCRYPTION_KEY
```
