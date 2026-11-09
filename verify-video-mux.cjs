// The video export's MP4/QuickTime writer: box layout, sample tables, offsets and duration handling.
const assert = require('node:assert/strict');
const {mux, _u64, _mdatHeader, _chunkOffset} = require('./public/editor/video-mux.js');

async function bytes(blob) { return new Uint8Array(await blob.arrayBuffer()); }
function boxes(buf, start = 0, end = buf.length) {
  const out = [], dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let at = start; at < end;) {
    let size = dv.getUint32(at), hdr = 8;
    if (size === 1) { size = Number(dv.getBigUint64(at + 8)); hdr = 16; }
    else if (size === 0) size = end - at;
    const type = String.fromCharCode(...buf.subarray(at + 4, at + 8));
    assert.ok(size >= hdr && at + size <= end, `box ${type} fits`);
    out.push({type, at, size, hdr}); at += size;
  }
  return out;
}
const find = (buf, path) => {
  let start = 0, end = buf.length, hit = null;
  for (const [i, type] of path.entries()) {
    hit = boxes(buf, start, end).find(b => b.type === type);
    assert.ok(hit, `has ${path.slice(0, i + 1).join('/')}`);
    // stsd children start after version/flags + entry count; sample entries have fixed headers.
    start = hit.at + 8 + ({stsd: 8, avc1: 78, mp4a: 28, sowt: 28, dref: 8}[type] || 0); end = hit.at + hit.size;
  }
  return hit;
};
const u32 = (buf, at) => new DataView(buf.buffer, buf.byteOffset).getUint32(at);
const u64 = (buf, at) => new DataView(buf.buffer, buf.byteOffset).getBigUint64(at);
const fourcc = (buf, at) => String.fromCharCode(...buf.subarray(at + 4, at + 8));
const str4 = (buf, at) => String.fromCharCode(...buf.subarray(at, at + 4));
const traks = (buf, moov) => boxes(buf, moov.at + 8, moov.at + moov.size).filter(b => b.type === 'trak');

(async () => {
  const video = {width: 1080, height: 1920, fps: 30, description: Uint8Array.from([1, 100, 0, 40, 255, 225, 0, 0]),
    samples: [{data: Uint8Array.from([0, 0, 0, 2, 9, 9]), key: true}, {data: Uint8Array.from([0, 0, 0, 1, 7]), key: false}, {data: Uint8Array.from([0, 0, 0, 1, 8]), key: false}]};

  // PCM -> QuickTime .mov
  const pcm = new Uint8Array(44100 * 4 / 10); // 0.1 s of stereo 16-bit silence
  const mov = await bytes(mux({video, audio: {codec: 'pcm', sampleRate: 44100, channels: 2, pcm}}));
  const top = boxes(mov);
  assert.deepEqual(top.map(b => b.type), ['ftyp', 'moov', 'mdat'], 'moov is first so playback can start before the whole file arrives');
  assert.equal(str4(mov, 8), 'qt  ');
  const moov = top.find(b => b.type === 'moov'), mdat = top.find(b => b.type === 'mdat');
  assert.equal(mdat.size, mdat.hdr + 6 + 5 + 5 + pcm.length, 'mdat holds every sample');
  const vt = traks(mov, moov);
  assert.equal(vt.length, 2);
  const vStco = find(mov.subarray(vt[0].at, vt[0].at + vt[0].size), ['trak', 'mdia', 'minf', 'stbl', 'stco']);
  assert.equal(u32(mov, vt[0].at + vStco.at + 16), mdat.at + mdat.hdr, 'video chunk starts right after the mdat header');
  const aStco = find(mov.subarray(vt[1].at, vt[1].at + vt[1].size), ['trak', 'mdia', 'minf', 'stbl', 'stco']);
  assert.equal(u32(mov, vt[1].at + aStco.at + 16), mdat.at + mdat.hdr + 16, 'audio follows the video samples');
  const stsz = find(mov.subarray(vt[0].at, vt[0].at + vt[0].size), ['trak', 'mdia', 'minf', 'stbl', 'stsz']);
  assert.equal(u32(mov, vt[0].at + stsz.at + 16), 3, 'three video samples');
  const stss = find(mov.subarray(vt[0].at, vt[0].at + vt[0].size), ['trak', 'mdia', 'minf', 'stbl', 'stss']);
  assert.equal(u32(mov, vt[0].at + stss.at + 12), 1, 'one keyframe');
  find(mov.subarray(vt[1].at, vt[1].at + vt[1].size), ['trak', 'mdia', 'minf', 'stbl', 'stsd', 'sowt']);
  assert.equal(boxes(mov.subarray(vt[1].at, vt[1].at + vt[1].size), 8, vt[1].size).some(b => b.type === 'edts'), false, 'PCM has no priming edit');

  // AAC -> .mp4
  const aac = [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5])];
  const mp4blob = mux({video, audio: {codec: 'aac', sampleRate: 44100, channels: 2, bitrate: 192000, description: Uint8Array.from([0x12, 0x10]), samples: aac}});
  assert.equal(mp4blob.type, 'video/mp4');
  const mp4 = await bytes(mp4blob);
  assert.equal(str4(mp4, 8), 'isom');
  const at = boxes(mp4, boxes(mp4).find(b => b.type === 'moov').at + 8, mp4.length).filter(b => b.type === 'trak')[1];
  find(mp4.subarray(at.at, at.at + at.size), ['trak', 'mdia', 'minf', 'stbl', 'stsd', 'mp4a', 'esds']);
  const atrak = mp4.subarray(at.at, at.at + at.size);
  const mdhd = find(atrak, ['trak', 'mdia', 'mdhd']);
  assert.equal(u32(mp4, at.at + mdhd.at + 20), 44100, 'AAC media timescale is the sample rate');
  assert.equal(u32(mp4, at.at + mdhd.at + 24), 2048, 'media duration counts the priming frame');
  const tkhd = find(atrak, ['trak', 'tkhd']);
  assert.equal(u32(mp4, at.at + tkhd.at + 28), 23, 'track duration skips AAC priming');
  const elst = find(atrak, ['trak', 'edts', 'elst']);
  assert.equal(u32(mp4, at.at + elst.at + 20), 1024, 'AAC edit list skips one priming frame');
  assert.equal(u32(mp4, at.at + elst.at + 16), 23, 'AAC edit list covers the real audio length');
  const noPrim = await bytes(mux({video, audio: {codec: 'aac', sampleRate: 44100, channels: 2, bitrate: 192000, description: Uint8Array.from([0x12, 0x10]), samples: aac, priming: 0}}));
  const npMoov = boxes(noPrim).find(b => b.type === 'moov');
  const npAudio = boxes(noPrim, npMoov.at + 8, npMoov.at + npMoov.size).filter(b => b.type === 'trak')[1];
  assert.equal(boxes(noPrim, npAudio.at + 8, npAudio.at + npAudio.size).some(b => b.type === 'edts'), false, 'priming: 0 disables the AAC edit');
  // B-frames: decode order I0 P3 B1 B2 -> ctts offsets and an edit list for the one-frame delay.
  const bvideo = {...video, samples: [0, 3, 1, 2].map((pts, i) => ({data: Uint8Array.of(0, 0, 0, 1, i), key: i === 0, pts}))};
  const bmov = await bytes(mux({video: bvideo, audio: {codec: 'pcm', sampleRate: 44100, channels: 2, pcm}}));
  const bt = boxes(bmov, boxes(bmov).find(b => b.type === 'moov').at + 8, bmov.length).filter(b => b.type === 'trak')[0];
  const trakBytes = bmov.subarray(bt.at, bt.at + bt.size);
  const ctts = find(trakBytes, ['trak', 'mdia', 'minf', 'stbl', 'ctts']);
  const entries = u32(bmov, bt.at + ctts.at + 12), offsets = [];
  for (let i = 0; i < entries; i++) { const count = u32(bmov, bt.at + ctts.at + 16 + i * 8), delta = u32(bmov, bt.at + ctts.at + 20 + i * 8); for (let k = 0; k < count; k++) offsets.push(delta); }
  assert.deepEqual(offsets, [1000, 3000, 0, 0], 'composition offsets put frames back in display order');
  const belst = find(trakBytes, ['trak', 'edts', 'elst']);
  assert.equal(u32(bmov, bt.at + belst.at + 20), 1000, 'edit list skips the one-frame decoder delay');
  assert.equal(boxes(mov, vt[0].at + 8, vt[0].at + vt[0].size).some(b => b.type === 'edts'), false, 'no edit list without B-frames');

  // Boxes past 4 GB need the largesize form and co64 chunk offsets.
  assert.deepEqual([..._u64(0x100000000)], [0, 0, 0, 1, 0, 0, 0, 0]);
  assert.equal(_mdatHeader(0xfffffff7).length, 8, 'largest 32-bit mdat still fits');
  const large = _mdatHeader(0xfffffff8);
  assert.equal(large.length, 16, 'mdat over 4 GB uses a 64-bit size');
  assert.equal(u32(large, 0), 1, '64-bit mdat starts with size=1');
  assert.equal(fourcc(large, 0), 'mdat');
  assert.equal(u64(large, 8), 0x100000008n, 'largesize includes its own 16-byte header');
  assert.equal(fourcc(_chunkOffset(1234, false), 0), 'stco');
  const co = _chunkOffset(0x100000000, true);
  assert.equal(fourcc(co, 0), 'co64', 'offsets past 4 GB use co64');
  assert.equal(u64(co, 16), 0x100000000n);
  console.log('PASS: video export MP4/QuickTime writer (fast start, box layout, offsets/co64, keyframes, B-frames, AAC priming and PCM).');
})().catch(error => { console.error(error); process.exit(1); });
