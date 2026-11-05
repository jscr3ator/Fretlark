#!/usr/bin/env node
// Rebuilds the bundled demo score and its base64 copy from public/editor/demo.atex.
//   node scripts/build-demo.mjs
import {createRequire} from 'node:module';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const at = require(`${root}public/editor/vendor/alphaTab.js`);

const tex = readFileSync(`${root}public/editor/demo.atex`, 'utf8');
const score = at.importer.ScoreLoader.loadAlphaTex(tex, new at.Settings());
const bytes = new at.exporter.Gp7Exporter().export(score, new at.Settings());

writeFileSync(`${root}public/editor/demo.gp`, bytes);
writeFileSync(`${root}lib/reference-score.mjs`, `export const referenceScore='${Buffer.from(bytes).toString('base64')}';\n`);
console.log(`Demo: ${score.title} by ${score.artist}, ${score.masterBars.length} bars, ${score.tracks.length} tracks, ${bytes.length} bytes.`);
