# SpessaSynth (vendored)

Browser build of [SpessaSynth](https://github.com/spessasus/spessasynth_lib) used by
Fretlark's hi-fi playback engine. No runtime npm dependency is required.

- `spessasynth_lib.js` — esbuild browser ESM bundle exporting `WorkletSynthesizer` and
  `Sequencer` (plus the `spessasynth_core` API), from `spessasynth_lib@4.4.5` and
  `spessasynth_core@4.4.7`.
- `spessasynth_processor.min.js` — the prebuilt AudioWorklet processor shipped in
  `spessasynth_lib@4.4.5/dist/`.
- `LICENSE` — Apache-2.0, copied from `spessasynth_lib@4.4.5`.

Built with:

```sh
npm i spessasynth_lib@4.4.5 spessasynth_core@4.4.7
npx esbuild@0.25.0 entry.js --bundle --format=esm --minify --target=es2022 \
  --outfile=spessasynth_lib.js
```

where `entry.js` is:

```js
export { WorkletSynthesizer, Sequencer } from "spessasynth_lib";
export * from "spessasynth_core";
```
