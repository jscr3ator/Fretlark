# Local alphaTab patches

Pinned build: alphaTab 1.8.4. Existing license remains in `LICENSE`.

- `alphaTab.js`, `AlphaSynthWebWorkerApi.loadedMidiInfo`: return `_loadedMidiInfo` instead of recursively reading `loadedMidiInfo`. The public `midiLoaded.on()` event reads this getter on registration; the recursive getter overflows the stack and prevents editor startup. `verify-editor-refresh.cjs` checks the getter against its backing value. Recheck this patch when replacing the bundled build.
- `alphaTab.js`, `GpifWriter._writeSoundsAndAutomations` and `GpifParser._parseAutomation`: write and read per-bar track `Volume` and `Pan` automations (Guitar Pro stores 0..1; alphaTab uses 0..16). Stock 1.8.4 plays these automations but drops them on GP export and import. `verify-automation.cjs` round-trips them. Recheck when replacing the bundled build.
