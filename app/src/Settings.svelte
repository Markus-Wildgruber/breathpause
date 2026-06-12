<script>
  import { onMount } from "svelte";
  import Timefmt from "./core/timefmt.js";
  import {
    DEFAULT_SETTINGS,
    loadSettings,
    saveSettings,
    newSkinId,
  } from "./lib/settings-store.js";
  import {
    loadSkinById,
    mountSkin,
    scanColors,
    isNeutral,
    parseSkinImport,
  } from "./lib/skin.js";
  import Stepper from "./lib/Stepper.svelte";

  const inTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  let s = $state(loadSettings());
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

  const BUNDLED_SKINS = [
    { id: "orb", name: "Classic Orb" },
    { id: "sleepy-seal", name: "Sleepy Seal" },
    { id: "cute-bear", name: "Cute Bear" },
    { id: "sweet-jelly", name: "Sweet Jelly" },
  ];

  let allSkins = $derived([
    ...BUNDLED_SKINS,
    ...(s.customSkins || []).map((cs) => ({
      id: cs.id,
      name: cs.name,
      custom: true,
    })),
  ]);

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
    if (inTauri) {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("open-pattern-editor");
    }
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
    if (inTauri) {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("open-pattern-editor");
    }
  }

  // Delete a pattern (never the last one); re-point any work/break selection, persist now.
  function deletePattern(id) {
    if (s.patterns.length <= 1) return;
    s.patterns = s.patterns.filter((p) => p.id !== id);
    if (s.timers.workPattern === id) s.timers.workPattern = s.patterns[0]?.id ?? "";
    if (s.timers.breakPattern === id) s.timers.breakPattern = s.patterns[0]?.id ?? "";
    saveSettings($state.snapshot(s));
    emitChanged();
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

  // Drop the per-skin color override -> back to the skin's authored look.
  function resetColor() {
    const { [ap.skin]: _drop, ...rest } = s.skinColors;
    s.skinColors = rest;
  }

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
        previewMounted = mountSkin(previewBox, skin, fill ? { fill } : {});
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  async function emitChanged() {
    if (!inTauri) return;
    const { emit } = await import("@tauri-apps/api/event");
    await emit("settings-changed");
  }

  async function close() {
    if (!inTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }

  async function onSave() {
    const snap = $state.snapshot(s);
    saveSettings(snap);
    await emitChanged();
    if (inTauri) {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("apply-tray-text", snap.text.tray);
    }
    await close();
  }

  function onReset() {
    s = structuredClone(DEFAULT_SETTINGS);
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
    if (!inTauri) return;
    const { emit } = await import("@tauri-apps/api/event");
    await emit("app-quit");
  }

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
    let unlistenMove = null;
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

        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("pattern-editor-saved", refreshPatterns);
      })();
    }

    // Belt-and-suspenders: re-read patterns whenever the window regains focus (e.g. after
    // the pattern editor closes), so the gallery is never stale even if the event is missed.
    window.addEventListener("focus", refreshPatterns);

    return () => {
      cancelAnimationFrame(raf);
      unlisten?.();
      unlistenMove?.();
      window.removeEventListener("focus", refreshPatterns);
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

  function previewSize(px) {
    return Math.round(Math.max(12, px * 0.3)); // +20% of the old /4 scale; low floor so small sizes still shrink
  }
  // Preview orb diameter (px): work scales the pixel size, break scales the screen-% size.
  function previewDiameter() {
    return mode === "break"
      ? Math.round(Math.max(40, ((ap.sizePct ?? 45) / 100) * 150))
      : previewSize(ap.sizePx);
  }
  // Skin's preview scale — used to move the skin by the text offset so the relative
  // position reads true (matches the skin's own downscale).
  function skinScale() {
    if (mode === "break") {
      const h = (typeof window !== "undefined" && window.screen?.availHeight) || 1080;
      return 150 / h;
    }
    return previewDiameter() / (ap.sizePx || 200);
  }
  // Text's preview scale — kept larger than the skin so the label stays legible.
  function textScale() {
    if (mode === "break") {
      const h = (typeof window !== "undefined" && window.screen?.availHeight) || 1080;
      return 240 / h;
    }
    return 0.4;
  }
</script>

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
        <div class="card timers">
          <div class="row">
            <label>Work (hh:mm)</label>
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
            <label>Break (mm:ss)</label>
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
            <label>Long break (mm:ss)</label>
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
            <label>Long break every N sessions (0 = off)</label>
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
        <div class="gallery">
          {#each s.patterns as p (p.id)}
            <div class="gitem pat-gitem">
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
              <div
                class="pat-main"
                role="button"
                tabindex="0"
                onclick={() => openPatternEditorFor(p)}
                onkeydown={(e) => e.key === "Enter" && openPatternEditorFor(p)}
              >
                <div class="gname">{p.name}</div>
                <div class="gsummary">{phaseSummary(p.phases)}</div>
              </div>
              <div class="pat-modes">
                <button
                  class="skin-btn"
                  class:on={s.timers.workPattern === p.id}
                  onclick={() => (s.timers.workPattern = p.id)}>Work</button
                >
                <button
                  class="skin-btn"
                  class:on={s.timers.breakPattern === p.id}
                  onclick={() => (s.timers.breakPattern = p.id)}>Break</button
                >
              </div>
            </div>
          {/each}
          <div
            class="gitem gadd"
            role="button"
            tabindex="0"
            onclick={openNewPatternWindow}
            onkeydown={(e) => e.key === "Enter" && openNewPatternWindow()}
          >
            <div class="gplus">+</div>
            <div class="gsummary">New pattern</div>
          </div>
        </div>

        <div class="card timers">
          <div class="row">
            <label>Inhale</label>
            <input class="ctl" bind:value={s.text.phases.in} placeholder="In" />
          </div>
          <div class="row">
            <label>Exhale</label>
            <input
              class="ctl"
              bind:value={s.text.phases.out}
              placeholder="Out"
            />
          </div>
          <div class="row">
            <label>Hold</label>
            <input
              class="ctl"
              bind:value={s.text.phases.hold}
              placeholder="Hold"
            />
          </div>
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
                  class="skin-btn"
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

        <div class="card preview">
          <div class="preview-left">
            <div class="apsubseg in-card">
              <button
                class:on={apSub === "skin"}
                onclick={() => (apSub = "skin")}>Skin</button
              >
              <button
                class:on={apSub === "text"}
                onclick={() => (apSub = "text")}>Text</button
              >
            </div>
            {#if apSub === "skin"}
              <div class="prev-body">
                <div class="prev-rail">
                  <span class="vcap">Size</span>
                  {#if mode === "break"}
                    <input
                      class="vrange"
                      type="range"
                      min="10"
                      max="90"
                      bind:value={ap.sizePct}
                      aria-label="Size"
                    />
                    <span class="vlabel">{ap.sizePct}%</span>
                  {:else}
                    <input
                      class="vrange"
                      type="range"
                      min="60"
                      max="480"
                      bind:value={ap.sizePx}
                      aria-label="Size"
                    />
                    <span class="vlabel">{ap.sizePx}px</span>
                  {/if}
                </div>
                <div class="orbside">
                  <div
                    class="orb"
                    bind:this={previewBox}
                    style:width="{previewDiameter()}px"
                    style:height="{previewDiameter()}px"
                    style:opacity={ap.opacity}
                  ></div>
                </div>
                <div class="prev-rail">
                  <span class="vcap">Opacity</span>
                  <input
                    class="vrange"
                    type="range"
                    min="20"
                    max="100"
                    aria-label="Opacity"
                    bind:value={
                      () => Math.round(ap.opacity * 100),
                      (v) => (ap.opacity = v / 100)
                    }
                  />
                  <span class="vlabel">{Math.round(ap.opacity * 100)}%</span>
                </div>
              </div>
              <div class="orb-color">
                <input
                  type="color"
                  class="swatch"
                  bind:value={
                    () => s.skinColors[ap.skin] ?? apTheme,
                    (v) => (s.skinColors[ap.skin] = v)
                  }
                />
                <input
                  class="ctl small"
                  bind:value={
                    () => s.skinColors[ap.skin] ?? apTheme,
                    (v) => (s.skinColors[ap.skin] = v)
                  }
                />
                <button
                  class="btn icon"
                  disabled={!(ap.skin in s.skinColors)}
                  onclick={resetColor}
                  title="Reset color">↺</button
                >
              </div>
            {:else}
              <div class="prev-body">
                <div class="prev-rail">
                  <span class="vcap">Size</span>
                  <input
                    class="vrange"
                    type="range"
                    min="10"
                    max="32"
                    bind:value={ap.labelSize}
                    aria-label="Text size"
                  />
                  <span class="vlabel">{ap.labelSize}px</span>
                </div>
                <div class="text-stage">
                  <div
                    class="orb"
                    bind:this={previewBox}
                    style:width="{previewDiameter()}px"
                    style:height="{previewDiameter()}px"
                    style:opacity={ap.opacity}
                  ></div>
                  <div
                    class="text-sample"
                    style:font-family={ap.font}
                    style:top="{8 + previewDiameter() + (ap.textOffsetY ?? 0) * skinScale()}px"
                    style:transform="translate(-50%, 0) translate({(ap.textOffsetX ??
                      0) * skinScale()}px, 0)"
                  >
                      <div
                        class="ts-big"
                        style:color={ap.textColor}
                        style:font-size="{ap.labelSize * textScale()}px"
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
                        style:color={ap.textColor}
                        style:font-size="{ap.subSize * textScale()}px"
                      >
                        {[ap.showPomodoro && "24:18", ap.showSessions && "[2]"]
                          .filter(Boolean)
                          .join("  ")}
                      </div>
                  </div>
                </div>
                <div class="prev-rail">
                  <span class="vcap">Sub</span>
                  <input
                    class="vrange"
                    type="range"
                    min="6"
                    max="24"
                    bind:value={ap.subSize}
                    aria-label="Bottom text size"
                  />
                  <span class="vlabel">{ap.subSize}px</span>
                </div>
              </div>
              <div class="orb-color">
                <input type="color" class="swatch" bind:value={ap.textColor} />
                <input class="ctl small" bind:value={ap.textColor} />
                <button
                  class="btn icon"
                  disabled={(ap.textColor || "").toLowerCase() === "#ffffff"}
                  onclick={() => (ap.textColor = "#FFFFFF")}
                  title="Reset color">↺</button
                >
              </div>
            {/if}
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
          {:else}
            <div class="psg text-controls">
              <div class="fontdd" class:open={fontOpen}>
                <button
                  type="button"
                  class="ctl fontdd-btn"
                  style:font-family={ap.font}
                  onclick={() => {
                    fontOpen = !fontOpen;
                    fontSearch = "";
                  }}
                >
                  <span class="fontdd-cur">{ap.font}</span>
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
                          class:sel={ap.font === f}
                          style:font-family={f}
                          role="button"
                          tabindex="0"
                          onclick={() => {
                            ap.font = f;
                            fontOpen = false;
                          }}
                          onkeydown={(e) =>
                            e.key === "Enter" &&
                            ((ap.font = f), (fontOpen = false))}
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
              <label class="chk"
                ><input type="checkbox" bind:checked={ap.showPhaseLabel} />Phase
                label</label
              >
              <label class="chk"
                ><input
                  type="checkbox"
                  bind:checked={ap.showPhaseCountdown}
                />Phase countdown</label
              >
              <label class="chk"
                ><input
                  type="checkbox"
                  bind:checked={ap.showPomodoro}
                />Pomodoro time</label
              >
              <label class="chk"
                ><input type="checkbox" bind:checked={ap.showSessions} />Long
                break</label
              >
            </div>
          {/if}
        </div>

        {#if apSub === "skin"}
          {#if mode === "work"}
            <div class="card timers">
              <div class="row">
                <label>From right edge (px)</label>
                <Stepper
                  bind:value={ap.posRight}
                  min={0}
                  max={3000}
                  step={10}
                />
              </div>
              <div class="row">
                <label>From top edge (px)</label>
                <Stepper bind:value={ap.posTop} min={0} max={3000} step={10} />
              </div>
            </div>
          {/if}
        {/if}

        {#if apSub === "text"}
          <div class="card timers">
            <div class="row">
              <label>Horizontal offset (px)</label>
              <Stepper
                bind:value={ap.textOffsetX}
                min={-1000}
                max={1000}
                step={10}
              />
            </div>
            <div class="row">
              <label>Vertical offset (px)</label>
              <Stepper
                bind:value={ap.textOffsetY}
                min={-1000}
                max={1000}
                step={10}
              />
            </div>
          </div>
        {/if}
      </div>

      <!-- ===== BEHAVIOR ===== -->
    {:else if pane === "behavior"}
      <div class="pane">
        <div class="card">
          <div class="ch">General</div>
          <label class="chk"
            ><input
              type="checkbox"
              bind:checked={s.behavior.startOnBoot}
            />Start on boot</label
          >
          <label class="chk"
            ><input
              type="checkbox"
              bind:checked={s.behavior.chimeOnTransitions}
            />Chime on transitions</label
          >
        </div>
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
      </div>

      <!-- ===== ABOUT ===== -->
    {:else if pane === "about"}
      <div class="pane">
        <div class="card">
          <div class="about-center">
            <img
              src="/img/breathpause-128.png"
              alt="BreathPause"
              class="about-logo"
            />
            <div class="about-name">BreathPause</div>
            <div class="about-ver">Version {version}</div>
            <div class="about-tag">
              An always-on-top breathing bubble. Sits in the corner and
              breathes quietly while you work, then guides you through a
              breathing break when the pomodoro timer runs out.
            </div>
          </div>
          <div class="ch">Info</div>
          <div class="row">
            <span class="rowlabel">Made by</span><span class="ctl static"
              >Markus Wildgruber</span
            >
          </div>
          <div class="row">
            <span class="rowlabel">License</span><span class="ctl static"
              >MIT — © 2026 Markus Wildgruber</span
            >
          </div>
          <div class="ch">Credits</div>
          <div class="credits">
            <div class="row credit-row">
              <span class="rowlabel">“Cute Bear”, “Sweet Jelly”</span>
              <span>
                adapted from
                <button
                  class="linklike"
                  onclick={() => openExternal("https://www.svgrepo.com")}
                  >SVG Repo</button
                > artwork (SVG Repo License)
              </span>
            </div>
            <div class="row credit-row">
              <span class="rowlabel">“Sleepy Seal”</span>
              <span>
                derived from public-domain art on
                <button
                  class="linklike"
                  onclick={() => openExternal("https://openclipart.org")}
                  >openclipart</button
                >
              </span>
            </div>
            <div class="row credit-row">
              <span class="rowlabel">Full attributions</span>
              <span>CREDITS.md in the repository</span>
            </div>
          </div>
          <div class="about-social">
            <button
              class="social-btn"
              title="GitHub"
              aria-label="GitHub"
              onclick={() =>
                openExternal(
                  "https://github.com/Markus-Wildgruber/breathpause",
                )}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z"
                />
              </svg>
            </button>
            <button
              class="social-btn"
              title="Instagram"
              aria-label="Instagram"
              onclick={() =>
                openExternal("https://www.instagram.com/breathe.nice/")}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <rect x="2" y="2" width="20" height="20" rx="5.5" />
                <circle cx="12" cy="12" r="4.2" />
                <circle
                  cx="17.6"
                  cy="6.4"
                  r="1.2"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
            </button>
          </div>
        </div>
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
    --accent: #4fc3f7;
    --accentFg: #06222c;
    --line: rgba(255, 255, 255, 0.1);
    --field: rgba(255, 255, 255, 0.07);
    --cardbg: rgba(255, 255, 255, 0.04);
    --railSel: var(--accent);
    --railSelFg: #06222c;
    --seg: rgba(255, 255, 255, 0.08);
    --segSel: rgba(255, 255, 255, 0.92);
    --segSelFg: #1a1a1f;
  }
  .win[data-theme="light"] {
    --card: #f3f3f6;
    --pane: #fbfbfd;
    --bar: #e7e7ee;
    --rail: #ececf2;
    --fore: #1a1a1f;
    --muted: #5a5a63;
    --accent: #0a6cc9;
    --accentFg: #ffffff;
    --line: rgba(0, 0, 0, 0.1);
    --field: #ffffff;
    --cardbg: #ffffff;
    --railSel: #0a6cc9;
    --railSelFg: #ffffff;
    --seg: #e2e2ea;
    --segSel: #ffffff;
    --segSelFg: #1a1a1f;
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
  .pane h2 {
    margin: 2px 0 0;
    font-size: 18px;
    font-weight: 600;
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
    height: 264px; /* fixed so Skin/Text tabs are identical — nothing jumps on switch */
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
  .row label,
  .row .rowlabel {
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
  .ctl.static {
    border-style: dashed;
    color: var(--muted);
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

  .chk {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 9px 0;
    color: var(--fore);
    cursor: pointer;
  }
  .chk input {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
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
  .preview-left {
    flex: 3;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .apsubseg.in-card {
    margin: 12px auto 8px;
    max-width: none;
    width: auto;
  }
  .apsubseg.in-card button {
    height: 34px;
    padding: 0 28px;
    font-size: 14px;
  }
  .prev-body {
    display: flex;
    align-items: stretch;
    flex: 1;
    height: 170px; /* fixed: a max-size skin clips instead of growing the preview */
    overflow: hidden;
  }
  .prev-textbody {
    display: flex;
    align-items: stretch;
    flex: 1;
    min-height: 150px;
  }
  .orbside {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 14px 0;
  }
  .orb {
    display: grid;
    place-items: center;
  }
  .orb-color {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    padding: 10px 12px 12px;
  }
  .orb-color input.ctl.small {
    width: 120px;
  }
  .tq-phases {
    display: flex;
    gap: 6px;
  }
  .tq-phases input.ctl {
    flex: 1;
    width: auto;
    min-width: 0;
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
  .prev-rail {
    flex: none;
    width: 60px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 6px;
  }
  .vcap {
    font-size: 10.5px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .vrange {
    writing-mode: vertical-lr;
    direction: rtl;
    width: 6px;
    flex: 1;
    min-height: 90px;
    accent-color: var(--accent);
  }
  .vlabel {
    font-size: 11px;
    color: var(--fore);
    white-space: nowrap;
  }

  /* skin picker: right 2/5 of the preview card, behind a divider line */
  .psg {
    flex: 2;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    align-content: flex-start;
    padding: 12px;
    border-left: 1px solid var(--line);
    overflow-y: auto;
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
      rgba(79, 195, 247, 0.09),
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
    flex: 1;
    position: relative;
    height: 170px;
    overflow: hidden;
  }
  .text-stage .orb {
    position: absolute;
    left: 50%;
    top: 8px; /* skin top-anchored; its bottom = 8 + height, which the text is measured from */
    transform: translateX(-50%);
  }
  .text-sample {
    position: absolute;
    left: 50%;
    /* top is set inline: skin-bottom + offsetY (scaled) — tracks the skin's bottom */
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 1px;
  }
  .ts-big {
    font-weight: 600;
  }
  .ts-small {
    font-size: 12px;
    color: var(--muted);
  }
  .text-controls {
    display: flex;
    flex-direction: column;
    flex-wrap: nowrap;
    gap: 10px;
    align-content: stretch;
    overflow-y: auto;
  }
  .text-controls .chk {
    margin: 0;
  }
  .text-controls .sliderwrap {
    flex: none;
    max-width: none;
    width: 100%;
  }
  .tq-slider {
    max-width: none;
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
    margin: 0 auto 14px;
    max-width: 200px;
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

  /* patterns: pattern selects + phase-label text fields combined in one card,
     two columns split by a divider (like the appearance preview card) */
  /* pattern tiles mirror the skins gallery: Work/Break assign buttons per tile */
  .pat-gitem {
    cursor: default;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .pat-gitem:hover .skin-bin {
    opacity: 1;
  }
  .pat-main {
    cursor: pointer;
    flex: 1;
    padding-right: 24px; /* room for the delete bin */
  }
  .pat-modes {
    display: flex;
    gap: 6px;
    margin-top: 12px;
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
  .editor-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }

  /* skin gallery */
  .skin-gallery {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
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
    height: 110px;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 8px;
    background: radial-gradient(
      circle at 50% 44%,
      rgba(79, 195, 247, 0.09),
      transparent 70%
    );
  }
  .skin-modes {
    display: flex;
    gap: 6px;
    padding: 8px 14px 0;
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
  .credits {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.55;
  }
  .credits .credit-row {
    margin: 6px 0;
  }
  .credits .credit-row .rowlabel {
    font-style: italic;
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
  .about-social {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-top: 12px;
  }
  .social-btn {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 9px;
    border: 1px solid var(--line);
    background: var(--field);
    color: var(--muted);
    cursor: pointer;
  }
  .social-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
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
</style>
