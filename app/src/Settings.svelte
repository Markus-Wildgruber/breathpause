<script>
  import { onMount } from "svelte";
  import Timefmt from "./core/timefmt.js";
  import {
    DEFAULT_SETTINGS,
    loadSettings,
    saveSettings,
    newSkinId,
    applyBubbleChanges,
  } from "./lib/settings-store.js";
  import {
    loadSkinById,
    mountSkin,
    scanColors,
    isNeutral,
    parseSkinImport,
    skinChoices,
  } from "./lib/skin.js";
  import Stepper from "./lib/Stepper.svelte";
  import {
    BUBBLE_RANGE,
    SIZE_RANGE,
    LINE_PARTS,
    lineOffsetRange,
    setSkinColor,
    setLineColor,
    parseHex,
    baseTextColor,
  } from "./lib/appearance-edit.js";
  import Pattern from "./core/pattern.js";
  import { releaseUrl } from "./lib/updates.js";
  import { SOUNDS, HOLDS, createMusic } from "./lib/music.js";

  const inTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  const saved = loadSettings();
  let s = $state(saved);

  async function emitEvent(name, payload) {
    if (!inTauri) return;
    const { emit } = await import("@tauri-apps/api/event");
    await emit(name, payload);
  }
  // Saved theme wins; OS theme is the fallback
  const osTheme = matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  let theme = $state(s.theme || osTheme);
  let version = $state("0.1.0");
  if (inTauri) {
    import("@tauri-apps/api/app").then(({ getVersion }) =>
      getVersion().then((v) => (version = v)),
    );
  }
  // ?pane=<id> (from the --pane launch arg / deep links) picks the initial pane.
  const paneParam = new URLSearchParams(location.search).get("pane");
  let pane = $state(
    ["appearance", "patterns", "timers", "skins", "behavior", "about"].includes(paneParam)
      ? paneParam
      : "appearance",
  );
  let mode = $state("work");
  let ap = $derived(s.appearance[mode]);

  // "Listen" in Behavior > Breathing music: plays the work pattern with the chosen sound here,
  // following the controls while it plays (volume/room live, sound/hold by restarting).
  const preview = createMusic();
  let previewing = $state(false);
  let previewKey = "";
  function startPreview() {
    previewKey = `${s.music.sound}|${s.music.hold}`;
    preview.start(Pattern.toEnginePattern(s, "work").phases, 0);
  }
  function togglePreview() {
    previewing = !previewing;
    if (previewing) startPreview();
    else preview.stop();
  }
  $effect(() => {
    const m = s.music;
    preview.setOptions({ sound: m.sound, hold: m.hold, volume: m.volume, room: m.room });
    if (previewing && `${m.sound}|${m.hold}` !== previewKey) startPreview();
  });
  $effect(() => {
    if ((pane !== "behavior" || bhSub !== "sound") && previewing) { preview.stop(); previewing = false; }
  });

  const HOTKEY_ROWS = [
    { id: "startStop", label: "Start / Stop timer" },
    { id: "pauseResume", label: "Pause / Resume" },
    { id: "skip", label: "Skip" },
    { id: "settings", label: "Open settings" },
    { id: "hide", label: "Hide / show bubble" },
  ];

  // Fill a hotkey field from an actual keypress — no free text, nothing to mistype.
  // Stored in the plugin's accelerator format ("Ctrl+Alt+Shift+P").
  function recordHotkey(e, id) {
    if (e.key === "Tab") return; // keep keyboard navigation working
    e.preventDefault();
    if (/^(Control|Alt|Shift|Meta)/.test(e.code)) return; // modifier alone: keep waiting
    if (!e.ctrlKey && !e.altKey && !e.metaKey) return; // require a real modifier
    const mods = [];
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (e.metaKey) mods.push("Super");
    const key = e.code.replace(/^Key/, "").replace(/^Digit/, "");
    s.hotkeys[id] = [...mods, key].join("+");
  }
  let apSub = $state("skin");
  const AP_TABS = [
    { id: "skin", label: "Bubble" },
    { id: "text", label: "Text" },
    { id: "position", label: "Position" },
  ];
  let showCredits = $state(false);

  // About > update card. state: idle | checking | none | available | downloading | failed | error
  let upd = $state({ state: "idle" });
  let updKind = $state("installed"); // 'standalone' gets a Download link instead of installing
  let updObj = null;
  async function checkUpdates() {
    upd = { state: "checking" };
    try {
      const { findUpdate, installKind } = await import("./lib/updates.js");
      const [u, kind] = await Promise.all([findUpdate(), installKind()]);
      updObj = u;
      updKind = kind;
      upd = u ? { state: "available", version: u.version } : { state: "none" };
    } catch (e) {
      console.warn("update check failed:", e);
      upd = { state: "error" };
    }
  }
  async function startInstall() {
    const version = upd.version;
    upd = { state: "downloading", version, pct: null };
    try {
      const { installUpdate } = await import("./lib/updates.js");
      await installUpdate(updObj, (pct) => (upd.pct = pct));
    } catch (e) {
      console.warn("update install failed:", e);
      upd = { state: "failed", version };
    }
  }
  // Opening About checks once per window (the bubble does the daily check).
  $effect(() => {
    if (inTauri && pane === "about" && upd.state === "idle") checkUpdates();
  });

  const BH_TABS = [
    { id: "general", label: "General" },
    { id: "sound", label: "Sound" },
    { id: "hotkeys", label: "Hotkeys" },
  ];
  let bhSub = $state("general");

  // Timers quick start: minutes in, seconds stored (what the steppers below edit).
  const timerPreset = (name, work, brk, long, every) => ({
    name,
    t: { workSeconds: work * 60, breakSeconds: brk * 60, longBreakSeconds: long * 60, longBreakEvery: every },
  });
  const TIMER_PRESETS = [
    timerPreset("Classic 25 / 5", 25, 5, 15, 4),
    timerPreset("Deep focus 50 / 10", 50, 10, 30, 2),
    timerPreset("Short 15 / 3", 15, 3, 10, 4),
  ];
  // "Custom" is on when picked, or as soon as the durations match none of the presets.
  let customPicked = $state(false);
  let timerPreset$ = $derived(
    customPicked
      ? null
      : TIMER_PRESETS.find((p) => Object.keys(p.t).every((k) => s.timers[k] === p.t[k])),
  );

  // About > Artwork credits (short form of CREDITS.md).
  const CREDITS = [
    { id: "cute-bear", name: "Cute Bear", text: "Bear artwork from", source: "SVG Repo", url: "https://www.svgrepo.com", license: "SVG Repo License" },
    { id: "sweet-jelly", name: "Sweet Jelly", text: "Jellyfish artwork from", source: "SVG Repo", url: "https://www.svgrepo.com", license: "SVG Repo License" },
    { id: "sleepy-seal", name: "Sleepy Seal", text: "Derived from public-domain art on", source: "openclipart", url: "https://openclipart.org", license: "CC0 / Public Domain" },
    { id: "orb", name: "Classic Orb", text: "Original work by Markus Wildgruber", license: "MIT" },
  ];

  // Searchable font picker
  const FONTS = [
    "Segoe UI Variable",
    "Segoe UI",
    "Calibri",
    "Arial",
    "Verdana",
    "Tahoma",
    "Trebuchet MS",
    "Georgia",
    "Times New Roman",
    "Cambria",
    "Constantia",
    "Corbel",
    "Candara",
    "Consolas",
    "Courier New",
    "Lucida Sans",
    "Lucida Console",
    "Palatino Linotype",
    "Franklin Gothic",
    "Century Gothic",
    "Comic Sans MS",
    "Impact",
    "Ebrima",
    "Bahnschrift",
    "Sitka Text",
    "Ink Free",
    "system-ui",
  ];
  let fontOpen = $state(false);
  let fontSearch = $state("");
  let fontMatches = $derived(
    FONTS.filter((f) =>
      f.toLowerCase().includes(fontSearch.toLowerCase()),
    ).sort((a, b) => a.localeCompare(b)),
  );

  const NAV = [
    { id: "appearance", label: "Appearance" },
    { id: "patterns", label: "Patterns" },
    { id: "timers", label: "Timers" },
    { id: "skins", label: "Skins" },
    { id: "behavior", label: "Behavior" },
    { id: "about", label: "About" },
  ];

  let allSkins = $derived(skinChoices(s.customSkins));

  // Duration <Stepper> formatters. 'work' is hh:mm (a bare number is minutes); 'break'/'long'
  // are mm:ss (a bare number is seconds — so typing 90 becomes 1:30). Values are raw seconds.
  const isMMSS = (kind) => kind !== "work";
  function parseDuration(str, kind) {
    const t = (str || "").trim();
    if (t === "") return null;
    if (t.includes(":"))
      return isMMSS(kind)
        ? Timefmt.parseBreakSeconds(t)
        : Timefmt.parseWorkSeconds(t);
    const n = parseInt(t, 10);
    if (!Number.isFinite(n)) return null;
    return isMMSS(kind) ? n : n * 60; // bare number: seconds (mm:ss) / minutes (hh:mm)
  }
  function fmtDuration(sec, kind) {
    return isMMSS(kind)
      ? Timefmt.pad2(Math.floor(sec / 60)) + ":" + Timefmt.pad2(sec % 60)
      : Timefmt.pad2(Math.floor(sec / 3600)) +
          ":" +
          Timefmt.pad2(Math.floor((sec % 3600) / 60));
  }

  // ---- pattern helpers ----
  function phaseSummary(phases) {
    return phases.map((p) => `${p.seconds}s ${p.type}`).join(" → ");
  }

  async function openPatternEditorFor(p) {
    localStorage.setItem(
      "breathpause.patternDraft",
      JSON.stringify({
        pattern: $state.snapshot(p),
        isNew: false,
        existingNames: s.patterns
          .filter((x) => x.id !== p.id)
          .map((x) => x.name),
      }),
    );
    await emitEvent("open-pattern-editor");
  }

  async function openNewPatternWindow() {
    // A unique default name so the duplicate-name guard never blocks the first save.
    const names = new Set(s.patterns.map((x) => x.name));
    let name = "new-pattern";
    for (let n = 2; names.has(name); n++) name = `new-pattern ${n}`;
    localStorage.setItem(
      "breathpause.patternDraft",
      JSON.stringify({
        pattern: {
          id: "p" + Date.now(),
          name,
          phases: [{ type: "in", seconds: 4 }],
        },
        isNew: true,
        existingNames: [...names],
      }),
    );
    await emitEvent("open-pattern-editor");
  }

  // Delete a pattern (never the last one); re-point any work/break selection, persist now.
  function deletePattern(id) {
    if (s.patterns.length <= 1) return;
    s.patterns = s.patterns.filter((p) => p.id !== id);
    if (s.timers.workPattern === id) s.timers.workPattern = s.patterns[0]?.id ?? "";
    if (s.timers.breakPattern === id) s.timers.breakPattern = s.patterns[0]?.id ?? "";
    saveSettings($state.snapshot(s));
    emitEvent("settings-changed");
  }

  // ---- skin import ----
  let importTrigger = $state(null);
  let importError = $state("");

  // Import a skin: either a bare SVG (recolor only, sensible defaults — dominant color as
  // the recolor anchor, whole-body tint when that anchor is a grey) or a zipped skin
  // folder (skin.json + SVG) that brings its own animation bindings. See SKINS.md.
  async function onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    importError = "";
    if (!s.customSkins) s.customSkins = [];
    try {
      if (/\.zip$/i.test(file.name)) {
        const { unzipSync, strFromU8 } = await import("fflate");
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
        const names = Object.keys(entries);
        const manifestName = names.find((n) => /(^|\/)skin\.json$/i.test(n));
        if (!manifestName) throw new Error("zip contains no skin.json");
        const manifestText = strFromU8(entries[manifestName]);
        // the SVG named by the manifest, next to skin.json (fall back to any .svg)
        let svgFile = "skin.svg";
        try {
          svgFile = JSON.parse(manifestText).svg || "skin.svg";
        } catch {}
        const dir = manifestName.replace(/skin\.json$/i, "");
        const svgName =
          names.find((n) => n === dir + svgFile) ||
          names.find((n) => /\.svg$/i.test(n));
        if (!svgName) throw new Error("zip contains no SVG file");
        const parsed = parseSkinImport(manifestText, strFromU8(entries[svgName]));
        s.customSkins.push({ id: newSkinId(), ...parsed });
      } else {
        const svgText = await file.text();
        const themeColor =
          scanColors(svgText, { includeNeutrals: true })[0] || null;
        s.customSkins.push({
          id: newSkinId(),
          name: file.name.replace(/\.svg$/i, "") || "Imported skin",
          svgText,
          themeColor,
          tintNeutrals: !!themeColor && isNeutral(themeColor),
        });
      }
    } catch (err) {
      importError = `Import failed: ${err.message}`;
    }
    e.target.value = "";
  }

  // Rename a custom skin in place (click its name in the gallery).
  function renameSkin(id, name) {
    const cs = s.customSkins.find((c) => c.id === id);
    if (cs) cs.name = name.trim() || cs.name;
  }

  function deleteCustomSkin(id) {
    s.customSkins = s.customSkins.filter((cs) => cs.id !== id);
    if (s.appearance.work.skin === id) s.appearance.work.skin = "orb";
    if (s.appearance.break.skin === id) s.appearance.break.skin = "orb";
  }

  // Svelte action: animated skin preview. opts can be a skinId string or { skinId, fill }.
  // When fill is provided, mountSkin hue-shifts the skin from its themeColor anchor.
  function previewSkin(el, opts) {
    let skinId = typeof opts === "string" ? opts : opts.skinId;
    let fill = typeof opts === "string" ? null : opts.fill;
    let runId = 0,
      raf = null;

    async function load() {
      const myRun = ++runId;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      try {
        const skin = await loadSkinById(skinId, s.customSkins);
        if (myRun !== runId || !el.isConnected) return;
        const mounted = mountSkin(el, skin, fill ? { fill } : {});
        let t = 0,
          last = performance.now();
        function loop(now) {
          if (myRun !== runId) return;
          t += (now - last) / 1000;
          last = now;
          mounted.apply({
            breath: Math.sin(t * 0.7) * 0.5 + 0.5,
            time: Math.sin(t),
          });
          raf = requestAnimationFrame(loop);
        }
        raf = requestAnimationFrame(loop);
      } catch (e) {
        console.warn("skin preview failed:", skinId, e);
      }
    }

    load();
    return {
      update(newOpts) {
        const nId = typeof newOpts === "string" ? newOpts : newOpts.skinId;
        const nFill = typeof newOpts === "string" ? null : newOpts.fill;
        if (nId !== skinId || nFill !== fill) {
          skinId = nId;
          fill = nFill;
          load();
        }
      },
      destroy() {
        runId++;
        if (raf) cancelAnimationFrame(raf);
      },
    };
  }

  // ---- appearance preview ----
  let previewBox = $state();
  let previewMounted = null;
  let apTheme = $state("#888888"); // current skin's authored anchor, for the swatch baseline
  let apSkin = $state(null); // current skin, for its own text color

  // A text line's color as the bubble shows it: its own, else the shared default.
  const lineFont = (line) => ap[line + "Font"] || ap.font;
  let apLine = $state("label"); // Text tab: 'label' = top line, 'sub' = bottom line
  const lineColor = (line) => ap[line + "Color"] || baseTextColor(ap, apSkin);

  $effect(() => {
    const name = ap.skin || "orb";
    const fill = s.skinColors[name];
    if (!previewBox) return;
    let cancelled = false;
    (async () => {
      let skin;
      try {
        skin = await loadSkinById(name, s.customSkins);
      } catch {
        skin = await loadSkinById("orb", []);
      }
      if (!cancelled && previewBox) {
        apTheme = skin.manifest.themeColor || "#888888";
        apSkin = skin;
        previewMounted = mountSkin(previewBox, skin, fill ? { fill } : {});
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  // Live update (on by default): everything the bubble can change too — appearance, skin colors,
  // skins, music — is saved and shown in the bubble right away. The rest waits for Save.
  // Cancel puts back what was saved when the window opened.
  const livePart = (x) =>
    JSON.stringify({
      appearance: x.appearance,
      skinColors: x.skinColors,
      customSkins: x.customSkins,
      music: x.music,
    });
  // Whether the bubble needs a push: the same parts, but imported skins only by id and name
  // (their SVG text never changes after import), so a slider tick doesn't re-serialize every SVG.
  const liveKey = (x) =>
    JSON.stringify({
      appearance: x.appearance,
      skinColors: x.skinColors,
      music: x.music,
      skins: (x.customSkins || []).map((c) => [c.id, c.name]),
    });
  let live = $state(true);
  let liveBase = livePart(saved),
    livePushed = liveBase, // what was last saved for the bubble (Cancel compares against it)
    pushedKey = liveKey(saved); // liveKey of what the bubble has; "" forces the next push
  const saveLive = (json) => saveSettings({ ...loadSettings(), ...JSON.parse(json) });
  async function pushAppearance(json) {
    saveLive(json);
    livePushed = json;
    await emitEvent("appearance-live");
  }
  // The other direction: a change made in the bubble's edit mode (or a drag) while Live update
  // is on. Saved here, but not sent back: the bubble already shows it. A drag sends many in a
  // row, so the save waits until they stop.
  let bubbleSave = null;
  function liveFromBubble({ payload }) {
    if (!live || !payload) return;
    applyBubbleChanges(s, payload);
    pushedKey = liveKey(s);
    clearTimeout(bubbleSave);
    bubbleSave = setTimeout(() => {
      livePushed = livePart(s);
      saveLive(livePushed);
    }, 300);
  }
  function toggleLive() {
    live = !live;
    if (live) pushedKey = ""; // switched on: send the current values over
  }
  $effect(() => {
    if (!live) return;
    const key = liveKey(s);
    if (key === pushedKey) return;
    // one push per burst of slider ticks
    const timer = setTimeout(() => {
      if (!live) return;
      pushedKey = key;
      pushAppearance(livePart(s));
    }, 80);
    return () => clearTimeout(timer);
  });

  // Cancel, the title bar's X and Quit: put back what was saved before the live changes.
  // shortcut: Quit from the tray menu skips this and keeps the live changes; upgrade by having
  // Rust close this window before it exits.
  async function undoLive() {
    live = false;
    clearTimeout(bubbleSave); // a pending bubble save must not land after the undo
    if (liveBase && liveBase !== livePushed) await pushAppearance(liveBase);
  }

  async function close() {
    await undoLive();
    if (!inTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }

  async function onSave() {
    live = false; // closing: nothing more goes to or comes from the bubble's edit mode
    const snap = $state.snapshot(s);
    saveSettings(snap);
    liveBase = null; // saved: nothing for close() to undo
    await emitEvent("settings-changed");
    await emitEvent("apply-tray-text", snap.text.tray);
    await close();
  }

  // Imported skins are the user's files, not settings: Reset keeps them. (With Live update on,
  // Reset is saved at once, so dropping them here would lose them even without Save.)
  function onReset() {
    s = { ...structuredClone(DEFAULT_SETTINGS), customSkins: s.customSkins };
    theme = s.theme || osTheme;
  }

  async function openExternal(url) {
    if (inTauri) {
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
        return;
      } catch (e) {
        console.warn("openUrl failed, falling back:", e);
      }
    }
    window.open(url, "_blank", "noopener");
  }

  async function onExit() {
    await undoLive();
    await emitEvent("app-quit");
  }

  // A typed hex color is taken once complete (Enter / leaving the field); empty = the default.
  // The color already shown is never taken: it would turn the skin's own color (or the default
  // text color) into a custom one.
  function typedColor(e, set, shown) {
    const text = e.target.value.trim(),
      c = parseHex(text);
    if ((c || !text) && c !== parseHex(shown())) set(c || "");
    e.target.value = shown(); // also puts the current color back after a mistyped one
  }
  // While typing: only a full 6-digit code, so the field is not rewritten under the cursor
  // (Enter / leaving the field still takes 3-digit codes via typedColor).
  const fullHex = (e, shown) => {
    const c = /^#?[0-9a-f]{6}$/i.test(e.target.value.trim()) ? parseHex(e.target.value) : null;
    return c !== parseHex(shown) ? c : null;
  };

  onMount(() => {
    document.body.classList.add("settings-body");
    let t = 0,
      last = performance.now(),
      raf;
    function loop(now) {
      t += (now - last) / 1000;
      last = now;
      previewMounted?.apply({
        breath: Math.sin(t * 0.7) * 0.5 + 0.5,
        time: Math.sin(t),
      });
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    let unlisten = null;
    let unlistenBubble = null;
    let unlistenEdit = null;
    let unlistenMove = null;
    let unlistenClose = null;
    let unlistenPane = null;
    if (inTauri) {
      (async () => {
        const { restoreWindowPosition, trackWindowPosition } = await import(
          "./lib/window-state.js"
        );
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        await restoreWindowPosition("settings", win);
        await win.show(); // built hidden in Rust; reveal only after positioning (no flash)
        await win.setFocus();
        unlistenMove = await trackWindowPosition("settings", win);
        unlistenClose = await win.onCloseRequested(undoLive); // title bar X = Cancel

        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("pattern-editor-saved", refreshPatterns);
        // The tray's "Update to …" item, while this window is already open.
        unlistenPane = await listen("show-pane", ({ payload }) => {
          if (NAV.some((n) => n.id === payload)) pane = payload;
        });
        unlistenBubble = await listen("bubble-settings-saved", refreshBubbleEdits);
        unlistenEdit = await listen("bubble-edit-live", liveFromBubble);
        // Now listening: a bubble already in edit mode sends its unsaved edits, so this window's
        // first live push doesn't overwrite them with the stored values.
        await emitEvent("settings-opened");
      })();
    }

    // Belt-and-suspenders: re-read patterns whenever the window regains focus (e.g. after
    // the pattern editor closes), so the gallery is never stale even if the event is missed.
    window.addEventListener("focus", refreshPatterns);

    return () => {
      cancelAnimationFrame(raf);
      unlisten?.();
      unlistenBubble?.();
      unlistenEdit?.();
      unlistenMove?.();
      unlistenClose?.();
      unlistenPane?.();
      window.removeEventListener("focus", refreshPatterns);
      preview.dispose();           // a running "Listen" must not outlive this view
    };
  });

  // Re-read the (editor-owned) patterns from storage; reassign for a clean keyed re-render.
  // Only re-point a work/break selection if it now points at a deleted pattern.
  function refreshPatterns() {
    const fresh = loadSettings();
    s.patterns = fresh.patterns;
    const ids = new Set(fresh.patterns.map((p) => p.id));
    if (!ids.has(s.timers.workPattern)) s.timers.workPattern = fresh.timers.workPattern;
    if (!ids.has(s.timers.breakPattern)) s.timers.breakPattern = fresh.timers.breakPattern;
  }

  // The bubble saved some of its settings (edit mode, dialog choices, music): take over exactly
  // the values it changed, so saving this window later doesn't write old values back, while
  // anything changed here and not yet saved stays as it is.
  function refreshBubbleEdits({ payload }) {
    if (!payload) return;
    applyBubbleChanges(s, payload);
    if (live) {
      // the bubble saved it itself: nothing to send back
      livePushed = livePart(s);
      pushedKey = liveKey(s);
    }
    if (liveBase) {
      // ...and Cancel must not undo it
      const base = { ...JSON.parse(liveBase), behavior: {} };
      applyBubbleChanges(base, payload);
      liveBase = livePart(base);
    }
  }

  // Appearance preview: the bubble is built at its real size, with the bubble window's own text
  // rules, and scaled down as one piece — so sizes and offsets keep their true proportions.
  const screenH = () => (typeof window !== "undefined" && window.screen?.availHeight) || 1080;
  // Real skin diameter in px (break: a share of the screen height).
  function miniSize() {
    return mode === "break" ? ((ap.sizePct ?? 45) / 100) * screenH() : ap.sizePx || 200;
  }
  // Shown diameter grows with the size setting, within what the preview column can hold.
  function miniScale() {
    const shown =
      mode === "break"
        ? Math.max(40, (ap.sizePct ?? 45) * 1.5)
        : 60 + ((ap.sizePx - BUBBLE_RANGE[0]) / (BUBBLE_RANGE[1] - BUBBLE_RANGE[0])) * 110;
    return shown / miniSize();
  }
  // Break only: at true scale the text would be a couple of pixels high, so it is shown larger
  // there (and its position is then approximate).
  const textBoost = () => (mode === "break" ? 1.6 : 1);
</script>

{#snippet lineControls(line, title)}
  <div class="aprow">
    <span class="aplabel">Font</span>
    <div class="fontdd" class:open={fontOpen}>
      <button
        type="button"
        class="ctl fontdd-btn"
        style:font-family={lineFont(line)}
        onclick={() => {
          fontOpen = !fontOpen;
          fontSearch = "";
        }}
      >
        <span class="fontdd-cur">{lineFont(line)}</span>
        <span class="fontdd-caret">▾</span>
      </button>
      {#if fontOpen}
        <div
          class="fontdd-backdrop"
          role="presentation"
          onclick={() => (fontOpen = false)}
        ></div>
        <div class="fontdd-panel">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="fontdd-search"
            placeholder="Search fonts…"
            bind:value={fontSearch}
            autofocus
          />
          <div class="fontdd-list">
            {#each fontMatches as f}
              <div
                class="fontdd-opt"
                class:sel={lineFont(line) === f}
                style:font-family={f}
                role="button"
                tabindex="0"
                onclick={() => {
                  ap[line + "Font"] = f;
                  fontOpen = false;
                }}
                onkeydown={(e) =>
                  e.key === "Enter" &&
                  ((ap[line + "Font"] = f), (fontOpen = false))}
              >
                {f}
              </div>
            {/each}
            {#if fontMatches.length === 0}<div class="fontdd-empty">
                No matches
              </div>{/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
  {#each LINE_PARTS[line] as [key, name] (key)}
    <label class="swrow"
      >{name}<input type="checkbox" class="sw" bind:checked={ap[key]} /></label
    >
  {/each}
  <div class="aprow">
    <span class="aplabel">Size</span>
    <div class="sliderwrap">
      <input
        type="range"
        min={SIZE_RANGE[line][0]}
        max={SIZE_RANGE[line][1]}
        bind:value={ap[line + "Size"]}
        aria-label={title + " size"}
      />
      <span class="sval">{ap[line + "Size"]}px</span>
    </div>
  </div>
  <div class="aprow">
    <span class="aplabel">Color</span>
    <div class="colorrow">
      <input
        type="color"
        class="swatch"
        aria-label={title + " color"}
        bind:value={() => lineColor(line), (v) => setLineColor(ap, line, v)}
      />
      <input
        class="ctl small"
        aria-label={title + " color hex"}
        value={lineColor(line)}
        oninput={(e) => {
          const c = fullHex(e, lineColor(line));
          if (c) setLineColor(ap, line, c);
        }}
        onchange={(e) =>
          typedColor(e, (c) => setLineColor(ap, line, c), () => lineColor(line))}
      />
      <button
        class="btn icon"
        disabled={!ap[line + "Color"]}
        onclick={() => setLineColor(ap, line, "")}
        aria-label="Reset color"
        title="Back to the default text color">↺</button
      >
    </div>
  </div>
{/snippet}

{#snippet offsetRow(title, kx, ky, lim)}
  <div class="row">
    <span class="aplabel">{title}</span>
    <div class="xy">
      <Stepper bind:value={ap[kx]} min={lim.x[0]} max={lim.x[1]} step={5} />
      <Stepper bind:value={ap[ky]} min={lim.y[0]} max={lim.y[1]} step={5} />
    </div>
  </div>
{/snippet}

{#snippet themeBtn()}
  <div class="seg">
    <button
      class:on={theme === "light"}
      title="Light"
      onclick={() => {
        theme = "light";
        s.theme = "light";
      }}>☀</button
    >
    <button
      class:on={theme === "dark"}
      title="Dark"
      onclick={() => {
        theme = "dark";
        s.theme = "dark";
      }}>☾</button
    >
  </div>
{/snippet}

<div class="win" data-theme={theme}>
  <div class="body">
    <div class="rail">
      {#each NAV as n}
        <div
          class="navitem"
          class:sel={pane === n.id}
          role="button"
          tabindex="0"
          onclick={() => (pane = n.id)}
          onkeydown={(e) => e.key === "Enter" && (pane = n.id)}
        >
          {n.label}
        </div>
      {/each}
    </div>

    <!-- ===== TIMERS ===== -->
    {#if pane === "timers"}
      <div class="pane">
        <div class="modeseg tmseg">
          {#each TIMER_PRESETS as p (p.name)}
            <button
              class:on={timerPreset$ === p}
              onclick={() => {
                customPicked = false;
                Object.assign(s.timers, p.t);
              }}>{p.name}</button
            >
          {/each}
          <button
            class:on={!timerPreset$}
            onclick={() => (customPicked = true)}>Custom</button
          >
        </div>
        <div class="card timers">
          <div class="row">
            <label>Work<span class="desc">How long you focus before a break · hours:minutes</span></label>
            <Stepper
              bind:value={s.timers.workSeconds}
              min={60}
              max={359940}
              step={300}
              format={(v) => fmtDuration(v, "work")}
              parse={(t) => parseDuration(t, "work")}
            />
          </div>
          <div class="row">
            <label>Break<span class="desc">The breathing pause after each session · minutes:seconds</span></label>
            <Stepper
              bind:value={s.timers.breakSeconds}
              min={1}
              max={3599}
              step={30}
              format={(v) => fmtDuration(v, "break")}
              parse={(t) => parseDuration(t, "break")}
            />
          </div>
          <div class="row">
            <label>Long break<span class="desc">A longer pause every few sessions · minutes:seconds</span></label>
            <Stepper
              bind:value={s.timers.longBreakSeconds}
              min={1}
              max={3599}
              step={60}
              format={(v) => fmtDuration(v, "long")}
              parse={(t) => parseDuration(t, "long")}
            />
          </div>
          <div class="row">
            <label>Long break after<span class="desc">Number of sessions · 0 turns long breaks off</span></label>
            <Stepper
              bind:value={s.timers.longBreakEvery}
              min={0}
              max={12}
              step={1}
            />
          </div>
        </div>
      </div>

      <!-- ===== PATTERNS ===== -->
    {:else if pane === "patterns"}
      <div class="pane">
        <!-- The colored dots double as the legend for the bars below. -->
        <div class="card">
          <div class="ch">Words shown in the bubble</div>
          <div class="words">
            <label
              ><span class="dot ph-in"></span>Inhale
              <input class="ctl" bind:value={s.text.phases.in} placeholder="In" /></label
            >
            <label
              ><span class="dot ph-out"></span>Exhale
              <input class="ctl" bind:value={s.text.phases.out} placeholder="Out" /></label
            >
            <label
              ><span class="dot ph-hold"></span>Hold
              <input class="ctl" bind:value={s.text.phases.hold} placeholder="Hold" /></label
            >
          </div>
        </div>

        {#each s.patterns as p (p.id)}
          <div class="gitem patrow">
            <div
              class="pat-main"
              role="button"
              tabindex="0"
              title="Edit pattern"
              onclick={() => openPatternEditorFor(p)}
              onkeydown={(e) => e.key === "Enter" && openPatternEditorFor(p)}
            >
              <div class="gname">{p.name}</div>
              <div class="pbar" title={phaseSummary(p.phases)}>
                {#each p.phases as ph}
                  <span
                    class:ph-in={ph.type === "in"}
                    class:ph-out={ph.type === "out"}
                    style:flex-grow={ph.seconds}>{ph.seconds}</span
                  >
                {/each}
              </div>
            </div>
            <button
              class="skin-btn"
              class:on={s.timers.workPattern === p.id}
              onclick={() => (s.timers.workPattern = p.id)}>Work</button
            >
            <button
              class="skin-btn brk"
              class:on={s.timers.breakPattern === p.id}
              onclick={() => (s.timers.breakPattern = p.id)}>Break</button
            >
            {#if s.patterns.length > 1}
              <button
                class="skin-bin"
                title="Delete pattern"
                aria-label="Delete pattern"
                onclick={() => deletePattern(p.id)}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18M8 6V4h8v2m1 0v14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V6M10 11v6M14 11v6" />
                </svg>
              </button>
            {/if}
          </div>
        {/each}
        <div
          class="gitem gadd patadd"
          role="button"
          tabindex="0"
          onclick={openNewPatternWindow}
          onkeydown={(e) => e.key === "Enter" && openNewPatternWindow()}
        >
          <div class="gplus">+</div>
          <div class="gsummary">New pattern</div>
        </div>
      </div>

<!-- ===== SKINS ===== -->
    {:else if pane === "skins"}
      <div class="pane">
        <div class="gallery skin-gallery">
          {#each allSkins as sk (sk.id)}
            <div class="gitem skin-gitem">
              {#if sk.custom}
                <button
                  class="skin-bin"
                  title="Delete skin"
                  aria-label="Delete skin"
                  onclick={() => deleteCustomSkin(sk.id)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="M3 6h18M8 6V4h8v2m1 0v14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V6M10 11v6M14 11v6"
                    />
                  </svg>
                </button>
              {/if}
              {#if sk.custom}
                <input
                  class="gname gname-edit"
                  value={sk.name}
                  onchange={(e) => renameSkin(sk.id, e.target.value)}
                  onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
              {:else}
                <div class="gname">{sk.name}</div>
              {/if}
              <div class="skin-preview" use:previewSkin={sk.id}></div>
              <div class="skin-modes">
                <button
                  class="skin-btn"
                  class:on={s.appearance.work.skin === sk.id}
                  onclick={() => (s.appearance.work.skin = sk.id)}>Work</button
                >
                <button
                  class="skin-btn brk"
                  class:on={s.appearance.break.skin === sk.id}
                  onclick={() => (s.appearance.break.skin = sk.id)}
                  >Break</button
                >
              </div>
            </div>
          {/each}

          <div
            class="gitem gadd skin-gadd"
            role="button"
            tabindex="0"
            onclick={() => importTrigger?.click()}
            onkeydown={(e) => e.key === "Enter" && importTrigger?.click()}
          >
            <div class="gplus">+</div>
            <div class="gsummary">Import skin (SVG or ZIP)</div>
          </div>
        </div>

        {#if importError}
          <div class="import-error">{importError}</div>
        {/if}

        <input
          bind:this={importTrigger}
          type="file"
          accept=".svg,.zip"
          style:display="none"
          onchange={onImportFile}
        />
      </div>

      <!-- ===== APPEARANCE ===== -->
    {:else if pane === "appearance"}
      <div class="pane">
        <div class="panehead">
          <button
            class="livebtn"
            class:on={live}
            aria-pressed={live}
            onclick={toggleLive}
            title="Show appearance changes in the bubble right away"
            ><span class="livedot"></span>Live update</button
          >
          <div class="modeseg">
            <button class:on={mode === "work"} onclick={() => (mode = "work")}
              >Work</button
            >
            <button class:on={mode === "break"} onclick={() => (mode = "break")}
              >Break</button
            >
          </div>
          {@render themeBtn()}
        </div>

        <!-- [ live preview | Bubble / Text / Position tabs ]: the preview stays put on every tab -->
        <div class="card preview">
          <div class="text-stage">
            <div
              class="mini"
              style:font-family={ap.font}
              style:width="{miniSize()}px"
              style:top="calc(50% - {(miniSize() * miniScale()) / 2}px)"
              style:transform="translateX(-50%) scale({miniScale()})"
            >
              <div
                class="orb"
                bind:this={previewBox}
                style:width="{miniSize()}px"
                style:height="{miniSize()}px"
                style:opacity={ap.opacity}
              ></div>
              <div
                class="mini-text"
                style:transform="translate({ap.textOffsetX ?? 0}px, {ap.textOffsetY ?? 0}px)"
              >
                <div
                  class="ts-big"
                  style:font-family={ap.labelFont || null}
                  style:color={lineColor("label")}
                  style:font-size="{ap.labelSize * textBoost()}px"
                  style:transform="translate({ap.labelOffsetX ?? 0}px, {ap.labelOffsetY ?? 0}px)"
                >
                  {[
                    ap.showPhaseLabel && s.text.phases.in,
                    ap.showPhaseCountdown && "4",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </div>
                <div
                  class="ts-small"
                  style:font-family={ap.subFont || null}
                  style:color={lineColor("sub")}
                  style:font-size="{ap.subSize * textBoost()}px"
                  style:transform="translate({ap.subOffsetX ?? 0}px, {ap.subOffsetY ?? 0}px)"
                >
                  {[ap.showPomodoro && "24:18", ap.showSessions && "[2]"]
                    .filter(Boolean)
                    .join("  ")}
                </div>
              </div>
            </div>
          </div>

          <div class="ap-side">
            <div class="apsubseg">
              {#each AP_TABS as t (t.id)}
                <button class:on={apSub === t.id} onclick={() => (apSub = t.id)}
                  >{t.label}</button
                >
              {/each}
            </div>

            {#if apSub === "skin"}
              <div class="psg">
                {#each allSkins as sk (sk.id)}
                  <div
                    class="psg-item"
                    class:selected={ap.skin === sk.id}
                    role="button"
                    tabindex="0"
                    onclick={() => (ap.skin = sk.id)}
                    onkeydown={(e) => e.key === "Enter" && (ap.skin = sk.id)}
                  >
                    <div
                      class="psg-preview"
                      use:previewSkin={{
                        skinId: sk.id,
                        fill: s.skinColors[sk.id],
                      }}
                    ></div>
                    <div class="psg-name">{sk.name}</div>
                  </div>
                {/each}
              </div>
              <div class="aprow">
                <span class="aplabel">Size</span>
                <div class="sliderwrap">
                  {#if mode === "break"}
                    <input
                      type="range"
                      min="10"
                      max="90"
                      bind:value={ap.sizePct}
                      aria-label="Size"
                    />
                    <span class="sval">{ap.sizePct}%</span>
                  {:else}
                    <input
                      type="range"
                      min={BUBBLE_RANGE[0]}
                      max={BUBBLE_RANGE[1]}
                      bind:value={ap.sizePx}
                      aria-label="Size"
                    />
                    <span class="sval">{ap.sizePx}px</span>
                  {/if}
                </div>
              </div>
              <div class="aprow">
                <span class="aplabel">Opacity</span>
                <div class="sliderwrap">
                  <input
                    type="range"
                    min="20"
                    max="100"
                    aria-label="Opacity"
                    bind:value={
                      () => Math.round(ap.opacity * 100),
                      (v) => (ap.opacity = v / 100)
                    }
                  />
                  <span class="sval">{Math.round(ap.opacity * 100)}%</span>
                </div>
              </div>
              <div class="aprow">
                <span class="aplabel">Color</span>
                <div class="colorrow">
                  <input
                    type="color"
                    class="swatch"
                    aria-label="Bubble color"
                    bind:value={
                      () => s.skinColors[ap.skin] ?? apTheme,
                      (v) => setSkinColor(s, ap.skin, v)
                    }
                  />
                  <input
                    class="ctl small"
                    aria-label="Bubble color hex"
                    value={s.skinColors[ap.skin] ?? apTheme}
                    oninput={(e) => {
                      const c = fullHex(e, s.skinColors[ap.skin] ?? apTheme);
                      if (c) setSkinColor(s, ap.skin, c);
                    }}
                    onchange={(e) =>
                      typedColor(
                        e,
                        (c) => setSkinColor(s, ap.skin, c),
                        () => s.skinColors[ap.skin] ?? apTheme,
                      )}
                  />
                  <button
                    class="btn icon"
                    disabled={!(ap.skin in s.skinColors)}
                    onclick={() => setSkinColor(s, ap.skin, "")}
                    aria-label="Reset color"
                    title="Back to the skin's own colors">↺</button
                  >
                </div>
              </div>
            {:else if apSub === "text"}
              <div class="apsubseg">
                {#each [["label", "Top line"], ["sub", "Bottom line"]] as [id, name] (id)}
                  <button
                    class:on={apLine === id}
                    onclick={() => {
                      apLine = id;
                      fontOpen = false;
                    }}>{name}</button
                  >
                {/each}
              </div>
              {@render lineControls(apLine, apLine === "label" ? "Top line" : "Bottom line")}
            {:else}
              <div class="timers">
                {#if mode === "work"}
                  <div class="ch">Bubble on the screen</div>
                  <div class="row">
                    <span class="aplabel">From right edge (px)</span>
                    <Stepper
                      bind:value={ap.posRight}
                      min={0}
                      max={3000}
                      step={10}
                    />
                  </div>
                  <div class="row">
                    <span class="aplabel">From top edge (px)</span>
                    <Stepper bind:value={ap.posTop} min={0} max={3000} step={10} />
                  </div>
                {/if}
                <div class="row xyhead">
                  <span class="ch">Text position (px)</span>
                  <div class="xy"><span>sideways</span><span>down</span></div>
                </div>
                <!-- Per line: the same keys and limits as dragging a line in the bubble's edit mode. -->
                {@render offsetRow("Top line", "labelOffsetX", "labelOffsetY", lineOffsetRange(ap))}
                {@render offsetRow("Bottom line", "subOffsetX", "subOffsetY", lineOffsetRange(ap))}
              </div>
            {/if}
          </div>
        </div>
      </div>

<!-- ===== BEHAVIOR ===== -->
    {:else if pane === "behavior"}
      <div class="pane">
        <div class="modeseg bhseg">
          {#each BH_TABS as t (t.id)}
            <button class:on={bhSub === t.id} onclick={() => (bhSub = t.id)}
              >{t.label}</button
            >
          {/each}
        </div>

        {#if bhSub === "general"}
          <div class="card">
            <div class="ch">General</div>
            <label class="swrow"
              >Start on boot<input
                type="checkbox"
                class="sw"
                bind:checked={s.behavior.startOnBoot}
              /></label
            >
            <label class="swrow"
              >Chime on transitions<input
                type="checkbox"
                class="sw"
                bind:checked={s.behavior.chimeOnTransitions}
              /></label
            >
            <label class="swrow"
              >Check for updates at start and once a day<input
                type="checkbox"
                class="sw"
                bind:checked={s.behavior.checkUpdates}
              /></label
            >
          </div>
          <!-- The two choices the bubble's dialogs offer ("Don't show again", "Always save"),
               so they can be changed back. -->
          <div class="card">
            <div class="ch">Bubble</div>
            <label class="swrow"
              >Remind me the app keeps running in the tray when I hide the bubble<input
                type="checkbox"
                class="sw"
                bind:checked={
                  () => !s.behavior.hideNoticeOff,
                  (v) => (s.behavior.hideNoticeOff = !v)
                }
              /></label
            >
            <label class="swrow"
              >Save changes without asking when closing edit mode<input
                type="checkbox"
                class="sw"
                bind:checked={s.behavior.editAutoSave}
              /></label
            >
          </div>
        {:else if bhSub === "sound"}
          <div class="card">
            <div class="player">
              <button
                class="playbtn"
                onclick={togglePreview}
                aria-pressed={previewing}
                aria-label={previewing ? "Stop" : "Listen"}
                title={previewing ? "Stop" : "Listen"}>{previewing ? "■" : "▶"}</button
              >
              <div>
                <div class="gname">Breathing music</div>
                <div class="gsummary">Plays your work pattern with these choices.</div>
              </div>
            </div>
            <label class="swrow"
              >Play breathing music (also on the bubble's speaker button and in the tray)<input
                type="checkbox"
                class="sw"
                bind:checked={s.music.on}
              /></label
            >
            <div class="row">
              <label for="music-sound">Sound</label>
              <select id="music-sound" class="ctl" bind:value={s.music.sound}>
                {#each SOUNDS as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
              </select>
            </div>
            <div class="row">
              <label for="music-hold">Hold style</label>
              <div class="music-hold">
                <select id="music-hold" class="ctl" bind:value={s.music.hold}>
                  {#each HOLDS as h (h.id)}<option value={h.id}>{h.name}</option>{/each}
                </select>
                <span class="hint">{HOLDS.find((h) => h.id === s.music.hold)?.desc}</span>
              </div>
            </div>
            <div class="row">
              <label for="music-volume">Volume</label>
              <div class="sliderwrap">
                <input id="music-volume" type="range" min="0" max="100"
                  bind:value={() => Math.round(s.music.volume * 100), (v) => (s.music.volume = v / 100)} />
                <span class="sval">{Math.round(s.music.volume * 100)}%</span>
              </div>
            </div>
            <div class="row">
              <label for="music-room">Room</label>
              <div class="sliderwrap">
                <input id="music-room" type="range" min="0" max="100"
                  bind:value={() => Math.round(s.music.room * 100), (v) => (s.music.room = v / 100)} />
                <span class="sval">{Math.round(s.music.room * 100)}%</span>
              </div>
            </div>
          </div>
        {:else}
          <div class="card">
            <div class="ch">Hotkeys</div>
            {#each HOTKEY_ROWS as h (h.id)}
              <div class="row">
                <label for={"hk-" + h.id}>{h.label}</label>
                <div class="hk">
                  <input
                    id={"hk-" + h.id}
                    class="ctl hk-input"
                    readonly
                    placeholder="press keys…"
                    value={s.hotkeys[h.id] || ""}
                    onkeydown={(e) => recordHotkey(e, h.id)}
                  />
                  <button
                    class="hk-btn"
                    title="Clear (disable)"
                    aria-label="Clear hotkey"
                    onclick={() => (s.hotkeys[h.id] = null)}>✕</button
                  >
                  <button
                    class="hk-btn"
                    title="Reset to default"
                    aria-label="Reset hotkey to default"
                    onclick={() => (s.hotkeys[h.id] = DEFAULT_SETTINGS.hotkeys[h.id])}>↺</button
                  >
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

<!-- ===== ABOUT ===== -->
    {:else if pane === "about"}
      <div class="pane">
        <div class="about-center">
          <img
            src="/img/breathpause-128.png"
            alt="BreathPause"
            class="about-logo"
          />
          <div class="about-name">BreathPause</div>
          <div class="about-ver"><span class="verpill">Version {version}</span></div>
          {#if inTauri && upd.state !== "idle"}
            <div class="upcard" class:new={["available", "downloading", "failed"].includes(upd.state)}>
              {#if upd.state === "checking"}
                <span class="gsummary">Checking for updates…</span>
              {:else if upd.state === "available"}
                <div class="uprow">
                  <b>Version {upd.version} is available</b>
                  <button class="linklike" onclick={() => openExternal(releaseUrl(upd.version))}>What's new</button>
                </div>
                <div class="uprow">
                  {#if updKind === "standalone"}
                    <span class="gsummary">Download the new version and replace this one.</span>
                    <button class="btn primary" onclick={() => openExternal(releaseUrl(upd.version))}>Download</button>
                  {:else}
                    <span class="gsummary">BreathPause restarts when it's done.</span>
                    <button class="btn primary" onclick={startInstall}>Install &amp; restart</button>
                  {/if}
                </div>
              {:else if upd.state === "downloading"}
                <div class="uprow">
                  <b>Downloading {upd.version}…</b>
                  <span class="gsummary">{upd.pct == null ? "" : upd.pct + "%"}</span>
                </div>
                <div class="upbar"><i style:width="{upd.pct ?? 0}%"></i></div>
              {:else if upd.state === "failed"}
                <div class="uprow">
                  <b>The update couldn't be installed</b>
                  <button class="btn" onclick={startInstall}>Try again</button>
                </div>
                <span class="gsummary">Check your connection, or download it from the release page.</span>
              {:else}
                <div class="uprow">
                  <b>{upd.state === "none" ? "BreathPause is up to date" : "Couldn't check for updates"}</b>
                  <button class="btn" onclick={checkUpdates}>Check now</button>
                </div>
              {/if}
            </div>
          {/if}
          <div class="about-tag">
            An always-on-top breathing bubble. Sits in the corner and
            breathes quietly while you work, then guides you through a
            breathing break when the pomodoro timer runs out.
          </div>
          <div class="about-actions">
            <button
              class="btn"
              onclick={() =>
                openExternal("https://github.com/Markus-Wildgruber/breathpause")}
              >GitHub</button
            >
            <button
              class="btn"
              onclick={() =>
                openExternal("https://www.instagram.com/breathe.nice/")}
              >Instagram</button
            >
            <button
              class="btn primary"
              onclick={() =>
                openExternal(
                  "https://github.com/Markus-Wildgruber/breathpause/issues/new",
                )}>Report a problem</button
            >
          </div>
          <div class="about-ver">Made by Markus Wildgruber · MIT License · © 2026</div>
          <button
            class="linklike"
            aria-expanded={showCredits}
            onclick={() => (showCredits = !showCredits)}
            >{showCredits ? "Hide artwork credits" : "Show artwork credits"}</button
          >
        </div>
        {#if showCredits}
        <div class="card">
          <div class="ch">Artwork credits</div>
          {#each CREDITS as c (c.id)}
            <div class="credit">
              <div class="credit-thumb" use:previewSkin={c.id}></div>
              <div>
                <div class="gname">{c.name}</div>
                <div class="gsummary">
                  {c.text}{#if c.url}{" "}<button
                      class="linklike"
                      onclick={() => openExternal(c.url)}>{c.source}</button
                    >{/if} · {c.license}
                </div>
              </div>
            </div>
          {/each}
          <div class="gsummary credit-more">
            Full attributions: CREDITS.md in the repository
          </div>
        </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="foot">
    <button class="btn" onclick={onExit}>Quit</button>
    <button class="btn" onclick={onReset}>Reset</button>
    <span class="spacer"></span>
    <button class="btn" onclick={close}>Cancel</button>
    <button class="btn primary" onclick={onSave}>Save</button>
  </div>
</div>

<style>
  /* ===== theme tokens ===== */
  .win {
    --card: #1c1c1e;
    --pane: #161619;
    --bar: #2d2d3c;
    --rail: #121215;
    --fore: #f2f2f2;
    --muted: #9aa0aa;
    /* Brand pair, from drawbreath's breath ink: blue = exhale / accent, pink = inhale / break. */
    --accent: #4d9abf;
    --accentFg: #06222c;
    --line: rgba(255, 255, 255, 0.1);
    --field: rgba(255, 255, 255, 0.07);
    --cardbg: rgba(255, 255, 255, 0.04);
    --railSel: var(--accent);
    --railSelFg: #06222c;
    --seg: rgba(255, 255, 255, 0.08);
    --segSel: rgba(255, 255, 255, 0.92);
    --segSelFg: #1a1a1f;
    --brk: #d4577f;
    --brkFg: #1f0a12;
  }
  .win[data-theme="light"] {
    --card: #f3f3f6;
    --pane: #fbfbfd;
    --bar: #e7e7ee;
    --rail: #ececf2;
    --fore: #1a1a1f;
    --muted: #5a5a63;
    --accent: #4d9abf;
    --accentFg: #06222c;
    --line: rgba(0, 0, 0, 0.1);
    --field: #ffffff;
    --cardbg: #ffffff;
    --railSel: #4d9abf;
    --railSelFg: #06222c;
    --seg: #e2e2ea;
    --segSel: #ffffff;
    --segSelFg: #1a1a1f;
    --brk: #d4577f;
    --brkFg: #1f0a12;
  }

  .win {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--card);
    color: var(--fore);
    font:
      13px/1.45 "Segoe UI",
      system-ui,
      sans-serif;
    transition: background 0.2s;
  }

  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .rail {
    width: 184px;
    flex: none;
    background: var(--rail);
    border-right: 1px solid var(--line);
    padding: 12px 10px;
  }
  .navitem {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 10px 12px;
    border-radius: 9px;
    color: var(--muted);
    cursor: pointer;
    margin-bottom: 2px;
    font-size: 13.5px;
  }
  .navitem:hover {
    background: var(--field);
  }
  .navitem.sel {
    background: var(--railSel);
    color: var(--railSelFg);
    font-weight: 600;
  }

  .pane {
    flex: 1;
    background: var(--pane);
    overflow: auto;
    padding: 18px 20px;
  }
  /* Appearance head row: [ spacer | Work/Break centered | theme toggle right ] */
  .panehead {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    margin-bottom: 14px;
  }
  .panehead .seg {
    grid-column: 3;
    justify-self: end;
  }

  .seg {
    display: inline-flex;
    background: var(--seg);
    border-radius: 9px;
    padding: 3px;
    gap: 2px;
    flex: none;
  }
  .seg button {
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 15px;
    width: 34px;
    height: 30px;
    border-radius: 7px;
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .seg button.on {
    background: var(--segSel);
    color: var(--segSelFg);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  }

  .modeseg {
    display: flex;
    background: var(--seg);
    border-radius: 9px;
    padding: 3px;
    gap: 2px;
    grid-column: 2;
    width: 240px;
  }
  .modeseg button {
    flex: 1;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 13.5px;
    height: 34px;
    border-radius: 7px;
    cursor: pointer;
    font-weight: 600;
  }
  .modeseg button.on {
    background: var(--segSel);
    color: var(--segSelFg);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  }

  .card {
    background: var(--cardbg);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 6px 16px 14px;
    margin: 0 0 14px;
  }
  .card.preview {
    padding: 0;
    overflow: hidden;
    display: flex;
    align-items: stretch;
    height: 404px; /* fixed so the tabs are identical — nothing jumps on switch */
    background: var(--card);
  }
  .ch {
    font-size: 13px;
    font-weight: 600;
    margin: 14px 0 4px;
    opacity: 0.9;
  }
  .row {
    display: grid;
    grid-template-columns: 200px 1fr;
    align-items: center;
    gap: 12px;
    margin: 10px 0;
  }
  .row label {
    color: var(--muted);
    font-size: 12.5px;
  }
  .ctl {
    height: 30px;
    border-radius: 7px;
    background: var(--field);
    border: 1px solid var(--line);
    color: var(--fore);
    padding: 0 9px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font: inherit;
  }
  input.ctl {
    width: 90px;
  }
  input.ctl.small {
    width: 96px;
  }
  select.ctl {
    width: auto;
    min-width: 160px;
  }
  select.ctl option {
    background: var(--card);
    color: var(--fore);
  }

  .hint {
    font-size: 12px;
    color: var(--muted);
    margin-left: 10px;
  }
  .music-hold {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 0;
  }
  .sliderwrap {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--field);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 9px 12px;
    max-width: 330px;
  }
  .sliderwrap input[type="range"] {
    flex: 1;
    min-width: 120px;
    accent-color: var(--accent);
    height: 4px;
  }
  .sval {
    color: var(--fore);
    font-size: 12px;
    white-space: nowrap;
    text-align: right;
    min-width: 48px;
  }

  /* number/duration fields (Stepper component): label fills the row, field sits at the far right */
  .timers .row {
    grid-template-columns: 1fr auto;
    gap: 16px;
  }
  .timers .row label {
    white-space: nowrap;
  }

  .hk {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  input.ctl.hk-input {
    width: 150px; /* beats input.ctl's 90px; fits Ctrl+Alt+Shift+P */
    cursor: pointer;
  }
  .hk-btn {
    height: 30px;
    width: 30px;
    border-radius: 7px;
    background: var(--field);
    border: 1px solid var(--line);
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .hk-btn:hover {
    color: var(--fore);
  }
  .swatch {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    border: 1px solid var(--muted);
    background: none;
    padding: 0;
    cursor: pointer;
  }
  .colorrow {
    display: flex;
    gap: 9px;
    align-items: center;
  }

  /* preview card: [ tabs + preview + color  |  divider  |  skins ] — left 3/5, skins 2/5 */
  .orb {
    display: grid;
    place-items: center;
  }
  .btn.icon {
    width: 30px;
    height: 30px;
    padding: 0;
    display: grid;
    place-items: center;
    font-size: 14px;
  }
  .btn.icon:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* vertical size/opacity rails flanking the skin preview (no dividers) */

  /* skin picker: right 2/5 of the preview card, behind a divider line */
  .psg {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(62px, 1fr));
    gap: 6px;
    max-height: 150px; /* two rows, then it scrolls */
    overflow-y: auto;
    margin-bottom: 6px;
  }
  .psg-item {
    cursor: pointer;
    border-radius: 8px;
    border: 2px solid transparent;
    padding: 4px 2px 3px;
    text-align: center;
    transition: border-color 0.15s;
  }
  .psg-item.selected {
    border-color: var(--accent);
  }
  .psg-item:hover:not(.selected) {
    border-color: var(--muted);
  }
  .psg-preview {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    overflow: hidden;
    margin: 0 auto 3px;
    background: radial-gradient(
      circle at 50% 44%,
      rgba(77, 154, 191, 0.09),
      transparent 70%
    );
  }
  .psg-name {
    font-size: 10px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* text tab preview: text fixed a bit below the middle; the skin sits just above it and
     scales with the size (its bottom anchored, growing upward). Fixed height — a max-size
     skin clips at the top rather than growing the box. */
  .text-stage {
    flex: none;
    width: 190px;
    position: relative;
    overflow: hidden;
    border-right: 1px solid var(--line);
    /* stands in for a desktop wallpaper, so the (usually white) bubble text reads in both themes */
    background: linear-gradient(135deg, #4d9abf, #d4577f);
  }
  /* the bubble at real size, scaled down from the top centre of its skin */
  .mini {
    position: absolute;
    left: 50%;
    transform-origin: top center;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: normal;
    font-weight: 400;
  }
  .mini-text {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .ts-big {
    margin-top: 2px;
    letter-spacing: 3px;
    opacity: 0.9;
    min-height: 24px;
  }
  .ts-small {
    letter-spacing: 2px;
    opacity: 0.65;
    min-height: 18px;
  }

  /* searchable font dropdown — matches the size-slider width */
  .fontdd {
    position: relative;
    width: 100%;
  }
  .fontdd-btn {
    width: 100%;
    justify-content: space-between;
    cursor: pointer;
    text-align: left;
  }
  .fontdd-cur {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fontdd-caret {
    color: var(--muted);
    font-size: 11px;
    flex: none;
  }
  .fontdd-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
  }
  .fontdd-panel {
    position: absolute;
    top: 34px;
    left: 0;
    right: 0;
    z-index: 41;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .fontdd-search {
    height: 28px;
    border-radius: 6px;
    background: var(--field);
    border: 1px solid var(--line);
    color: var(--fore);
    padding: 0 9px;
    font: inherit;
    font-size: 12.5px;
    outline: none;
  }
  .fontdd-search:focus {
    border-color: var(--accent);
  }
  .fontdd-list {
    max-height: 176px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .fontdd-opt {
    padding: 6px 9px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: var(--fore);
  }
  .fontdd-opt:hover {
    background: var(--field);
  }
  .fontdd-opt.sel {
    background: var(--accent);
    color: var(--accentFg);
  }
  .fontdd-empty {
    padding: 6px 9px;
    color: var(--muted);
    font-size: 12px;
  }

  .apsubseg {
    display: flex;
    background: var(--seg);
    border-radius: 9px;
    padding: 3px;
    gap: 2px;
    margin-bottom: 10px;
  }
  .apsubseg button {
    flex: 1;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    height: 30px;
    border-radius: 7px;
    cursor: pointer;
    font-weight: 500;
  }
  .apsubseg button.on {
    background: var(--segSel);
    color: var(--segSelFg);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  }

  /* patterns: one per line — name, phase bar (flex-grow = seconds), Work/Break, delete */
  .patrow {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    cursor: default;
  }
  .pat-main {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 130px 1fr;
    align-items: center;
    gap: 12px;
    cursor: pointer;
  }
  .patrow .gname {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .patrow .skin-bin {
    position: static;
    flex: none;
  }
  .gadd.patadd {
    flex-direction: row;
    gap: 8px;
    min-height: 0;
  }
  .pbar {
    display: flex;
    gap: 2px;
    height: 22px;
    border-radius: 7px;
    overflow: hidden;
  }
  .pbar span {
    flex-basis: 0;
    min-width: 22px;
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    line-height: 22px;
    color: #14141a;
    background: #8a827a; /* hold — phase colors = drawbreath's line ink, same as the pattern editor */
  }
  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #8a827a;
  }
  .pbar .ph-in,
  .dot.ph-in {
    background: #d4577f;
  }
  .pbar .ph-out,
  .dot.ph-out {
    background: #4d9abf;
  }
  .words {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-top: 8px;
  }
  .words label {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 12.5px;
  }
  .words input.ctl {
    flex: 1;
    min-width: 0;
    width: auto;
  }

  /* pattern gallery */
  .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }
  .gitem {
    background: var(--cardbg);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 14px;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .gitem:hover {
    border-color: var(--accent);
  }
  .gadd {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 70px;
  }
  .gplus {
    font-size: 22px;
    color: var(--accent);
    line-height: 1;
  }
  .gname {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 4px;
  }
  .gsummary {
    color: var(--muted);
    font-size: 11.5px;
    line-height: 1.4;
  }

  /* skin gallery */
  .skin-gallery {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }
  .skin-gitem {
    padding: 0 0 12px;
    display: flex;
    flex-direction: column;
    cursor: default;
    position: relative;
  }
  .skin-preview {
    width: 100%;
    height: 92px;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 8px;
    background: radial-gradient(
      circle at 50% 44%,
      rgba(77, 154, 191, 0.09),
      transparent 70%
    );
  }
  .skin-modes {
    display: flex;
    justify-content: center;
    gap: 6px;
    padding: 8px 6px 0;
    flex-wrap: wrap;
  }
  .skin-btn {
    border: 1px solid var(--line);
    background: var(--field);
    color: var(--muted);
    padding: 4px 12px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  .skin-btn.on {
    background: var(--accent);
    color: var(--accentFg);
    border-color: transparent;
    font-weight: 600;
  }
  .skin-gitem .gname {
    padding: 10px 14px 8px;
    margin-bottom: 0;
    text-align: center;
  }
  .gname-edit {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 600;
    font-size: 13px;
    border-radius: 5px;
    outline: none;
    padding: 8px 12px;
    margin: 2px 0 6px;
    text-align: center;
  }
  .gname-edit:hover {
    border-color: var(--line);
  }
  .gname-edit:focus {
    border-color: var(--accent);
    background: var(--field);
  }
  .skin-bin {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 2;
    border: 0;
    border-radius: 6px;
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    cursor: pointer;
    background: rgba(0, 0, 0, 0.28);
    color: #fff;
    opacity: 0.6;
    transition:
      opacity 0.12s,
      background 0.12s;
  }
  .skin-gitem:hover .skin-bin {
    opacity: 1;
  }
  .skin-bin:hover {
    background: #e05252;
  }
  .skin-gadd {
    padding: 12px 14px;
  }

  /* about */
  .about-center {
    text-align: center;
    padding: 18px 0 10px;
  }
  .about-logo {
    width: 64px;
    height: 64px;
    border-radius: 14px;
    margin-bottom: 8px;
  }
  .about-name {
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .about-ver {
    color: var(--muted);
    font-size: 12px;
    margin-bottom: 10px;
  }
  .about-tag {
    color: var(--muted);
    font-size: 12.5px;
    max-width: 360px;
    margin: 0 auto 6px;
    line-height: 1.5;
  }
  /* About › update card */
  .upcard {
    max-width: 420px;
    margin: 4px auto 12px;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-align: left;
    background: var(--cardbg);
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: 10px;
  }
  .upcard.new {
    border-left-color: var(--brk); /* pink: something new */
  }
  .uprow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .upbar {
    height: 6px;
    border-radius: 3px;
    background: var(--field);
    overflow: hidden;
  }
  .upbar i {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .import-error {
    color: #e05252;
    font-size: 12.5px;
    margin: 4px 0 10px;
  }
  .linklike {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }

  .foot {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-top: 1px solid var(--line);
    background: var(--card);
  }
  .btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--field);
    color: var(--fore);
    cursor: pointer;
    font: inherit;
  }
  .btn.primary {
    background: var(--accent);
    color: var(--accentFg);
    border: 0;
    font-weight: 600;
  }
  .spacer {
    flex: 1;
  }

  /* work = accent, break = its own color, wherever the two are assigned */
  .skin-btn.brk.on {
    background: var(--brk);
    color: var(--brkFg);
  }

  /* timers */
  .desc {
    display: block;
    font-size: 11.5px;
    opacity: 0.8;
  }

  /* behavior */
  .bhseg {
    margin: 0 auto 14px;
    width: 320px;
  }
  .tmseg {
    width: auto;
    margin-bottom: 14px;
  }
  .swrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin: 10px 0;
    cursor: pointer;
  }
  .sw {
    appearance: none;
    flex: none;
    width: 36px;
    height: 20px;
    margin: 0;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--seg);
    position: relative;
    cursor: pointer;
    transition: background 0.15s;
  }
  .sw::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    transition: left 0.15s;
  }
  .sw:checked {
    background: var(--accent);
  }
  .sw:checked::after {
    left: 18px;
  }
  .sw:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .player {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 12px 0 4px;
  }
  .player .gname {
    margin: 0;
  }
  .playbtn {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 0;
    background: var(--accent);
    color: var(--accentFg);
    font-size: 16px;
    cursor: pointer;
  }

  /* about */
  .verpill {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 10px;
    background: var(--seg);
  }
  .about-actions {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin: 14px 0 10px;
  }
  .credit {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 10px 0;
  }
  .credit .gname {
    margin-bottom: 1px;
  }
  .credit-thumb {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    overflow: hidden;
  }
  .credit-more {
    margin-top: 12px;
  }

  /* appearance: right-hand side of the preview card */
  .ap-side {
    flex: 1;
    min-width: 0;
    padding: 12px 14px;
    overflow-y: auto;
  }
  .aprow {
    display: grid;
    grid-template-columns: 74px 1fr;
    align-items: center;
    gap: 10px;
    margin: 8px 0;
  }
  .aplabel {
    color: var(--muted);
    font-size: 12.5px;
  }
  .aprow .sliderwrap {
    max-width: none;
  }
  .skin-gitem .skin-btn {
    padding: 4px 9px;
  }

  .livebtn {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 34px;
    padding: 0 12px;
    border-radius: 9px;
    border: 1px solid var(--line);
    background: var(--field);
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }
  .livebtn.on {
    color: var(--fore);
    border-color: var(--accent);
  }
  .livedot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }
  .livebtn.on .livedot {
    background: #2ecc71;
    box-shadow: 0 0 0 3px rgba(46, 204, 113, 0.25);
  }
  .xy {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .xyhead .ch {
    margin: 0;
  }
  .xyhead .xy {
    color: var(--muted);
    font-size: 11px;
    text-align: center;
  }
</style>
