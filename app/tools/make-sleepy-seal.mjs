// Generates the bundled "sleepy-seal" skin from the public-domain base art
// (app/skins-src/cute-baby-seal.svg, openclipart "Cute baby seal").
//
// Surgery, all referenced by Inkscape element ids of the base file:
//   - hide the two eyeball ellipses + their shine/sparkle whites
//   - recolor the white eye sockets to fur so they read as closed lids
//   - draw closed-eye arcs (rotated with the head tilt, ~-13deg)
//   - add the exhale bubble (ids "bubble"/"bubble-hi", animated via skin.json bindings)
//   - wrap the art in <g id="seal"> as the breathe-binding target
//   - reframe the viewBox to the content
//
// Usage: node tools/make-sleepy-seal.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../skins-src/cute-baby-seal.svg'), 'utf8');
const outDir = join(here, '../public/skins/sleepy-seal');

const FUR = '#d3d7cf';

// Find the full <tag ...> substring that contains id="<id>" and transform it.
function editTag(svg, id, fn) {
  const at = svg.indexOf(`id="${id}"`);
  if (at < 0) throw new Error(`id not found: ${id}`);
  const start = svg.lastIndexOf('<', at);
  const end = svg.indexOf('>', at);
  const tag = svg.slice(start, end + 1);
  return svg.slice(0, start) + fn(tag) + svg.slice(end + 1);
}

const hide = (svg, id) => editTag(svg, id, t => t.replace(`id="${id}"`, `id="${id}" display="none"`));
const refill = (svg, id, color) => editTag(svg, id, t => t.replaceAll(/fill:#[0-9a-fA-F]+/g, `fill:${color}`));

let svg = src;

// eyeballs + big shines + sparkle dots
for (const id of ['ellipse4061', 'path4059', 'path4063', 'circle4065',
                  'path4200', 'path4202', 'path4204', 'path4206', 'path4208', 'path4210']) {
  svg = hide(svg, id);
}
// white sockets -> fur (closed lids)
svg = refill(svg, 'path4196', FUR);
svg = refill(svg, 'path4198', FUR);

// reframe + drop fixed mm size
svg = svg
  .replace(/width="297mm"\s*/, '')
  .replace(/height="210mm"\s*/, '')
  .replace(/viewBox="0 0 1052.3622 744.09448"/, 'viewBox="55 5 895 755"');

// wrap the two Inkscape layers in the breathe target
const firstLayer = svg.indexOf('<g\n     inkscape:groupmode="layer"');
if (firstLayer < 0) throw new Error('layer group not found');
svg = svg.slice(0, firstLayer) + '<g id="seal">\n' + svg.slice(firstLayer);

const additions = `
    <!-- sleepy additions (breathpause) -->
    <g id="closed-eyes">
      <!-- fur patches covering the dark eye surrounds of the line-art layer -->
      <ellipse cx="602" cy="235" rx="52" ry="62" fill="${FUR}" transform="rotate(-13 602 235)"/>
      <ellipse cx="770" cy="191" rx="47" ry="56" fill="${FUR}" transform="rotate(-13 770 191)"/>
      <g stroke="#555753" stroke-width="9" fill="none" stroke-linecap="round">
        <path d="M 555 246 Q 589 274 623 246" transform="rotate(-13 589 252)"/>
        <path d="M 723 206 Q 755 232 787 206" transform="rotate(-13 755 212)"/>
      </g>
    </g>
    <g id="bubble-rig">
      <circle id="bubble" cx="812" cy="350" r="20" fill="#bfe3ff" stroke="#7fb8e8" stroke-width="6" opacity="0.9"/>
      <circle id="bubble-hi" cx="800" cy="338" r="5" fill="#ffffff" opacity="0.95"/>
    </g>
  </g><!-- /seal -->
`;
svg = svg.replace('</svg>', additions + '</svg>');

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'skin.svg'), svg);
console.log('wrote', join(outDir, 'skin.svg'), svg.length, 'bytes');
