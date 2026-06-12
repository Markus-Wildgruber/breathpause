# Creating BreathePause skins

A skin is a folder with two files:

```
my-skin/
├── skin.json    # manifest: name, recolor anchor, animation bindings
└── skin.svg     # the artwork (plain SVG, e.g. drawn in Inkscape)
```

Zip the folder and import it in **Settings → Skins → "+ Import skin (SVG or ZIP)"**.
A bare `.svg` can also be imported on its own — it breathes as a whole (and can be
recolored), but has no per-part animation until you add a manifest.

## How animation works

There is no timeline. The app feeds your skin two live values every frame and your
manifest declares how SVG elements respond ("bindings"):

- **`breath`** — `0` fully exhaled → `1` fully inhaled, eased. During *hold* phases the
  value freezes. This is the only signal you need for in / hold-in / out / hold-out:
  map a property onto `breath` and holds come along for free.
- **`time`** — a gentle ±1 idle wobble (sin of elapsed seconds), for ambient motion.

Because everything is a pure function of `breath`, your skin automatically follows any
breathing pattern (box, 4-7-8, …), pausing, and pattern changes.

> Embedded SMIL/CSS animations are **not** supported — they run on their own clock and
> can't follow the user's breathing pattern. Scripts, event handlers and external
> references are stripped from imported SVGs for safety.

## skin.json reference

```json
{
  "name": "My Skin",
  "svg": "skin.svg",
  "themeColor": "#C38155",
  "tintNeutrals": false,
  "text": { "color": "#3A2C50" },
  "bindings": [
    { "target": "body", "property": "scale", "source": "breath",
      "from": 1.0, "to": 1.06, "origin": [523, 518] }
  ]
}
```

| Field | Meaning |
|---|---|
| `name` | Display name (required). |
| `svg` | SVG filename next to skin.json (default `skin.svg`). |
| `themeColor` | The "anchor" color users recolor from. Pick your art's dominant color. The whole SVG is hue-shifted from this anchor to whatever fill the user chooses, preserving shading. |
| `tintNeutrals` | `true` for grey-bodied art: greys get tinted too when recoloring. |
| `text` | Hints for the app's overlay text, e.g. `{ "color": "#3A2C50" }`. |
| `bindings` | The animation rig — see below. |

### Bindings

Each binding maps one source value onto one property of one SVG element per frame:

| Key | Values |
|---|---|
| `target` | The `id` of an element/group in your SVG. Must exist (checked at import). |
| `property` | `scale`, `translateX`, `translateY`, `r`, `opacity` |
| `source` | `breath` or `time` |
| `from` → `to` | Property value at source `0` → at source `1` (linear in between). |
| `origin` | `[x, y]` in viewBox coordinates — the fixed point for `scale`. |

Notes that save you time:

- A binding **overwrites** its target's `transform` each frame. If a part needs a static
  transform too (e.g. mirroring), wrap it in an extra outer `<g>` and put the static
  transform there.
- Reveal-style motion (eyelids, mouths) works best with a `<clipPath>`: clip the moving
  part to the shape it lives in, then `translateY` it. The part keeps its silhouette and
  never spills onto the body.
- Anchor `scale` where the motion should grow *from*: a mouth from the lip line, a body
  from the belly.

## Worked example: the bundled Cute Bear

`app/public/skins/cute-bear/` is a complete reference rig:

```json
"bindings": [
  { "target": "bear",      "property": "scale",      "source": "breath", "from": 1.0, "to": 1.06, "origin": [523, 518] },
  { "target": "mouthOpen", "property": "scale",      "source": "breath", "from": 0.0, "to": 1.0,  "origin": [578, 454] },
  { "target": "mouthRest", "property": "opacity",    "source": "breath", "from": 1.0, "to": 0.0 },
  { "target": "lidTopL",   "property": "translateY", "source": "breath", "from": 0.0, "to": -50 },
  { "target": "lidBotL",   "property": "translateY", "source": "breath", "from": 0.0, "to": 50 },
  { "target": "lidTopR",   "property": "translateY", "source": "breath", "from": 0.0, "to": -46 },
  { "target": "lidBotR",   "property": "translateY", "source": "breath", "from": 0.0, "to": 46 }
]
```

- the whole bear (`<g id="bear">`) inflates 6% from the belly,
- the mouth grows open on the inhale while the resting smile fades,
- the eyelids are clip-path'd half-discs that slide apart from the eye's middle —
  closed at exhale, open at the top of the inhale.

The sleepy seal (`skins/sleepy-seal/`) shows the inverse trick: an exhale bubble whose
radius binds `from: 52, to: 12` — it *grows* as breath falls.

## Workflow

1. **Draw or adapt** your figure as SVG. Flat, bold-outlined cartoon styles read best at
   bubble size. Mind the license if you adapt found art (see `CREDITS.md`).
2. **Name the moving parts.** In Inkscape: group each part (Object → Group), then set its
   `id` in the XML editor (Ctrl+Shift+X). Draw closed-state overlays (eyelids, resting
   mouth) on top of the open state — you'll animate the overlay away.
3. **Find anchor points** (for `origin`): hover coordinates in Inkscape's status bar, or
   `document.getElementById('part').getBBox()` in any browser console.
4. **Write `skin.json`** next to the SVG and iterate: a quick preview harness lives at
   `app/public/skins/cute-bear/breathing-demo.html` (run `npm run dev` inside `app/`,
   open `http://localhost:5173/skins/cute-bear/breathing-demo.html`) — copy it into your
   skin folder and it will drive *your* `skin.json`.
5. **Zip the folder, import it** in Settings → Skins. Import validates the manifest and
   every binding target, and tells you what's wrong instead of failing silently.
