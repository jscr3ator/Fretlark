# Agent guide

You are helping someone run, change or self-host **Fretlark**, a Guitar Pro style tab editor, player and sharing library on Cloudflare Workers. Read this file first, then [SELF-HOSTING.md](SELF-HOSTING.md) for details.

## Rules

- Never print, log or commit secrets (`MFA_ENCRYPTION_KEY`, `.dev.vars`, `.mfa-key.backup`).
- Ask the user before: `wrangler login`, choosing a domain, closing sign-ups, deleting resources, or anything that costs money.
- Don't rename database columns or API paths; "lessons" and "teachers" in code are legacy internal names for songs and accounts.
- The front end has **no build step**. Edit files in `public/` directly, then run `node scripts/version-assets.mjs` (the npm scripts do this) to refresh cache-busting hashes.

## Set up a deployment (the usual task)

1. Check prerequisites: `node -v` must be 22.13+. A Cloudflare account must exist, and R2 must be enabled in it.
2. `npm install`
3. `npm test` (should pass; takes about a minute).
4. `npx wrangler login` if `npx wrangler whoami` says you are not logged in. This opens a browser; tell the user.
5. Decide options with the user: deployment name, custom domain (optional), closed sign-ups (optional).
6. Run `npm run setup -- --yes` plus flags, for example:
   `npm run setup -- --yes --name my-tabs --domain tabs.example.com`
   Use `--dry-run` first if you want to preview.
7. Verify: `curl -s https://<site>/api/session` returns JSON containing `"registrationOpen":true`.
8. Have the user create their account in the browser (the recovery key shown once must be saved by them), then `npm run make-owner -- <username>`.
9. Report the URL, where the MFA key backup is (`.mfa-key.backup`, to be stored safely then deleted), and optional next steps (backups, custom domain).

## Run locally

`npm run dev` serves http://127.0.0.1:8787 with a local database in `.wrangler/state`. For two-factor locally, copy `.dev.vars.example` to `.dev.vars` and set `MFA_ENCRYPTION_KEY`.

## Project map

| Path | What it is |
| --- | --- |
| `cloudflare/worker.mjs` | Worker entry: routes `/`, `/admin`, `/api/*`, `/view/<token>`; security headers; optional scheduled backup |
| `lib/lessons.mjs` | API router `handleApi`: songs, sharing, storage, sessions, artwork |
| `lib/teacher-auth.mjs` | Accounts: register, login, recovery key reset, username change, password, two-factor, rate limits |
| `lib/two-factor.mjs` | TOTP and recovery codes (AES-GCM with `MFA_ENCRYPTION_KEY`) |
| `lib/plans.mjs` | Per-account cloud storage limit |
| `lib/user-management.mjs` | Owner tools (create, suspend, delete, sign out) |
| `lib/artwork.mjs` | Album art lookup |
| `lib/library-backup.mjs` | Optional daily snapshot |
| `public/admin.*` | Library UI (sign-in, songs, sharing, account settings) |
| `public/editor/` | `index.html` + `app.js` editor, `player.html` audience player, `model.js` score model, `vendor/` bundled alphaTab |
| `drizzle/*.sql` | Migrations, applied in order by `wrangler d1 migrations apply` |
| `verify-*.cjs/mjs` | Tests; `npm test` runs all |

## Changing things safely

- Database changes: add a new numbered file in `drizzle/` (never edit an applied one) and add it to the in-memory schema list in `verify-lessons.mjs`.
- Many tests run slices of `public/editor/app.js` in a Node VM; new identifiers used inside those slices must be guarded (`typeof x === 'function'`) so the slices still run.
- Run `npm test` after every change.
- Deploy with `npm run deploy` (code only) or `npm run deploy:update` (migrations + code).

## Common settings changes

- Close sign-ups: set `REGISTRATION_OPEN` to `"false"` in `wrangler.jsonc`, `npm run deploy`.
- Storage limits: set `STORAGE_LIMIT_MB` in `wrangler.jsonc`.
- Brand name and wording: `public/admin.html`, `public/editor/index.html`.
