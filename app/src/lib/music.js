// music — generated breathing music. Every sound is synthesized live from the breathing
// pattern (no audio files), so it fits any timing and every cycle sounds the same:
// in-breath phrases rise, out-breath phrases settle, and holds follow a chosen hold style.
//
// The audio clock is the master while music plays: breathTime() is what the bubble animates
// from, so picture and sound never drift. Pausing suspends the audio clock, which freezes both.
//
//   const m = createMusic();
//   m.setOptions({ sound, hold, volume, room });   // volume/room apply live; sound/hold on next start()
//   m.start(enginePhases, breathT);                 // joins mid-phase at breathT (seconds into the pattern)
//   m.pause(); m.resume(); m.stop();

export const SOUNDS = [
  { id: 'handpan', name: 'Handpan flow' },
  { id: 'handpan-calm', name: 'Handpan calm' },
  { id: 'notes', name: 'Rising notes' },
  { id: 'kalimba', name: 'Kalimba' },
  { id: 'piano', name: 'Soft piano' },
  { id: 'flute', name: 'Flute glide' },
  { id: 'waves', name: 'Gentle waves' },
];
// voice: what a sound's own tone does on a hold ('keep' sounding quietly, or 'release').
export const HOLDS = [
  { id: 'ring', name: 'Ring out', voice: 'release', desc: 'The last sound fades and the hold is quiet.' },
  { id: 'pulse', name: 'Soft pulse', voice: 'release', desc: 'A quiet tick every second, to count the hold.' },
  { id: 'countdown', name: 'Countdown', voice: 'release', desc: 'Quiet, then three soft ticks into the next phase.' },
  { id: 'chimes', name: 'Chimes', voice: 'release', desc: 'A few soft high notes float, never rising or falling.' },
  { id: 'sustain', name: 'Sustain', voice: 'keep', desc: 'The last tone keeps sounding quietly.' },
];

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const ease = (k) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, k)))) / 2;

// ---------- pure timing helpers (tested) ----------

// Engine phases ({type: inhale|exhale|hold, seconds}) -> [{type: in|out|hold, sec, l0, l1}],
// where l0/l1 are the breath level (0 empty .. 1 full) at the phase's start and end.
export function toTimeline(phases) {
  const TYPE = { inhale: 'in', exhale: 'out', hold: 'hold' };
  let level = 0;
  return phases.filter((p) => p.seconds > 0).map((p) => {
    const type = TYPE[p.type] || 'hold';
    const l0 = level, l1 = type === 'in' ? 1 : type === 'out' ? 0 : level;
    level = l1;
    return { type, sec: p.seconds, l0, l1 };
  });
}

// Which phase t (seconds into the pattern, any cycle) falls in, and how far into it.
export function locate(timeline, t) {
  const len = timeline.reduce((s, p) => s + p.sec, 0);
  let r = ((t % len) + len) % len;
  for (let idx = 0; idx < timeline.length; idx++) {
    if (r < timeline[idx].sec) return { idx, offset: +r.toFixed(9) };
    r -= timeline[idx].sec;
  }
  return { idx: 0, offset: 0 };
}

// Small seeded random, so composed phrases and chimes repeat exactly every cycle.
function seeded(seed) { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }

// D Kurd, the classic handpan scale: ding D3, then A3 Bb3 C4 D4 E4 F4 G4 A4 C5.
const DING = midi(50);
export const KURD = [57, 58, 60, 62, 64, 65, 67, 69, 72].map(midi);

// A handpan phrase for one phase: a ding on the first beat, then notes on a steady pulse that
// fits the phase, walking through the scale with a growing pull toward where the phase should
// end (top of the scale after breathing in, low after breathing out). Some two-note strikes
// (`under`) and soft ghost notes. Seeded by phase kind and length: identical every cycle.
export function phrase(type, dur, density) {
  const up = type === 'in';
  const r = seeded((up ? 11 : 23) * 1000 + Math.round(dur * 10));
  const steps = Math.max(3, Math.round(dur / density));
  const step = dur / steps;
  let idx = up ? 1 : KURD.length - 2;
  const goal = up ? KURD.length - 1 : 2;
  const notes = [{ at: 0, f: DING, vel: 0.5 }];
  for (let i = 0; i < steps; i++) {
    const pull = (goal - idx) * (i / steps) * 0.6;
    idx = Math.round(Math.min(KURD.length - 1, Math.max(0, idx + pull + (r() * 2.4 - 1.2))));
    if (i === steps - 1) idx = goal;
    const accent = i % 4 === 0 ? 1 : i % 2 === 0 ? 0.8 : 0.6;
    const ghost = r() < 0.22 && i < steps - 1;
    const swell = up ? 0.7 + 0.3 * (i / steps) : 1 - 0.35 * (i / steps);   // grows in, softens out
    const at = i * step + (i === 0 ? 0.04 : 0);
    notes.push({ at, f: KURD[idx], vel: (ghost ? 0.18 : 0.42 * accent) * swell });
    if (!ghost && r() < 0.18 && idx >= 2) notes.push({ at: at + 0.012, f: KURD[idx - 2], vel: 0.22 * swell, under: true });
  }
  return notes;
}

// ---------- synthesis ----------

function curve(from, to, n = 48) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = from + (to - from) * ease(i / (n - 1));
  return c;
}
function glide(param, from, to, t, dur) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(from, t);
  if (dur > 0.05 && from !== to) param.setValueCurveAtTime(curve(from, to), t, dur);
  else param.setValueAtTime(to, t);
}
// Run `play(at)` for each offset at >= from (the part of a phase that hasn't happened yet).
function each(list, from, fn) { for (const x of list) if (x.at >= from - 1e-6) fn(x); }
// Notes spread evenly over a phase, the last one landing just before the next phase.
const spread = (notes, dur) => notes.map((f, i) => ({ f, at: (i * dur) / notes.length, step: dur / notes.length }));

const SCALE = [62, 64, 66, 69, 71, 74, 76].map(midi);              // D major pentatonic

function noiseBuffer(ctx, secs, brown) {
  const len = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  let v = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { v = (v + 0.02 * w) / 1.02; d[i] = v * 3.2; } else d[i] = w;
  }
  return b;
}

// One struck handpan note: fundamental, a detuned twin (slow shimmer), octave and compound
// fifth with their own decays, plus a soft noise tap on the attack.
function handpanNote(ctx, out, f, t, vel, tap) {
  const g = ctx.createGain(); g.gain.value = vel; g.connect(out);
  for (const [ratio, amp, decay] of [[1, 1, 3.6], [1.0015, 0.5, 3.6], [2, 0.42, 1.9], [3, 0.16, 1.1]]) {
    const o = ctx.createOscillator(), a = ctx.createGain();
    o.frequency.value = f * ratio;
    a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(amp, t + 0.005);
    a.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(a).connect(g); o.start(t); o.stop(t + decay + 0.05);
  }
  const n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
  n.buffer = tap; nf.type = 'bandpass'; nf.frequency.value = f * 4; nf.Q.value = 1.5;
  ng.gain.setValueAtTime(0.25, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  n.connect(nf).connect(ng).connect(g); n.start(t); n.stop(t + 0.06);
}

function bell(ctx, out, f, t, len, vol) {
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), g2 = ctx.createGain();
  o.frequency.value = f; o2.frequency.value = f * 2.01; g2.gain.value = 0.18;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g); o2.connect(g2).connect(g); g.connect(out);
  o.start(t); o2.start(t); o.stop(t + len + 0.05); o2.stop(t + len + 0.05);
}

// Each builder: (ctx, out) -> { phase(type, t, dur, l0, l1, voice, from), stop(t) }.
// t is the phase's start on the audio clock (in the past when joining mid-phase); only the
// part from `from` seconds on is scheduled.
const BUILDERS = {
  handpan: handpanBuilder(0.34),
  'handpan-calm': handpanBuilder(0.72),

  notes(ctx, out) {
    const bus = ctx.createGain(); bus.connect(out);
    const drone = ctx.createOscillator(); drone.frequency.value = midi(38);
    const dg = ctx.createGain(); dg.gain.value = 0.1; drone.connect(dg).connect(bus); drone.start();
    let last = SCALE[0], held = null;
    return {
      phase(type, t, dur, l0, l1, voice, from) {
        if (held) { held.g.gain.setTargetAtTime(0.0001, t + from, 0.15); held.o.stop(t + from + 1); held = null; }
        if (type === 'hold') {
          if (voice === 'keep') {
            const o = ctx.createOscillator(), g = ctx.createGain(), s = t + from;
            o.frequency.value = last;
            g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.08, s + 0.4);
            o.connect(g).connect(bus); o.start(s); held = { o, g };
          }
          return;
        }
        const notes = type === 'in' ? SCALE : [...SCALE].reverse();
        each(spread(notes, dur), from, (n) => bell(ctx, bus, n.f, t + n.at, Math.max(1.2, n.step * 2.2), 0.16));
        last = notes[notes.length - 1];
      },
      stop(t) { drone.stop(t + 1.5); held?.o.stop(t + 1.5); },
    };
  },

  kalimba(ctx, out) {
    const body = ctx.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 3200; body.connect(out);
    const cache = new Map();
    // Karplus-Strong pluck, rendered once per pitch.
    function pluckBuffer(f) {
      if (cache.has(f)) return cache.get(f);
      const sr = ctx.sampleRate, len = Math.floor(sr * 2.2), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      const p = Math.round(sr / f), line = new Float32Array(p), r = seeded(Math.round(f));
      for (let i = 0; i < p; i++) line[i] = r() * 2 - 1;
      for (let i = 0, j = 0; i < len; i++, j = (j + 1) % p) {
        d[i] = line[j];
        line[j] = 0.996 * 0.5 * (line[j] + line[(j + 1) % p]);
      }
      cache.set(f, buf);
      return buf;
    }
    const notes = [62, 64, 66, 69, 71, 74].map(midi);
    return {
      phase(type, t, dur, l0, l1, voice, from) {
        if (type === 'hold') return;
        each(spread(type === 'in' ? notes : [...notes].reverse(), dur), from, (n) => {
          const s = ctx.createBufferSource(), g = ctx.createGain();
          s.buffer = pluckBuffer(n.f); g.gain.value = 0.32;
          s.connect(g).connect(body); s.start(t + n.at);
        });
      },
      stop() {},
    };
  },

  piano(ctx, out) {
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2400; tone.connect(out);
    // two-operator FM: a short bright attack that mellows into a round tone
    function key(f, t, vol) {
      const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
      car.frequency.value = f; mod.frequency.value = f;
      mg.gain.setValueAtTime(f * 1.4, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.9);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      mod.connect(mg).connect(car.frequency); car.connect(g).connect(tone);
      car.start(t); mod.start(t); car.stop(t + 3.1); mod.stop(t + 3.1);
    }
    const chord = [50, 57, 62, 66, 69, 74].map(midi);
    return {
      phase(type, t, dur, l0, l1, voice, from) {
        if (type === 'hold') return;
        each(spread(type === 'in' ? chord : [...chord].reverse(), dur), from, (n) => key(n.f, t + n.at, 0.14));
      },
      stop() {},
    };
  },

  flute(ctx, out) {
    const lo = midi(62), hi = midi(69);
    const o = ctx.createOscillator(); o.frequency.value = lo;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = lo * 2;
    const o2g = ctx.createGain(); o2g.gain.value = 0.08;
    const vib = ctx.createOscillator(); vib.frequency.value = 4.8;
    const vibg = ctx.createGain(); vibg.gain.value = 2.2;
    vib.connect(vibg); vibg.connect(o.frequency); vibg.connect(o2.frequency);
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuffer(ctx, 2, false); ns.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = lo * 2; nf.Q.value = 6;
    const ng = ctx.createGain(); ng.gain.value = 0.05;
    const amp = ctx.createGain(); amp.gain.value = 0;
    o.connect(amp); o2.connect(o2g).connect(amp); ns.connect(nf).connect(ng).connect(amp); amp.connect(out);
    for (const x of [o, o2, vib, ns]) x.start();
    const at = (l) => ({ f: lo * Math.pow(hi / lo, l), v: 0.16 + 0.1 * l });
    let vol = 0;
    return {
      phase(type, t, dur, l0, l1, voice, from) {
        const s = t + from, rest = dur - from;
        if (type === 'hold') {
          const target = voice === 'keep' ? vol * 0.6 : 0;
          amp.gain.cancelScheduledValues(s); amp.gain.setValueAtTime(vol, s);
          amp.gain.linearRampToValueAtTime(target, s + Math.min(1.6, rest * 0.6));
          vol = target;
          return;
        }
        const lNow = l0 + (l1 - l0) * ease(from / dur), a = at(lNow), b = at(l1);
        for (const [p, m] of [[o.frequency, 1], [o2.frequency, 2], [nf.frequency, 2]]) glide(p, a.f * m, b.f * m, s, rest);
        amp.gain.cancelScheduledValues(s); amp.gain.setValueAtTime(vol, s);
        amp.gain.linearRampToValueAtTime(a.v, s + Math.min(0.35, rest * 0.2));
        amp.gain.linearRampToValueAtTime(b.v, s + rest);
        vol = b.v;
      },
      stop(t) { for (const x of [o, o2, vib, ns]) x.stop(t + 1.5); },
    };
  },

  waves(ctx, out) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 4, true); src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(lp).connect(g).connect(out); src.start();
    const at = (l) => ({ f: 250 + 1300 * l, g: 0.02 + 0.3 * l * l });
    let vol = 0.02;
    return {
      phase(type, t, dur, l0, l1, voice, from) {
        const s = t + from, rest = dur - from;
        if (type === 'hold') {
          const target = voice === 'keep' ? vol * 0.7 : 0.01;
          g.gain.cancelScheduledValues(s); g.gain.setValueAtTime(vol, s);
          g.gain.linearRampToValueAtTime(target, s + Math.min(1.8, rest * 0.6));
          vol = target;
          return;
        }
        const lNow = l0 + (l1 - l0) * ease(from / dur), a = at(lNow), b = at(l1);
        glide(lp.frequency, a.f, b.f, s, rest);
        glide(g.gain, vol, b.g, s, rest);
        vol = b.g;
      },
      stop(t) { src.stop(t + 1.5); },
    };
  },
};

function handpanBuilder(density) {
  return (ctx, out) => {
    const tap = noiseBuffer(ctx, 0.1, false);
    return {
      phase(type, t, dur, l0, l1, voice, from) {
        if (type === 'hold') {
          // "keep": a soft ding every two seconds; otherwise the notes simply ring out
          if (voice === 'keep') {
            for (let s = 0; s < dur - 0.5; s += 2) if (s >= from) handpanNote(ctx, out, DING, t + s, 0.28, tap);
          }
          return;
        }
        each(phrase(type, dur, density), from, (n) => handpanNote(ctx, out, n.f, t + n.at, n.vel, tap));
      },
      stop() {},
    };
  };
}

// ---------- hold styles: quiet, pitch-neutral additions on top of the sound ----------

function tick(ctx, out, t, f, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.25);
}
function holdExtras(mode, ctx, out, t, dur, from, seed) {
  const events = [];
  if (mode === 'pulse') {
    for (let s = 1; s < dur - 0.3; s++) events.push({ at: s, play: (x) => tick(ctx, out, x, 150, 0.18) });
  } else if (mode === 'countdown') {
    for (const s of [3, 2, 1]) if (dur - s > 0.4) events.push({ at: dur - s, play: (x) => tick(ctx, out, x, 200, s === 1 ? 0.24 : 0.17) });
  } else if (mode === 'chimes') {
    const r = seeded(seed), HIGH = [86, 88, 90, 93, 95].map(midi);
    const n = Math.max(1, Math.round(dur / 2.2));
    for (let i = 0; i < n; i++) {
      const at = 0.5 + ((i + r() * 0.6) * (dur - 1)) / n, f = HIGH[Math.floor(r() * HIGH.length)];
      events.push({ at, play: (x) => bell(ctx, out, f, x, 2.4, 0.05) });
    }
  }
  each(events, from, (e) => e.play(t + e.at));
}

// Reverb tail: stereo decaying noise that darkens as it fades, after a short pre-delay.
function roomImpulse(ctx, secs) {
  const sr = ctx.sampleRate, len = Math.floor(sr * secs), pre = Math.floor(sr * 0.022);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const k = (i - pre) / (len - pre);
      lp += (1 - (0.15 + 0.8 * k)) * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - k, 2.4);
    }
  }
  return buf;
}

// ---------- player ----------

// What the player should do, given the music setting and the timer:
//   on        music switched on          paused      timer paused (manual, hidden, locked)
//   playing   the player has a sound     musicPaused the player is faded out
//   keyChanged sound, hold style or pattern differs from what is playing
// Never 'start' while the timer is paused (no burst of sound); a changed sound is dropped
// instead, so resuming starts the new one.
export function musicStep({ on, paused, playing, musicPaused, keyChanged }) {
  if (!on) return 'stop';
  if (paused) return !playing ? 'none' : keyChanged ? 'stop' : 'pause';
  return !playing || musicPaused || keyChanged ? 'start' : 'none';
}

export function createMusic() {
  const LOOKAHEAD = 1.5;
  let ctx = null, master = null, dry = null, wet = null;
  let opts = { sound: 'handpan', hold: 'ring', volume: 0.55, room: 0.5 };
  let voice = null, bus = null, timer = 0;
  let timeline = [], nextIdx = 0, scheduledUntil = 0;
  let base = 0, ctx0 = 0, paused = false, pauseTimer = 0;

  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0;
    dry = ctx.createGain(); wet = ctx.createGain();
    const verb = ctx.createConvolver(); verb.buffer = roomImpulse(ctx, 3.2);
    master.connect(dry).connect(ctx.destination);
    master.connect(verb).connect(wet).connect(ctx.destination);
    applyLevels();
  }
  const gainFor = (v) => Math.pow(Math.min(1, Math.max(0, v)), 1.6) * 0.9;   // perceptual-ish
  function applyLevels() {
    if (!ctx) return;
    const now = ctx.currentTime;
    if (voice && !paused) master.gain.setTargetAtTime(gainFor(opts.volume), now, 0.08);
    wet.gain.setTargetAtTime(opts.room * 1.1, now, 0.05);
    dry.gain.setTargetAtTime(1 - opts.room * 0.35, now, 0.05);
  }

  function schedule() {
    if (!voice || paused) return;
    const hold = HOLDS.find((h) => h.id === opts.hold) || HOLDS[0];
    while (scheduledUntil < ctx.currentTime + LOOKAHEAD) {
      const p = timeline[nextIdx];
      voice.phase(p.type, scheduledUntil, p.sec, p.l0, p.l1, hold.voice, 0);
      if (p.type === 'hold') holdExtras(hold.id, ctx, bus, scheduledUntil, p.sec, 0, nextIdx + 1);
      scheduledUntil += p.sec;
      nextIdx = (nextIdx + 1) % timeline.length;
    }
  }

  function teardown(fade = 0.3) {
    clearInterval(timer);
    if (!voice) return;
    const now = ctx.currentTime, old = voice, oldBus = bus;
    oldBus.gain.cancelScheduledValues(now);
    oldBus.gain.setTargetAtTime(0, now, fade / 3);
    old.stop(now + fade + 0.2);
    setTimeout(() => oldBus.disconnect(), (fade + 4) * 1000);   // let ringing notes finish
    voice = null; bus = null;
  }

  return {
    get playing() { return !!voice; },
    get paused() { return paused; },
    // The bubble may animate from this clock. Not while paused (the fade-out still runs, but
    // the bubble freezes at once), and not before the first click when autoplay rules keep a
    // started player suspended.
    get running() { return !!voice && !paused && ctx.state === 'running'; },
    setOptions(o) { opts = { ...opts, ...o }; applyLevels(); },

    // Start (or restart) with these engine phases, joining at breathT seconds into the pattern.
    start(phases, breathT) {
      ensure();
      teardown(0.25);
      timeline = toTimeline(phases);
      if (!timeline.length) return;
      paused = false;
      clearTimeout(pauseTimer);
      ctx.resume();
      const now = ctx.currentTime + 0.05;
      base = breathT; ctx0 = now;
      bus = ctx.createGain(); bus.connect(master);
      voice = (BUILDERS[opts.sound] || BUILDERS.handpan)(ctx, bus);
      const hold = HOLDS.find((h) => h.id === opts.hold) || HOLDS[0];
      // The phase we're in right now: schedule only what's left of it.
      const { idx, offset } = locate(timeline, breathT);
      const p = timeline[idx], phaseStart = now - offset;
      voice.phase(p.type, phaseStart, p.sec, p.l0, p.l1, hold.voice, offset);
      if (p.type === 'hold') holdExtras(hold.id, ctx, bus, phaseStart, p.sec, offset, idx + 1);
      scheduledUntil = phaseStart + p.sec;
      nextIdx = (idx + 1) % timeline.length;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(gainFor(opts.volume), now, 0.15);
      schedule();
      timer = setInterval(schedule, 100);
    },

    stop() {
      if (!ctx) return;
      teardown(0.4);
      paused = false;
    },

    // Fade out, then suspend the audio. There is no resume: the caller start()s again at the
    // bubble's breath time, so picture and sound pick up exactly in step.
    pause() {
      if (!voice || paused) return;
      paused = true;
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      pauseTimer = setTimeout(() => ctx.suspend(), 450);
    },

    // Seconds into the pattern on the audio clock (frozen while paused/suspended).
    breathTime() { return base + (ctx.currentTime - ctx0); },

  };
}
