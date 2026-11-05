# Contributing

Thanks for helping make Fretlark better. 

## Before you start

1. Fork the repo and clone your fork.
2. Run `npm install`.
3. Run `npm run dev`. This serves the whole app locally at http://127.0.0.1:8787 and needs no Cloudflare account.
4. Run `npm test`. It runs every check, and it must pass before you open a pull request.

Where things live: see the project map in [AGENTS.md](AGENTS.md).

## Reporting bugs

Open an issue and include what you did, what you expected, and what happened. Add your browser, your Node version, and any console errors. Do not paste secrets or private song files. For security problems, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Pull requests

Keep changes focused and match the surrounding code style: plain JavaScript, no build step for the front end. Explain what changed and why, then run `npm test` again before you push.
