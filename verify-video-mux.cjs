// The video export's MP4/QuickTime writer: box layout, sample tables and offsets.
const assert = require('node:assert/strict');
const {mux} = require('./public/editor/video-mux.js');

async function bytes(blob) { return new Uint8Array(await blob.arrayBuffer()); }
function boxes(buf, start = 0, end = buf.length) {
  const out = [], dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let at = start; at < end;) {
    const size = dv.getUint32(at), type = String.fromCharCode(...buf.subarray(at + 4, at + 8));
    assert.ok(size >= 8 && at + size <= end, `box ${type} fits`);
    out.push({type, at, size}); at += size;
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

(async () => {
  const video = {width: 1080, height: 1920, fps: 30, description: Uint8Array.from([1, 100, 0, 40, 255, 225, 0, 0]),
    samples: [{data: Uint8Array.from([0, 0, 0, 2, 9, 9]), key: true}, {data: Uint8Array.from([0, 0, 0, 1, 7]), key: false}, {data: Uint8Array.from([0, 0, 0, 1, 8]), key: false}]};

  // PCM -> QuickTime .mov
  const pcm = new Uint8Array(44100 * 4 / 10); // 0.1 s of stereo 16-bit silence
  const mov = await bytes(mux({video, audio: {codec: 'pcm', sampleRate: 44100, channels: 2, pcm}}));
  const top = boxes(mov).map(b => b.type);
  assert.deepEqual(top, ['ftyp', 'mdat', 'moov']);
  assert.equal(String.fromCharCode(...mov.subarray(8, 12)), 'qt  ');
  const mdat = boxes(mov).find(b => b.type === 'mdat');
  assert.equal(mdat.size, 8 + 6 + 5 + 5 + pcm.length, 'mdat holds every sample');
  const traks = boxes(mov, boxes(mov).find(b => b.type === 'moov').at + 8, mov.length).filter(b => b.type === 'trak');
  assert.equal(traks.length, 2);
  const vStco = find(mov.subarray(traks[0].at, traks[0].at + traks[0].size), ['trak', 'mdia', 'minf', 'stbl', 'stco']);
  assert.equal(u32(mov, traks[0].at + vStco.at + 16), mdat.at + 8, 'video chunk starts right after the mdat header');
  const aStco = find(mov.subarray(traks[1].at, traks[1].at + traks[1].size), ['trak', 'mdia', 'minf', 'stbl', 'stco']);
  assert.equal(u32(mov, traks[1].at + aStco.at + 16), mdat.at + 8 + 16, 'audio follows the video samples');
  const stsz = find(mov.subarray(traks[0].at, traks[0].at + traks[0].size), ['trak', 'mdia', 'minf', 'stbl', 'stsz']);
  assert.equal(u32(mov, traks[0].at + stsz.at + 16), 3, 'three video samples');
  const stss = find(mov.subarray(traks[0].at, traks[0].at + traks[0].size), ['trak', 'mdia', 'minf', 'stbl', 'stss']);
  assert.equal(u32(mov, traks[0].at + stss.at + 12), 1, 'one keyframe');
  find(mov.subarray(traks[1].at, traks[1].at + traks[1].size), ['trak', 'mdia', 'minf', 'stbl', 'stsd', 'sowt']);

  // AAC -> .mp4
  const aac = [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5])];
  const mp4blob = mux({video, audio: {codec: 'aac', sampleRate: 44100, channels: 2, bitrate: 192000, description: Uint8Array.from([0x12, 0x10]), samples: aac}});
  assert.equal(mp4blob.type, 'video/mp4');
  const mp4 = await bytes(mp4blob);
  assert.equal(String.fromCharCode(...mp4.subarray(8, 12)), 'isom');
  const at = boxes(mp4, boxes(mp4).find(b => b.type === 'moov').at + 8, mp4.length).filter(b => b.type === 'trak')[1];
  find(mp4.subarray(at.at, at.at + at.size), ['trak', 'mdia', 'minf', 'stbl', 'stsd', 'mp4a', 'esds']);
  // B-frames: decode order I0 P3 B1 B2 -> ctts offsets and an edit list for the one-frame delay.
  const bvideo = {...video, samples: [0, 3, 1, 2].map((pts, i) => ({data: Uint8Array.of(0, 0, 0, 1, i), key: i === 0, pts}))};
  const bmov = await bytes(mux({video: bvideo, audio: {codec: 'pcm', sampleRate: 44100, channels: 2, pcm}}));
  const bt = boxes(bmov, boxes(bmov).find(b => b.type === 'moov').at + 8, bmov.length).filter(b => b.type === 'trak')[0];
  const trakBytes = bmov.subarray(bt.at, bt.at + bt.size);
  const ctts = find(trakBytes, ['trak', 'mdia', 'minf', 'stbl', 'ctts']);
  const entries = u32(bmov, bt.at + ctts.at + 12), offsets = [];
  for (let i = 0; i < entries; i++) { const count = u32(bmov, bt.at + ctts.at + 16 + i * 8), delta = u32(bmov, bt.at + ctts.at + 20 + i * 8); for (let k = 0; k < count; k++) offsets.push(delta); }
  assert.deepEqual(offsets, [1000, 3000, 0, 0], 'composition offsets put frames back in display order');
  const elst = find(trakBytes, ['trak', 'edts', 'elst']);
  assert.equal(u32(bmov, bt.at + elst.at + 20), 1000, 'edit list skips the one-frame decoder delay');
  assert.equal(boxes(mov, traks[0].at + 8, traks[0].at + traks[0].size).some(b => b.type === 'edts'), false, 'no edit list without B-frames');
  console.log('PASS: video export MP4/QuickTime writer (box layout, offsets, keyframes, PCM and AAC tracks).');
})().catch(error => { console.error(error); process.exit(1); });
