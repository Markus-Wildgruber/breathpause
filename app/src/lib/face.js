// face — a drawn face (eyes + mouth) for skins whose skin.json has a "face" block.
//
// Instead of animating painted eyes, the engine draws them: each eye is a white ball with a
// pupil and highlights, closed by two curved lids in the skin's own color; the mouth is one
// closed path whose lips meet at the corners (zero area = the resting smile line, opened =
// a soft open mouth). The "calm" pose follows the breath: eyes open early in the in-breath
// and close late in the out-breath; the mouth opens gently near the top of the breath.
//
//   "face": {
//     "eyes": [{ "cx": 530, "cy": 311, "r": 38 }, ...],   // in the SVG's coordinates
//     "lid": "#C38155",                                    // skin color around the eyes
//     "line": "#524F75", "lineWidth": 8,                   // outlines, lashes, lips
//     "white": "#FFFFFF", "pupil": "#232323",
//     "mouth": { "cx": 578, "cy": 452, "width": 46, "lineWidth": 9,
//                "inner": "#6E3B2E", "tongue": "#E8908F" }      // optional
//   }
//
// The SVG marks where the face goes (and so which group it moves with) with <g id="face"/>.
// The markup is generated as text before the skin's palette/recolor pass, so a recolored
// skin gets a matching face.

const DEFAULTS = { line: '#3A3550', lineWidth: 6, white: '#FFFFFF', pupil: '#232323' };
const MOUTH_DEFAULTS = { inner: '#5A3040', tongue: '#E8908F' };

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const n = (v) => +v.toFixed(2);

// Face values are written straight into SVG markup (after the sanitizer has run), and imported
// skins are untrusted: so colors must be plain color tokens and sizes finite numbers.
const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|[a-z]{3,20})$/i;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateFace(face) {
  if (!face || typeof face !== 'object') throw new Error('face: must be an object');
  if (!Array.isArray(face.eyes) || face.eyes.length === 0) throw new Error('face needs at least one eye');
  face.eyes.forEach((e, i) => {
    if (![e?.cx, e?.cy, e?.r].every(num) || e.r <= 0) throw new Error(`face eye ${i + 1}: needs numeric cx, cy and r`);
  });
  if (typeof face.lid !== 'string') throw new Error('face: needs a "lid" color (the skin color around the eyes)');
  const color = (v, name) => {
    if (v !== undefined && !(typeof v === 'string' && COLOR.test(v))) throw new Error(`face ${name}: not a color (use #rgb, #rrggbb, rgb() or a color name)`);
  };
  for (const k of ['lid', 'line', 'white', 'pupil']) color(face[k], k);
  if (face.lineWidth !== undefined && !num(face.lineWidth)) throw new Error('face lineWidth: must be a number');
  const m = face.mouth;
  if (m !== undefined) {
    if (![m?.cx, m?.cy, m?.width].every(num)) throw new Error('face mouth: needs numeric cx, cy and width');
    color(m.inner, 'mouth inner');
    color(m.tongue, 'mouth tongue');
    if (m.lineWidth !== undefined && !num(m.lineWidth)) throw new Error('face mouth lineWidth: must be a number');
  }
}

// Breath 0 (empty) .. 1 (full) -> how open the eyes and mouth are, 0..1.
export function calmPose(breath) {
  return {
    eyesOpen: 1 - Math.pow(1 - clamp01(breath), 2.4),
    mouthOpen: 0.6 * smooth(0.25, 1, breath),
  };
}

// Lid shapes for one eye. Shut, the lids meet a bit below center (the upper lid does most
// of the work) on a soft downward curve; open, the upper lid arches up out of the eye.
export function lidPaths({ cx, cy, r }, open, meet = 0.3, curve = 1) {
  const L = n(cx - r * 1.4), R = n(cx + r * 1.4);
  const m = cy + r * meet;
  const eT = n(lerp(m, cy - r * 1.12, open)), eB = n(lerp(m, cy + r * 1.12, open));
  const shut = curve * r * 0.42;
  const bowT = n(eT + 2 * lerp(shut, -r * 0.5, open)), bowB = n(eB + 2 * lerp(shut, r * 0.3, open));
  return {
    top: `M${L} ${n(cy - r * 2)}H${R}V${eT}Q${n(cx)} ${bowT} ${L} ${eT}Z`,
    bot: `M${L} ${n(cy + r * 2)}H${R}V${eB}Q${n(cx)} ${bowB} ${L} ${eB}Z`,
    lash: `M${R} ${eT}Q${n(cx)} ${bowT} ${L} ${eT}`,
  };
}

// The mouth outline (also its fill and the tongue's clip) and the tongue ellipse.
export function mouthShape({ cx, cy, width }, open) {
  const hw = (width / 2) * lerp(1, 0.82, open);
  const smile = width * 0.16 * (1 - smooth(0, 0.5, open));
  const oh = width * 0.5 * open;
  const up = cy + smile - oh * 0.25, lo = cy + smile + oh * 0.75;
  // Cubic control y that puts the curve's midpoint at `mid` (ends sit at cy).
  const ctl = (mid) => n((mid - 0.25 * cy) / 0.75);
  const k = 0.85, L = n(cx - hw), R = n(cx + hw), xl = n(cx - hw * k), xr = n(cx + hw * k);
  return {
    d: `M${L} ${n(cy)}C${xl} ${ctl(up)} ${xr} ${ctl(up)} ${R} ${n(cy)}`
     + `C${xr} ${ctl(lo)} ${xl} ${ctl(lo)} ${L} ${n(cy)}Z`,
    tongue: { cx: n(cx), cy: n(lo - oh * 0.12), rx: n(hw * 0.62), ry: n(oh * 0.32 + 0.01) },
  };
}

// SVG markup for the face in its shut/closed pose. `p` prefixes every id so several mounted
// skins (the settings gallery) never share clip paths.
export function faceMarkup(face, p) {
  const f = { ...DEFAULTS, ...face };
  const lw = f.lineWidth;
  let defs = '', body = '';
  f.eyes.forEach((e, i) => {
    const lids = lidPaths(e, 0);
    const px = e.cx, py = e.cy + e.r * 0.06, pr = e.r * 0.36, hr = pr * 1.6;
    defs += `<clipPath id="${p}eye${i}"><circle cx="${n(e.cx)}" cy="${n(e.cy)}" r="${n(e.r)}"/></clipPath>`;
    body += `<g clip-path="url(#${p}eye${i})">`
      + `<circle cx="${n(e.cx)}" cy="${n(e.cy)}" r="${n(e.r)}" fill="${f.white}"/>`
      + `<circle cx="${n(px)}" cy="${n(py)}" r="${n(pr)}" fill="${f.pupil}"/>`
      + `<circle cx="${n(px - hr * 0.35)}" cy="${n(py - hr * 0.38)}" r="${n(e.r * 0.13)}" fill="${f.white}"/>`
      + `<circle cx="${n(px + hr * 0.3)}" cy="${n(py + hr * 0.22)}" r="${n(e.r * 0.06)}" fill="${f.white}"/>`
      + `<path id="${p}lidTop${i}" d="${lids.top}" fill="${f.lid}"/>`
      + `<path id="${p}lidBot${i}" d="${lids.bot}" fill="${f.lid}"/>`
      + `<path id="${p}lash${i}" d="${lids.lash}" fill="none" stroke="${f.line}" stroke-width="${lw}" stroke-linecap="round"/>`
      + `</g>`
      + `<circle cx="${n(e.cx)}" cy="${n(e.cy)}" r="${n(e.r - lw / 2 + 1)}" fill="none" stroke="${f.line}" stroke-width="${lw}"/>`;
  });
  if (f.mouth) {
    const m = { ...MOUTH_DEFAULTS, lineWidth: lw, ...f.mouth };
    const s = mouthShape(m, 0);
    defs += `<clipPath id="${p}mouthClip"><path id="${p}mouthClipPath" d="${s.d}"/></clipPath>`;
    body += `<path id="${p}mouthInner" d="${s.d}" fill="${m.inner}"/>`
      + `<ellipse id="${p}tongue" cx="${s.tongue.cx}" cy="${s.tongue.cy}" rx="${s.tongue.rx}" ry="${s.tongue.ry}"`
      + ` fill="${m.tongue}" clip-path="url(#${p}mouthClip)"/>`
      + `<path id="${p}mouthLine" d="${s.d}" fill="none" stroke="${f.line}" stroke-width="${m.lineWidth}"`
      + ` stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return `<g id="${p}face"><defs>${defs}</defs>${body}</g>`;
}

// Per-frame driver for a mounted face: looks its elements up once, then poses them.
export function faceDriver(svg, face, p) {
  const get = (id) => svg.querySelector(`[id="${p}${id}"]`);
  const eyes = face.eyes.map((e, i) => ({ e, top: get(`lidTop${i}`), bot: get(`lidBot${i}`), lash: get(`lash${i}`) }));
  const mouth = face.mouth && {
    inner: get('mouthInner'), clip: get('mouthClipPath'), line: get('mouthLine'), tongue: get('tongue'),
  };
  let last = null;
  return function pose(breath) {
    const { eyesOpen, mouthOpen } = calmPose(breath);
    const key = `${eyesOpen.toFixed(3)}|${mouthOpen.toFixed(3)}`;
    if (key === last) return;              // holds: nothing moved, skip the DOM writes
    last = key;
    for (const x of eyes) {
      const l = lidPaths(x.e, eyesOpen);
      x.top.setAttribute('d', l.top);
      x.bot.setAttribute('d', l.bot);
      x.lash.setAttribute('d', l.lash);
    }
    if (mouth) {
      const s = mouthShape(face.mouth, mouthOpen);
      for (const el of [mouth.inner, mouth.clip, mouth.line]) el.setAttribute('d', s.d);
      for (const k of ['cx', 'cy', 'rx', 'ry']) mouth.tongue.setAttribute(k, s.tongue[k]);
    }
  };
}
