import { test } from 'node:test';
import assert from 'node:assert';
import { calmPose, lidPaths, mouthShape, faceMarkup, validateFace } from '../src/lib/face.js';
import { recolor } from '../src/lib/skin.js';

const FACE = {
  eyes: [{ cx: 30, cy: 40, r: 10 }, { cx: 70, cy: 40, r: 12 }],
  line: '#524F75', lineWidth: 3, lid: '#C38155', white: '#FFFFFF', pupil: '#232323',
  mouth: { cx: 50, cy: 70, width: 20, lineWidth: 3, inner: '#6E3B2E', tongue: '#E8908F' },
};
// The y values of a path's commands, in order: M x y -> y, V y -> y, Q/C -> every control/end y.
const ys = (d) => [...d.matchAll(/([MVQC])([^MVQCHZ]*)/g)].flatMap(([, cmd, args]) => {
  const n = args.trim().split(/[\s,]+/).map(Number);
  return cmd === 'V' ? n : n.filter((_, i) => i % 2 === 1);
});
// Lid path: M L top H R V <edge> Q cx <bow> L <edge> Z  ->  ys = [top, edge, bow, edge]
// Mouth path: M L cy C .. <up> .. <up> R cy C .. <lo> .. <lo> L cy Z  ->  ys = [cy, up, up, cy, lo, lo, cy]

test('calm pose: eyes shut and mouth closed when empty, open when full', () => {
  assert.deepEqual(calmPose(0), { eyesOpen: 0, mouthOpen: 0 });
  const full = calmPose(1);
  assert.equal(full.eyesOpen, 1);
  assert.ok(full.mouthOpen > 0.5 && full.mouthOpen <= 0.6);
});

test('calm pose: eyes open early in the in-breath (eased), mouth only later', () => {
  const p = calmPose(0.3);
  assert.ok(p.eyesOpen > 0.5, `eyes ${p.eyesOpen}`);
  assert.ok(p.mouthOpen < 0.1, `mouth ${p.mouthOpen}`);
  let prev = -1;
  for (let b = 0; b <= 1; b += 0.05) { const o = calmPose(b).eyesOpen; assert.ok(o >= prev); prev = o; }
});

test('lids: fully open, both lid edges clear the eye', () => {
  const eye = FACE.eyes[0];
  const { top, bot } = lidPaths(eye, 1);
  assert.ok(ys(top)[1] < eye.cy - eye.r, 'upper lid edge above the eye');
  assert.ok(ys(bot)[1] > eye.cy + eye.r, 'lower lid edge below the eye');
});

test('lids: shut, the upper and lower lid edges meet on the same line, below center', () => {
  const eye = FACE.eyes[0];
  const { top, bot } = lidPaths(eye, 0);
  const edgeTop = ys(top)[1], edgeBot = ys(bot)[1];
  assert.equal(edgeTop, edgeBot);
  assert.ok(edgeTop > eye.cy);            // the upper lid does most of the work
});

test('mouth: closed is a zero-area line (both lips on one curve), open has height', () => {
  const closed = mouthShape(FACE.mouth, 0);
  const c = ys(closed.d);
  assert.equal(c[1], c[4], 'upper and lower lip on one curve');
  assert.ok(c[1] > FACE.mouth.cy, 'resting mouth smiles (bows down)');
  const o = ys(mouthShape(FACE.mouth, 0.6).d);
  assert.ok(o[4] > o[1] + 5, 'lower lip below upper lip');
  const open = mouthShape(FACE.mouth, 0.6);
  assert.ok(open.tongue.ry > closed.tongue.ry);
});

test('face markup: ids are prefixed per mount and clip refs point at them', () => {
  const a = faceMarkup(FACE, 'bpf1-'), b = faceMarkup(FACE, 'bpf2-');
  const ids = [...a.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  assert.ok(ids.every((id) => id.startsWith('bpf1-')));
  for (const [, ref] of a.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(ref), ref);
  assert.ok(!b.includes('bpf1-'));
});

test('face markup: colors are plain fill/stroke values, so skin recoloring reaches them', () => {
  const m = faceMarkup(FACE, 'p-');
  const shifted = recolor(m, '#C38155', '#4A90C8');
  assert.ok(m.includes('fill="#C38155"'));
  assert.ok(!shifted.includes('#C38155'), 'lid color follows the fur');
  assert.ok(shifted.includes('#FFFFFF'), 'eye whites stay white');
});

test('validateFace rejects anything but real colors and numbers (imported skins are untrusted)', () => {
  for (const evil of ['#000"/><image href=x onerror=alert(1)>', "red$'", 'url(javascript:x)', '#12345', '']) {
    for (const key of ['lid', 'line', 'white', 'pupil']) {
      assert.throws(() => validateFace({ ...FACE, [key]: evil }), /color/, `${key}: ${evil}`);
    }
    assert.throws(() => validateFace({ ...FACE, mouth: { ...FACE.mouth, inner: evil } }), /color/);
    assert.throws(() => validateFace({ ...FACE, mouth: { ...FACE.mouth, tongue: evil } }), /color/);
  }
  assert.throws(() => validateFace({ ...FACE, lineWidth: '3"/>' }), /lineWidth/);
  assert.throws(() => validateFace({ ...FACE, mouth: { ...FACE.mouth, lineWidth: '9' } }), /lineWidth/);
  assert.throws(() => validateFace({ ...FACE, eyes: [{ cx: 1, cy: 2, r: Infinity }] }), /cx, cy and r/);
  for (const ok of ['#abc', '#A1B2C3', 'rgb(1, 2, 3)', 'white']) assert.doesNotThrow(() => validateFace({ ...FACE, lid: ok }));
});

test('validateFace accepts a good block and rejects broken ones', () => {
  assert.doesNotThrow(() => validateFace(FACE));
  assert.doesNotThrow(() => validateFace({ ...FACE, mouth: undefined }));
  assert.throws(() => validateFace({ ...FACE, eyes: [] }), /at least one eye/);
  assert.throws(() => validateFace({ ...FACE, eyes: [{ cx: 1, cy: 2 }] }), /cx, cy and r/);
  assert.throws(() => validateFace({ ...FACE, mouth: { cx: 1, cy: 2 } }), /mouth/);
  assert.throws(() => validateFace({ ...FACE, lid: undefined }), /"lid" color/);
  assert.throws(() => validateFace(undefined), /face/);
});
