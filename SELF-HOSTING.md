# Self-hosting Fretlark

Fretlark is a Cloudflare Worker, but you do not need Cloudflare to run it. Wrangler's local runtime (workerd + Miniflare) runs the same app on a normal machine and stores D1 as SQLite on disk with `--persist-to`. That is what the local and Docker options use.

| Option | Best for | Account needed |
| --- | --- | --- |
| [Local](#option-1-run-it-locally) | Trying it, development | None |
| [Docker](#option-2-docker-on-your-own-server) | A VPS, home server or NAS | None |
| [Cloudflare](#option-3-cloudflare-free-plan) | A global address with no server to maintain | Free Cloudflare account |

## What runs where

| Piece | Local or Docker | Cloudflare |
| --- | --- | --- |
| App and API | Wrangler's local runtime | Workers |
| Accounts and song list | D1 emulated as SQLite in the data folder | D1 |
| Song files | R2 emulated on disk in the data folder | R2 |

Accounts use a one-time recovery key to reset a forgotten password. There is no third-party database and no build step for the front end.

## Option 1: Run it locally

Requirements: Node.js 22.13 or newer.

```bash
git clone https://github.com/jscr3ator/Fretlark.git
cd Fretlark
npm install
npm run dev
```

Open http://127.0.0.1:8787. The database and files stay in `.wrangler/state` on your computer. No Cloudflare account is involved.

For two-factor locally, copy `.dev.vars.example` to `.dev.vars` and set `MFA_ENCRYPTION_KEY`.

## Option 2: Docker on your own server

Requirements: Docker with Compose v2 — a Linux server, or Docker Desktop on macOS or Windows. The image is based on Debian `node:22-slim` because workerd needs glibc; do not switch the base image to Alpine.

### Start it

```bash
git clone https://github.com/jscr3ator/Fretlark.git
cd Fretlark
cp .env.example .env     # optional; edit it if you want to change settings
docker compose up -d --build
```

Open `http://<your-server>:8787`. The database and song files live in the named `fretlark-data` volume.

On first start the container:

1. Refreshes the front-end asset versions.
2. Applies the migrations in `drizzle/` with `wrangler d1 migrations apply DB --local --persist-to /data`.
3. Creates `MFA_ENCRYPTION_KEY` in `/data/mfa-encryption-key` if you did not provide one.
4. Starts `wrangler dev` in local mode on `0.0.0.0:8787` with `--persist-to /data`.

Restarting the container keeps all data. Rebuilding it keeps the volume too.

### Settings

Put settings in `.env` and run `docker compose up -d`. The available names are in the [settings reference](#settings-reference).

### Make the first owner

Create your account in the browser first. Then run this inside the container:

```bash
docker compose exec fretlark node scripts/make-owner.mjs <username> --local
docker compose restart fretlark
```

Local mode writes the account id to `/data/owner-account-id`. The restart makes the app read it. The owner sees a **Users** panel in account settings.

If you prefer, set `OWNER_ACCOUNT_ID` in `.env` to the same id and restart instead.

### HTTPS with your own reverse proxy

Point a DNS record at the server, open ports 80 and 443, and keep Fretlark on port 8787. With [Caddy](https://caddyserver.com) installed on the host:

```bash
caddy reverse-proxy --from tabs.example.com --to 127.0.0.1:8787
```

Caddy gets a certificate automatically. If the proxy is on the same machine, you can bind Fretlark to localhost only by changing the compose port to `"127.0.0.1:8787:8787"`.

### Backups

Everything is in the `fretlark-data` volume: the SQLite database under `/data/v3/d1` and the song files under `/data/v3/r2`. Copying the whole volume is the simplest consistent backup. Stop the container first:

```bash
docker compose stop fretlark
docker run --rm -v fretlark-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/fretlark-data-$(date +%F).tar.gz -C /data .
docker compose start fretlark
```

To restore, stop the container, empty the volume, unpack the archive, and start it again:

```bash
docker compose stop fretlark
docker run --rm -v fretlark-data:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/fretlark-data-YYYY-MM-DD.tar.gz -C /data'
docker compose start fretlark
```

Keep a copy of `/data/mfa-encryption-key` with the backup. Without it, two-factor logins stop working.

If you only need account data, the D1 database is the `*.sqlite` file in `/data/v3/d1/miniflare-D1DatabaseObject` (copy its `-wal` and `-shm` files too, with the container stopped). Song files live under `/data/v3/r2` and are copied separately. Whole-volume backups avoid missing either.

### Updating

```bash
git pull
docker compose up -d --build
```

Migrations run automatically on start and the data volume is kept.

## Option 3: Cloudflare free plan

Requirements:

- Node.js 22.13 or newer
- A Cloudflare account ([sign up](https://dash.cloudflare.com/sign-up))
- R2 enabled: Cloudflare dashboard → **R2 Object Storage** → enable it once

### Install and deploy

```bash
git clone https://github.com/jscr3ator/Fretlark.git
cd Fretlark
npm install
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

### Create the owner account

1. Open the address setup printed and choose **Create an account**. You get a **recovery key**: save it.
2. Run `npm run make-owner -- your-username`.

### Custom domain

1. Add the domain to Cloudflare (DNS must be on Cloudflare).
2. `npm run setup -- --domain tabs.example.com` (reuses everything, adds the route, redeploys).

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

### Storage limits

Each account gets one cloud storage limit, 500 MB by default. Change `STORAGE_LIMIT_MB` in `wrangler.jsonc` to set a different limit. Songs saved only on the device use browser storage and never count toward it.

### Album art

Cover images are looked up server-side from public Apple Music and Deezer catalog search using the song title and artist. No keys are needed and nothing is stored except the lookup cache. Remove `lib/artwork.mjs` calls if you don't want any outside requests.

### Updating

```bash
git pull
npm install
npm run deploy:update
```

`deploy:update` applies new migrations, then deploys. Your data is kept. Read release notes before updating if you have changed core files.

## Settings reference

On Cloudflare, plain settings live in the `vars` block of `wrangler.jsonc` and secrets are set with `npx wrangler secret put NAME`. On Docker, use `.env` or environment variables. For local development, use `.dev.vars`.

| Name | Kind | Applies to | Default | What it does |
| --- | --- | --- | --- | --- |
| `REGISTRATION_OPEN` | var | All | `"true"` | `"false"` hides sign-up and rejects new accounts |
| `OWNER_ACCOUNT_ID` | var | All | none | Account id of the owner |
| `MFA_ENCRYPTION_KEY` | secret | All | created for you | Base64 of 32 random bytes. **Never change it** or two-factor logins stop working |
| `STORAGE_LIMIT_MB` | var | All | `"500"` | Cloud storage per account in MB |
| `BACKUP_BUCKET` | R2 binding | Cloudflare only | none | Turns on the daily backup |

After editing `wrangler.jsonc`, run `npm run deploy`. After editing `.env`, run `docker compose up -d`.

### Close sign-ups

Set `REGISTRATION_OPEN` to `"false"` (in `wrangler.jsonc` or `.env`) and restart or redeploy once your people have accounts. As owner you can still add users from the Users panel.

## How accounts work

- Username + password (12+ characters). Passwords are salted and hashed; sessions are cookie-based.
- A one-time **recovery key** resets a forgotten password.
- Optional two-factor (authenticator app) with recovery codes.
- Rate limiting on sign-in and recovery.

## Troubleshooting

**Docker: the site does not load** → `docker compose logs fretlark`. Check that port 8787 is free and that the container is running with `docker compose ps`.

**Docker: `no such table`** → the migrations did not run. Restart with `docker compose restart fretlark` and check the log for the migration step. Start the container through `docker compose`, not by running `wrangler dev` by hand.

**Docker: two-factor stopped working after recreating the volume** → the MFA key was lost. Restore `/data/mfa-encryption-key` from your backup. It must never change.

**Reverse proxy gives a 502 or blank page** → make sure it points at `127.0.0.1:8787` (or the host and port you mapped) and that `curl -I http://127.0.0.1:8787` works on the server.

**No sound** → click or tap the page first (browsers block audio until then) and use HTTPS. `workers.dev` addresses and Caddy domains are HTTPS.

**`You are not logged in`** (Cloudflare) → `npx wrangler login`, then run setup again.

**`R2 ... not enabled`** (Cloudflare) → Cloudflare dashboard → R2 Object Storage → enable, then run setup again.

**`database already exists`** (Cloudflare) → fine, it is reused. Use `--name` for a different one.

**Blank page or 404 on a new Cloudflare site** → wait a minute for the first deploy to propagate, then hard refresh.

**Can't enable two-factor (503)** → `MFA_ENCRYPTION_KEY` isn't set. Run `npm run setup` again (it only creates what is missing) or `npx wrangler secret put MFA_ENCRYPTION_KEY` with a base64 32-byte value.

**Tests fail on a fresh clone** → use Node 22.13+ and run `npm install` first.

## Deploy by hand (Cloudflare, without `npm run setup`)

```bash
npx wrangler d1 create fretlark                 # copy database_id into wrangler.jsonc
npx wrangler r2 bucket create fretlark-files
npm run deploy:update
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put MFA_ENCRYPTION_KEY
```
