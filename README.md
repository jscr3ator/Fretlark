<div align="center">

# Fretlark

Write, play and share guitar tabs in your browser.

[Features](#features) · [Run it your way](#run-it-your-way) · [Self-hosting guide](SELF-HOSTING.md) · [Contributing](CONTRIBUTING.md)

[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 22+](https://img.shields.io/badge/Node-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)

</div>

<img src="docs/screenshots/editor.webp" alt="The Fretlark editor: notation and tab side by side" width="100%">

## Why Fretlark

- Free and open source under the MIT license.
- Opens Guitar Pro files, and exports them too.
- Runs on your own machine, any Docker host, or Cloudflare.
- Songs can stay only on your device, never uploaded.

## Features

<table>
<tr>
<td width="50%" valign="top">
<strong>Practice and player</strong><br>
Slow down a song, loop any bar, mix tracks, and use the metronome and fretboard guide.<br>
<img src="docs/screenshots/player.webp" alt="Fretlark player with practice controls" width="100%">
</td>
<td width="50%" valign="top">
<strong>Library and sharing</strong><br>
A cloud library with album art and search. Share links let you choose the tracks, notation, printing and downloads.<br>
<img src="docs/screenshots/library.webp" alt="Fretlark library with album art" width="100%">
</td>
</tr>
<tr>
<td width="50%" valign="top">
<strong>Editor</strong><br>
Write notation and tab side by side, with a practice loop, track mixer, lyrics and chord diagrams.<br>
<img src="docs/screenshots/editor-tab.webp" alt="Close-up of notation and tab in the Fretlark editor" width="100%"><br>
Best on a laptop or tablet screen.
</td>
<td width="50%" valign="top">
<strong>Also included</strong>
<ul>
<li>Techniques: bends, slides, palm mute, harmonics, tuplets, repeats and navigation signs.</li>
<li>Tunings, capo and scales on a fretboard.</li>
<li>Chords and chord diagrams, lyrics and a drum pad.</li>
<li>ASCII tab export and a command palette (Ctrl/⌘+E) with keyboard shortcuts.</li>
<li>Guitar Pro, MusicXML and alphaTex in; Guitar Pro, MIDI, WAV and ASCII tab out.</li>
<li>Accounts with a recovery key, optional two-factor login and owner tools.</li>
<li>Optional daily backups to R2 on Cloudflare.</li>
</ul>
</td>
</tr>
</table>

## Run it your way

### Try it locally

You need Node.js 22.13 or newer.

```bash
git clone https://github.com/jscr3ator/Fretlark.git
cd Fretlark
npm install
npm run dev
```

Open http://127.0.0.1:8787. No account is needed. Data stays in `.wrangler/state` on your computer.

### Your own server with Docker

Run it on a VPS, home server or NAS. Docker and Compose are the only requirements.

```bash
git clone https://github.com/jscr3ator/Fretlark.git
cd Fretlark
docker compose up -d --build
```

Open `http://<your-server>:8787`. The database and song files live in the `fretlark-data` volume. To change settings, copy `.env.example` to `.env` and restart with `docker compose up -d`.

Create your account in the browser, then make it the owner:

```bash
docker compose exec fretlark node scripts/make-owner.mjs <username> --local
docker compose restart fretlark
```

For HTTPS, put it behind a reverse proxy such as Caddy; the [self-hosting guide](SELF-HOSTING.md#option-2-docker-on-your-own-server) has the details.

### Cloudflare free plan

Global and serverless, with a free `workers.dev` address. A free Cloudflare account is required.

```bash
git clone https://github.com/jscr3ator/Fretlark.git
cd Fretlark
npm install
npx wrangler login
npm run setup
```

Create your account on the printed address, then run:

```bash
npm run make-owner -- <username>
```

## Settings

| Name | Kind | Applies to | Purpose |
| --- | --- | --- | --- |
| `REGISTRATION_OPEN` | setting | All options | `"true"` opens sign-ups, `"false"` closes them |
| `OWNER_ACCOUNT_ID` | setting | All options | Account that manages users (set by `make-owner`) |
| `MFA_ENCRYPTION_KEY` | secret | All options | Encrypts two-factor secrets (created once for you) |
| `STORAGE_LIMIT_MB` | setting, optional | All options | Cloud storage per account in MB (default 500) |
| `BACKUP_BUCKET` | R2 binding, optional | Cloudflare only | Turns on the daily backup |

Details for each are in [SELF-HOSTING.md](SELF-HOSTING.md).

## Let an AI agent set it up

<details>
<summary>Show the prompt</summary>

```text
I want to self-host Fretlark, an open-source Guitar Pro style tab editor and player.

Repo: https://github.com/jscr3ator/Fretlark

First ask me which option I want:
A. Run it locally on this machine (npm install && npm run dev).
B. Run it on my own server with Docker (docker compose up -d --build).
C. Deploy it to a Cloudflare account (npm run setup).

Then read AGENTS.md and SELF-HOSTING.md fully and follow the section for my choice.
Ask me before logging in to Cloudflare, choosing a domain, exposing a port to the internet, closing public sign-ups, or deleting anything. Never print or commit secrets.
When it is running, open /api/session to confirm it responds, create the first account, make it the owner the way the guide describes, and tell me the final URL and anything I still need to do.

If anything fails, read the Troubleshooting section of SELF-HOSTING.md, fix it, and continue.
```

</details>

## Project layout

<details>
<summary>Show the layout</summary>

```text
cloudflare/worker.mjs   entry point: routing, security headers, scheduled backup
lib/                    API, accounts, storage limits, artwork lookup (plain ES modules)
public/                 the whole front end (no build step)
  admin.html / admin.js   library (sign-in, songs, sharing, account settings)
  editor/                 editor, player, score model, bundled alphaTab
drizzle/                SQL migrations
scripts/                setup, make-owner, asset versioning, Docker start
Dockerfile              self-hosted image (Wrangler's local runtime)
docker-compose.yml      one-command Docker setup with a data volume
verify-*.{cjs,mjs}      tests (npm test)
```

</details>

## Contributing, security and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, report vulnerabilities through [SECURITY.md](SECURITY.md), and check [THIRD-PARTY.md](THIRD-PARTY.md) for bundled components. Fretlark is released under the [MIT license](LICENSE).
