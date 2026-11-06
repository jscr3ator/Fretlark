// Small MP4 / QuickTime writer for the video export: one H.264 track plus one AAC or PCM audio track.
// Everything is assembled in the browser; nothing is uploaded.
(function (global) {
  const enc = new TextEncoder();
  const u8 = values => Uint8Array.from(values);
  const u16 = n => u8([n >> 8 & 255, n & 255]);
  const u32 = n => u8([n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]);
  const str = s => enc.encode(s);
  const zeros = n => new Uint8Array(n);
  function concat(parts) {
    const list = parts.flat(Infinity).filter(Boolean);
    const out = new Uint8Array(list.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of list) { out.set(part, at); at += part.length; }
    return out;
  }
  const box = (type, ...parts) => { const body = concat(parts); return concat([u32(body.length + 8), str(type), body]); };
  const full = (type, version, flags, ...parts) => box(type, u8([version, flags >> 16 & 255, flags >> 8 & 255, flags & 255]), ...parts);
  const matrix = () => concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);
  // MPEG-4 descriptors use a tag byte and a 4-byte variable length.
  const descriptor = (tag, ...parts) => { const body = concat(parts); const n = body.length; return concat([u8([tag, 0x80 | (n >> 21 & 127), 0x80 | (n >> 14 & 127), 0x80 | (n >> 7 & 127), n & 127]), body]); };

  function videoEntry(v) {
    return box('avc1', zeros(6), u16(1), zeros(16), u16(v.width), u16(v.height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), box('avcC', v.description));
  }
  function aacEntry(a) {
    const esds = full('esds', 0, 0, descriptor(3, u16(1), u8([0]),
      descriptor(4, u8([0x40, 0x15]), zeros(3), u32(a.bitrate), u32(a.bitrate), descriptor(5, a.description)),
      descriptor(6, u8([2]))));
    return box('mp4a', zeros(6), u16(1), zeros(8), u16(a.channels), u16(16), u16(0), u16(0), u32(a.sampleRate * 65536 >>> 0), esds);
  }
  // QuickTime sound description, version 0: 16-bit little-endian PCM.
  function pcmEntry(a) {
    return box('sowt', zeros(6), u16(1), u16(0), u16(0), u32(0), u16(a.channels), u16(16), u16(0), u16(0), u32(a.sampleRate * 65536 >>> 0));
  }

  function track({id, kind, timescale, duration, movieDuration, entry, stts, stss, ctts, edit, sizes, sampleSize, sampleCount, offset, width = 0, height = 0}) {
    const video = kind === 'video';
    const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(movieDuration), zeros(8), u16(0), u16(0), u16(video ? 0 : 0x0100), u16(0), matrix(), u32(width * 65536 >>> 0), u32(height * 65536 >>> 0));
    const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0));
    const hdlr = full('hdlr', 0, 0, u32(0), str(video ? 'vide' : 'soun'), zeros(12), str(video ? 'VideoHandler\0' : 'SoundHandler\0'));
    const header = video ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, u16(0), u16(0));
    const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
    const stbl = box('stbl',
      full('stsd', 0, 0, u32(1), entry),
      full('stts', 0, 0, u32(stts.length), stts.map(([count, delta]) => [u32(count), u32(delta)])),
      stss ? full('stss', 0, 0, u32(stss.length), stss.map(u32)) : null,
      ctts ? full('ctts', 0, 0, u32(ctts.length), ctts.map(([count, delta]) => [u32(count), u32(delta)])) : null,
      full('stsc', 0, 0, u32(1), u32(1), u32(sampleCount), u32(1)),
      sizes ? full('stsz', 0, 0, u32(0), u32(sizes.length), sizes.map(u32)) : full('stsz', 0, 0, u32(sampleSize), u32(sampleCount)),
      full('stco', 0, 0, u32(1), u32(offset)));
    // With reordered (B) frames the edit list skips the decoder delay so the first frame shows at 0.
    const edts = edit ? box('edts', full('elst', 0, 0, u32(1), u32(movieDuration), u32(edit), u32(0x00010000))) : null;
    return box('trak', tkhd, edts, box('mdia', mdhd, hdlr, box('minf', header, dinf, stbl)));
  }

  /**
   * video: {width, height, fps, description: avcC bytes, samples: [{data, key}]}
   * audio: {codec: 'aac'|'pcm', sampleRate, channels, bitrate?, description?, samples?: [Uint8Array] (AAC frames), pcm?: Uint8Array}
   * Returns a Blob: .mp4 for AAC, QuickTime .mov for PCM (both upload fine to Instagram and TikTok).
   */
  function mux({video, audio}) {
    const mov = audio.codec === 'pcm';
    const ftyp = mov ? box('ftyp', str('qt  '), u32(0x20050300), str('qt  ')) : box('ftyp', str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'));
    const videoBytes = video.samples.reduce((sum, s) => sum + s.data.length, 0);
    const audioBytes = mov ? audio.pcm.length : audio.samples.reduce((sum, s) => sum + s.length, 0);
    const mdatHeader = concat([u32(8 + videoBytes + audioBytes), str('mdat')]);
    const videoOffset = ftyp.length + mdatHeader.length, audioOffset = videoOffset + videoBytes;
    const vScale = video.fps * 1000, vCount = video.samples.length, vDuration = vCount * 1000;
    const aFrames = mov ? audio.pcm.length / (2 * audio.channels) : audio.samples.length * 1024;
    const movieMs = Math.round(Math.max(vCount / video.fps, aFrames / audio.sampleRate) * 1000);
    const keys = []; video.samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
    // Composition offsets for encoders that emit B-frames (decode order differs from display order).
    let ctts = null, edit = 0;
    if (video.samples.some((s, i) => Number.isFinite(s.pts) && s.pts !== i)) {
      const delay = Math.max(0, ...video.samples.map((s, i) => i - s.pts));
      const offsets = video.samples.map((s, i) => (s.pts + delay - i) * 1000);
      ctts = [];
      for (const value of offsets) { const last = ctts[ctts.length - 1]; if (last && last[1] === value) last[0]++; else ctts.push([1, value]); }
      edit = delay * 1000;
    }
    const vTrak = track({id: 1, kind: 'video', timescale: vScale, duration: vDuration, movieDuration: Math.round(vCount / video.fps * 1000),
      entry: videoEntry(video), stts: [[vCount, 1000]], stss: keys, ctts, edit, sizes: video.samples.map(s => s.data.length), sampleCount: vCount, offset: videoOffset, width: video.width, height: video.height});
    const aTrak = mov
      ? track({id: 2, kind: 'audio', timescale: audio.sampleRate, duration: aFrames, movieDuration: Math.round(aFrames / audio.sampleRate * 1000),
        entry: pcmEntry(audio), stts: [[aFrames, 1]], sampleSize: 2 * audio.channels, sampleCount: aFrames, offset: audioOffset})
      : track({id: 2, kind: 'audio', timescale: audio.sampleRate, duration: aFrames, movieDuration: Math.round(aFrames / audio.sampleRate * 1000),
        entry: aacEntry(audio), stts: [[audio.samples.length, 1024]], sizes: audio.samples.map(s => s.length), sampleCount: audio.samples.length, offset: audioOffset});
    const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieMs), u32(0x00010000), u16(0x0100), zeros(10), matrix(), zeros(24), u32(3));
    const moov = box('moov', mvhd, vTrak, aTrak);
    const parts = [ftyp, mdatHeader, ...video.samples.map(s => s.data), ...(mov ? [audio.pcm] : audio.samples), moov];
    return new Blob(parts, {type: mov ? 'video/quicktime' : 'video/mp4'});
  }

  global.FretlarkVideoMux = {mux, _box: box, _concat: concat};
  if (typeof module !== 'undefined') module.exports = global.FretlarkVideoMux;
})(typeof window !== 'undefined' ? window : globalThis);
