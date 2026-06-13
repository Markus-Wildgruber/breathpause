// skin — load a skin (folder with skin.json + skin.svg) and drive its bindings.
//
// A binding maps an animation source onto one SVG element property per frame:
//   { target: "<element id>", property: "scale"|"r"|"opacity"|"translateY"|"translateX",
//     source: "breath"|"time", from: <value at source 0>, to: <value at source 1>,
//     origin: [x, y]    // for transforms: fixed point in the skin's viewBox coords
//   }
// Sources are normalized values provided each frame: breath 0 (exhaled) .. 1 (inhaled);
// time is seconds since start passed through sin() -> -1..1 (gentle idle wobble).
//
// Broken skins must never break the app: loadSkin() throws with a clear message and the
// caller falls back to the bundled orb skin (SPEC: skip + log + fall back).

// Load a skin by ID: checks customSkins first, falls back to bundled skins folder.
// A custom skin's themeColor (the recolor anchor, picked at import) is carried onto
// the manifest so mountSkin can hue-shift it just like a bundled skin. Skins imported
// as a folder/zip also bring their own bindings + text hints (bare-SVG imports have none).
export async function loadSkinById(skinId, customSkins = []) {
  const custom = (customSkins || []).find(cs => cs.id === skinId);
  if (custom) {
    return {
      manifest: {
        name: custom.name, bindings: custom.bindings || [],
        themeColor: custom.themeColor || null, tintNeutrals: !!custom.tintNeutrals,
        text: custom.text || undefined,
      },
      svgText: custom.svgText, baseUrl: null,
    };
  }
  return loadSkin(`skins/${skinId}`);
}

export async function loadSkin(baseUrl) {
  const manifest = await fetchJson(`${baseUrl}/skin.json`);
  if (!manifest.name) throw new Error(`skin at ${baseUrl}: missing "name"`);
  const svgText = await fetchText(`${baseUrl}/${manifest.svg || 'skin.svg'}`);
  for (const b of manifest.bindings || []) validateBinding(b);
  return { manifest, svgText, baseUrl };
}

// Mount into a container element; returns a handle with apply(sources) for the rAF loop.
// opts.palette overrides/extends the manifest palette: a map of the SVG's original hex
// colors to replacement colors, e.g. { "#d3d7cf": "#cfe4ff" } — how one piece of art
// ships in many color schemes without duplicating geometry.
export function mountSkin(container, skin, opts = {}) {
  const palette = { ...(skin.manifest.palette || {}), ...(opts.palette || {}) };
  let svgText = applyPalette(sanitizeSvg(skin.svgText), palette);
  // opts.fill recolors the whole skin by hue-shifting it from the skin's themeColor
  // anchor to the fill. Skins with no anchor (e.g. bare uploads) are shown as-is.
  if (opts.fill && skin.manifest.themeColor) {
    svgText = recolor(svgText, skin.manifest.themeColor, opts.fill, skin.manifest.tintNeutrals);
  }
  container.innerHTML = svgText;
  const svg = container.querySelector('svg');
  if (!svg) throw new Error(`skin ${skin.manifest.name}: skin.svg has no <svg> root`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');

  const bindings = (skin.manifest.bindings || []).map(b => {
    const el = svg.getElementById ? svg.getElementById(b.target) : container.querySelector('#' + b.target);
    if (!el) throw new Error(`skin ${skin.manifest.name}: binding target "${b.target}" not in skin.svg`);
    return { ...b, el, baseTransform: el.getAttribute('transform') || '' };
  });

  function apply(sources) {
    for (const b of bindings) {
      const s = sources[b.source] ?? 0;
      const v = b.from + s * (b.to - b.from);
      switch (b.property) {
        case 'scale': {
          const [ox, oy] = b.origin || [0, 0];
          b.el.setAttribute('transform',
            `${b.baseTransform} translate(${ox} ${oy}) scale(${v}) translate(${-ox} ${-oy})`);
          break;
        }
        case 'translateX':
          b.el.setAttribute('transform', `${b.baseTransform} translate(${v} 0)`);
          break;
        case 'translateY':
          b.el.setAttribute('transform', `${b.baseTransform} translate(0 ${v})`);
          break;
        case 'r':
        case 'opacity':
          b.el.setAttribute(b.property, v);
          break;
      }
    }
  }

  return { apply, svg };
}

// Apply a palette (map of original hex color -> replacement) to raw SVG text.
// Keys are matched literally (regex-escaped) and case-insensitively, so "#D3D7CF"
// in the art is hit by a "#d3d7cf" palette key.
export function applyPalette(svgText, palette = {}) {
  let out = svgText;
  for (const [from, to] of Object.entries(palette)) {
    out = out.replaceAll(new RegExp(escapeRegExp(from), 'gi'), to);
  }
  return out;
}

// Defense-in-depth for imported (untrusted) SVGs: this string is injected with innerHTML.
// The strict CSP (script-src 'self') is the real guarantee that nothing here executes;
// this strips the active/exfiltration vectors — <script>, <foreignObject> (smuggled HTML),
// on* handlers, and external/data href refs — while keeping internal "#id" refs that
// gradients/<use> need. Not a full sanitizer (no DOM parse), so it's belt-and-suspenders.
export function sanitizeSvg(svgText) {
  return svgText
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[\s\S]*?\/>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*"(?!#)[^"]*"/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*'(?!#)[^']*'/gi, '');
}

// ---- recolor engine -------------------------------------------------------
// Recolor a skin by hue-shifting it from an anchor color to a fill color. Every
// sufficiently-saturated color in the SVG is rotated by the SAME hue+saturation
// delta (anchor -> fill), so multi-tone art keeps its internal color relationships;
// each color's lightness is preserved so shading/depth survives. Near-neutral colors
// (saturation < GREY_CUTOFF: whites, greys, blacks) are left untouched.
const GREY_CUTOFF = 0.10;

// Common CSS named colors -> [r,g,b]. Sorted longest-first when matched so e.g.
// "whitesmoke" wins over "white". Not exhaustive — covers hand-authored SVGs.
const NAMED_COLORS = {
  white: [255,255,255], black: [0,0,0], red: [255,0,0], green: [0,128,0],
  blue: [0,0,255], yellow: [255,255,0], cyan: [0,255,255], aqua: [0,255,255],
  magenta: [255,0,255], fuchsia: [255,0,255], gray: [128,128,128], grey: [128,128,128],
  silver: [192,192,192], maroon: [128,0,0], olive: [128,128,0], lime: [0,255,0],
  teal: [0,128,128], navy: [0,0,128], purple: [128,0,128], orange: [255,165,0],
  pink: [255,192,203], brown: [165,42,42], gold: [255,215,0], skyblue: [135,206,235],
  indigo: [75,0,130], violet: [238,130,238], coral: [255,127,80], salmon: [250,128,114],
  khaki: [240,230,140], crimson: [220,20,60], turquoise: [64,224,208], whitesmoke: [245,245,245],
};

// A color token only counts when it's the VALUE of a color-bearing attribute or CSS
// property (fill="…", stroke:…, stop-color="…"). Matching tokens anywhere in the markup
// would rewrite unrelated text — class="red", <title>gold</title>, an id, a font name — so
// we anchor on the property name and rewrite only the value that follows it.
const COLOR_PROPS = 'fill|stroke|stop-color|flood-color|lighting-color|solid-color|color';
const COLOR_TOKEN =
  '#[0-9a-fA-F]{6}\\b|#[0-9a-fA-F]{3}\\b|rgb\\(\\s*\\d+\\s*,\\s*\\d+\\s*,\\s*\\d+\\s*\\)|[a-zA-Z]+';
// Groups: 1 = property, 2 = separator (: or =, optional quote), 3 = the color token.
function colorContextRe() {
  return new RegExp('\\b(' + COLOR_PROPS + ')(\\s*[:=]\\s*["\\\']?)(' + COLOR_TOKEN + ')', 'gi');
}

// Parse a hex / rgb() / named color token to [r,g,b], or null if unrecognized.
function parseColor(str) {
  const t = str.trim().toLowerCase();
  if (t[0] === '#') {
    const h = t.slice(1);
    if (h.length === 3) return [h[0], h[1], h[2]].map(c => parseInt(c + c, 16));
    if (h.length === 6) return [h.slice(0,2), h.slice(2,4), h.slice(4,6)].map(c => parseInt(c, 16));
    return null;
  }
  const m = t.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (m) return [+m[1], +m[2], +m[3]].map(n => Math.min(255, n));
  return NAMED_COLORS[t] || null;
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t) => {
      t = (t + 1) % 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    r = hue2rgb(h + 1/3); g = hue2rgb(h); b = hue2rgb(h - 1/3);
  }
  const hex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// The color shifts each recolored color by the anchor->fill delta in hue, saturation
// AND lightness — so a dark color darkens the skin and a light color lightens it (a black
// fill ~= black skin, white ~= pale skin). Relative shading is preserved (one delta for
// all), not absolute lightness. tintNeutrals: when true, near-neutral colors (greys) are
// also recolored — set to the fill's hue/saturation, shifted in lightness — so a grey-
// bodied mascot takes the color too. When false (the default), neutrals are left alone.
export function recolor(svgText, anchorHex, fillHex, tintNeutrals = false) {
  const anchor = parseColor(anchorHex), fill = parseColor(fillHex);
  if (!anchor || !fill) return svgText;
  const a = rgbToHsl(anchor), f = rgbToHsl(fill);
  const dH = f.h - a.h, dS = f.s - a.s, dL = f.l - a.l;
  if (dH === 0 && dS === 0 && dL === 0) return svgText;   // fill == anchor: authored look
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return svgText.replace(colorContextRe(), (m, prop, sep, token) => {
    const rgb = parseColor(token);
    if (!rgb) return m;                              // e.g. "none", "url(#g)", "currentColor"
    const c = rgbToHsl(rgb);
    let out;
    if (c.s < GREY_CUTOFF) {
      if (!tintNeutrals) return m;                   // leave neutrals untouched
      out = hslToHex(f.h, f.s, clamp(c.l + dL));     // tint hue/sat + shift lightness
    } else {
      out = hslToHex(c.h + dH, clamp(c.s + dS), clamp(c.l + dL));
    }
    return prop + sep + out;
  });
}

const HUE_MERGE = 20; // candidate swatches within this many degrees collapse to one

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// True for near-neutral colors (greys/white/black) — the recolor anchor's hue is then
// meaningless, which is the signal that a skin wants whole-body tinting (tintNeutrals).
export function isNeutral(hex) {
  const rgb = parseColor(hex);
  return !rgb || rgbToHsl(rgb).s < GREY_CUTOFF;
}

// Candidate "theme color" anchors offered at import time: the SVG's colors, most-frequent
// first, with near-identical hues collapsed to one representative. This keeps shaded art
// (e.g. three Tango reds for one element) from showing as three near-duplicate swatches —
// since recolor shifts a whole hue family by one delta anyway, the exact shade picked as
// anchor doesn't matter, only its hue family. With includeNeutrals, the single most-common
// grey is also offered (their hues are meaningless, so all neutrals collapse to one), so a
// grey-bodied mascot can anchor on its body color instead of a stray accent.
export function scanColors(svgText, { includeNeutrals = false, limit = 8 } = {}) {
  const counts = new Map(), hslOf = new Map();
  for (const m of svgText.matchAll(colorContextRe())) {
    const rgb = parseColor(m[3]);
    if (!rgb) continue;
    const c = rgbToHsl(rgb);
    const hex = hslToHex(c.h, c.s, c.l);
    counts.set(hex, (counts.get(hex) || 0) + 1);
    hslOf.set(hex, c);
  }
  const byFreq = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const reps = [];
  let haveNeutral = false;
  for (const hex of byFreq) {
    const c = hslOf.get(hex);
    if (c.s < GREY_CUTOFF) {
      if (!includeNeutrals || haveNeutral) continue;   // greys collapse to one rep
      haveNeutral = true;
    } else if (reps.some(r => hslOf.get(r).s >= GREY_CUTOFF && hueDist(hslOf.get(r).h, c.h) <= HUE_MERGE)) {
      continue;                                         // same hue family already represented
    }
    reps.push(hex);
    if (reps.length >= limit) break;
  }
  return reps;
}

// Validate a skin-folder import (skin.json text + the SVG it references) and normalize
// it into the fields persisted on a customSkins entry. Throws with a user-facing message
// when something is broken — surfaced at import time instead of a silent orb fallback.
export function parseSkinImport(manifestText, svgText) {
  let manifest;
  try { manifest = JSON.parse(manifestText); }
  catch { throw new Error('skin.json is not valid JSON'); }
  if (!manifest.name) throw new Error('skin.json: missing "name"');
  if (typeof svgText !== 'string' || !/<svg[\s>]/i.test(svgText)) {
    throw new Error('the skin SVG has no <svg> root');
  }
  const bindings = manifest.bindings || [];
  for (const b of bindings) {
    validateBinding(b);
    // mountSkin would throw later anyway — fail here, where the user can react
    if (!new RegExp(`\\bid=["']${escapeRegExp(b.target)}["']`).test(svgText)) {
      throw new Error(`binding target "${b.target}" not found in the SVG`);
    }
  }
  return {
    name: manifest.name,
    svgText,
    themeColor: manifest.themeColor || null,
    tintNeutrals: !!manifest.tintNeutrals,
    bindings,
    text: manifest.text || null,
  };
}

const PROPERTIES = ['scale', 'r', 'opacity', 'translateX', 'translateY'];
const SOURCES = ['breath', 'time'];

export function validateBinding(b) {
  if (!b.target) throw new Error('binding: missing "target"');
  if (!PROPERTIES.includes(b.property)) throw new Error(`binding ${b.target}: unknown property "${b.property}"`);
  if (!SOURCES.includes(b.source)) throw new Error(`binding ${b.target}: unknown source "${b.source}"`);
  if (typeof b.from !== 'number' || typeof b.to !== 'number') throw new Error(`binding ${b.target}: "from"/"to" must be numbers`);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}
