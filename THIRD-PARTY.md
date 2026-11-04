# Third-party software

Fretlark bundles these components. Each keeps its own license, included next to the files.

| Component | Where | License |
| --- | --- | --- |
| [alphaTab](https://www.alphatab.net) 1.8.4 (patched, see `PATCHES.md`) | `public/editor/vendor/` | MPL-2.0 |
| [fflate](https://github.com/101arrowz/fflate) | `public/editor/vendor/fflate.js` | MIT |
| FluidR3 Mono GM soundfont | `public/editor/vendor/soundfont/FluidR3Mono_GM.sf3` | MIT (see `FluidR3Mono_License.md`) |
| SONiVOX EAS soundfont | `public/editor/vendor/soundfont/sonivox.*` | Apache-2.0 |
| [Inter](https://rsms.me/inter/) font | `public/admin-assets/` | SIL OFL 1.1 |

The FluidR3 bank's embedded metadata contains a "do not redistribute" note that conflicts with its published MIT license. If that matters for your use, delete `FluidR3Mono_GM.sf3` and set the editor to use the SONiVOX bank only.
