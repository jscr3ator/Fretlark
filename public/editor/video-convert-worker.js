// MP4 helper for the video export, using ffmpeg compiled to WebAssembly (H.264 via x264, AAC audio).
// Used by browsers without WebCodecs (frames arrive as JPEGs in small batches, so memory stays low on phones)
// and by browsers whose WebCodecs can't make AAC (the finished video is copied and the audio encoded to AAC).
// The ~32 MB core is downloaded once from jsDelivr when first needed and then cached by the browser.
// When the page is cross-origin isolated we use the multi-threaded core, so x264 can use every CPU core.
const SINGLE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/';
const MULTI = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/umd/';
const FPS = 30;
let core = null, onProgress = null, threads = 1;

async function load() {
  if (core) return core;
  const multi = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated;
  const base = multi ? MULTI : SINGLE;
  self.postMessage({type: 'stage', stage: 'loading'});
  importScripts(base + 'ffmpeg-core.js');
  let workerURL = '';
  if (multi) {
    // A worker script must be same-origin: fetch the pthread bootstrap and hand emscripten a blob URL.
    const blob = await (await fetch(base + 'ffmpeg-core.worker.js')).blob();
    workerURL = URL.createObjectURL(blob);
    threads = Math.max(1, Math.min(8, (self.navigator?.hardwareConcurrency || 4) - 1));
  }
  // The core finds its .wasm through this '#'+base64(JSON) suffix; otherwise it looks next to this worker.
  const urls = btoa(JSON.stringify({wasmURL: base + 'ffmpeg-core.wasm', workerURL}));
  core = await self.createFFmpegCore({mainScriptUrlOrBlob: `${base}ffmpeg-core.js#${urls}`});
  core.setLogger(() => {});
  core.setProgress(value => {
    const progress = typeof value === 'object' && value ? value.progress : value;
    if (Number.isFinite(progress)) onProgress?.(Math.max(0, Math.min(1, progress)));
  });
  return core;
}

function run(ff, args) {
  let ret;
  try { ret = ff.exec(...args); } finally { try { ff.reset?.(); } catch {} }
  if (ret !== 0) throw Error(`the converter stopped with code ${ret}`);
}
const remove = (ff, names) => { for (const name of names) { try { ff.FS.unlink(name); } catch {} } };
// Drop leftovers from an interrupted export too, even when its segment count was larger than this one.
const removeStale = ff => {
  try {
    for (const name of ff.FS.readdir('.')) {
      if (/^(seg\d+\.mp4|f\d{5}\.jpg)$/.test(name)) remove(ff, [name]);
    }
  } catch {}
  remove(ff, ['pre.m4a']);
};

const jobs = {
  async load() { await load(); return {}; },
  // A batch of JPEG frames -> one H.264 segment (seg<index>.mp4).
  async segment({index, frames}) {
    const ff = await load(), names = frames.map((_, i) => `f${String(i).padStart(5, '0')}.jpg`), out = `seg${index}.mp4`;
    let ok = false;
    try {
      remove(ff, [out]);
      frames.forEach((frame, i) => ff.FS.writeFile(names[i], new Uint8Array(frame)));
      run(ff, ['-y', '-framerate', String(FPS), '-i', 'f%05d.jpg', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20',
        ...(threads > 1 ? ['-threads', String(threads)] : []), '-pix_fmt', 'yuv420p', '-g', String(FPS * 2), '-r', String(FPS), out]);
      ok = true;
    } finally {
      remove(ff, names);
      if (!ok) remove(ff, [out]);
    }
    return {};
  },
  // Join every segment with the full-length audio.
  async finish({segments, audio}) {
    const ff = await load();
    const files = ['list.txt', 'audio.wav', 'out.mp4', ...Array.from({length: segments}, (_, i) => `seg${i}.mp4`)];
    try {
      remove(ff, ['list.txt', 'audio.wav', 'out.mp4']);
      const list = Array.from({length: segments}, (_, i) => `file 'seg${i}.mp4'`).join('\n');
      ff.FS.writeFile('list.txt', new TextEncoder().encode(list));
      ff.FS.writeFile('audio.wav', new Uint8Array(audio));
      run(ff, ['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-i', 'audio.wav', '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', 'out.mp4']);
      const out = ff.FS.readFile('out.mp4');
      return {mp4: out.buffer, transfer: [out.buffer]};
    } finally {
      remove(ff, files);
      removeStale(ff);
    }
  },
  // PCM WAV -> AAC, done while the video frames are encoded; pre.m4a is kept for the final mux.
  async audio({audio}) {
    const ff = await load();
    try {
      remove(ff, ['a.wav', 'pre.m4a']);
      ff.FS.writeFile('a.wav', new Uint8Array(audio));
      run(ff, ['-y', '-i', 'a.wav', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'pre.m4a']);
    } catch (error) {
      // A partial pre.m4a would make the next export pick up stale audio.
      remove(ff, ['pre.m4a']);
      throw error;
    } finally {
      remove(ff, ['a.wav']);
    }
    return {};
  },
  // Copy the finished H.264 .mov and the already-encoded AAC track into the final MP4.
  async muxPre({video}) {
    const ff = await load();
    try {
      remove(ff, ['in.mov', 'out.mp4']);
      ff.FS.writeFile('in.mov', new Uint8Array(video));
      run(ff, ['-y', '-i', 'in.mov', '-i', 'pre.m4a', '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', 'out.mp4']);
      const out = ff.FS.readFile('out.mp4');
      return {mp4: out.buffer, transfer: [out.buffer]};
    } finally {
      // pre.m4a is single-use; dropping it here also frees the wasm heap after a failed mux.
      remove(ff, ['in.mov', 'out.mp4', 'pre.m4a']);
      removeStale(ff);
    }
  },
  // A finished H.264 video (any container) + WAV -> MP4 with AAC audio, video copied untouched.
  async remux({video, audio}) {
    const ff = await load();
    try {
      remove(ff, ['in.mov', 'audio.wav', 'out.mp4']);
      ff.FS.writeFile('in.mov', new Uint8Array(video));
      ff.FS.writeFile('audio.wav', new Uint8Array(audio));
      run(ff, ['-y', '-i', 'in.mov', '-i', 'audio.wav', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', 'out.mp4']);
      const out = ff.FS.readFile('out.mp4');
      return {mp4: out.buffer, transfer: [out.buffer]};
    } finally {
      remove(ff, ['in.mov', 'audio.wav', 'out.mp4']);
      removeStale(ff);
    }
  }
};

self.onmessage = async ({data}) => {
  const {id, job} = data;
  onProgress = progress => self.postMessage({id, type: 'progress', progress});
  try {
    const {transfer = [], ...result} = await jobs[job](data);
    self.postMessage({id, type: 'done', ...result}, transfer);
  } catch (error) {
    self.postMessage({id, type: 'error', message: String(error?.message || error)});
  }
};
