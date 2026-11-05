# Third-party software

Fretlark bundles these components. Each keeps its own license, included next to the files.

| Component | Where | License |
| --- | --- | --- |
| [alphaTab](https://www.alphatab.net) 1.8.4 (patched: changes in `alphaTab-1.8.4-fretlark.patch`, see `PATCHES.md`) | `public/editor/vendor/` | MPL-2.0 |
| [fflate](https://github.com/101arrowz/fflate) | `public/editor/vendor/fflate.js` | MIT |
| [SpessaSynth](https://github.com/spessasus/spessasynth_lib) (spessasynth_lib 4.4.5, spessasynth_core 4.4.7, bundled with fflate and stb-vorbis) | `public/editor/vendor/spessasynth/` | Apache-2.0 |
| [@tonejs/midi](https://github.com/Tonejs/Midi) | `public/editor/vendor/tonejs-midi.js` | MIT (see `tonejs-midi-LICENSE.md`) |
| FluidR3 Mono GM soundfont | `public/editor/vendor/soundfont/FluidR3Mono_GM.sf3` | MIT (see `FluidR3Mono_License.md`) |
| SONiVOX EAS soundfont | `public/editor/vendor/soundfont/sonivox.*` | Apache-2.0 |
| [Inter](https://rsms.me/inter/) font | `public/admin-assets/` | SIL OFL 1.1 |

The FluidR3 Mono GM bank is distributed under the MIT license (`FluidR3Mono_License.md`), the same way MuseScore and Debian distribute it. Its embedded metadata contains an older "do not redistribute" note; the published license is the operative one, but keep that record if provenance matters for your use. The SONiVOX EAS bank (Apache-2.0) is also bundled as an alternative soundfont.
