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
  let svgText = skin.svgText;
  for (const [from, to] of Object.entries(palette)) {
    svgText = svgText.replaceAll(new RegExp(escapeRegExp(from), 'gi'), to);
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

const PROPERTIES = ['scale', 'r', 'opacity', 'translateX', 'translateY'];
const SOURCES = ['breath', 'time'];

function validateBinding(b) {
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
