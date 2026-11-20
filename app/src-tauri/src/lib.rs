use std::sync::Mutex;
use tauri::{
  menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder,
};

#[derive(serde::Deserialize)]
struct TrayTextPayload {
  pause: String,
  resume: String,
  settings: String,
  exit: String,
}

#[derive(serde::Deserialize)]
struct PausedPayload {
  paused: bool,
}

#[derive(serde::Deserialize)]
struct MusicPayload {
  on: bool,
}

#[derive(serde::Deserialize)]
struct UpdatePayload {
  version: String,
}

// Live tray state + handles so the toggle/pause labels can flip with the app's state.
struct TrayState {
  visible: bool,
  paused: bool,
  pause_label: String,
  resume_label: String,
  update_shown: bool,
}
struct Tray {
  menu: Menu<tauri::Wry>,
  toggle: MenuItem<tauri::Wry>,
  pause: MenuItem<tauri::Wry>,
  music: CheckMenuItem<tauri::Wry>,
  update: MenuItem<tauri::Wry>, // in the menu only once an update is known
  settings: MenuItem<tauri::Wry>,
  exit: MenuItem<tauri::Wry>,
  state: Mutex<TrayState>,
}

// The tray icon with a pink dot in its top-right corner: "an update is available".
// Drawn from the normal icon so there is no second image file to keep in sync.
fn dotted_tray_icon() -> Option<tauri::image::Image<'static>> {
  let base = tauri::image::Image::from_bytes(include_bytes!("../icons/favicon.ico")).ok()?;
  let (w, h) = (base.width() as i32, base.height() as i32);
  let mut px = base.rgba().to_vec();
  let r = (w.min(h) as f32 * 0.24).max(2.0);
  let (cx, cy) = (w as f32 - r - 0.5, r + 0.5);
  for y in 0..h {
    for x in 0..w {
      let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
      if d <= r {
        let i = ((y * w + x) * 4) as usize;
        px[i..i + 4].copy_from_slice(&[0xd4, 0x57, 0x7f, 0xff]); // pink #d4577f
      }
    }
  }
  Some(tauri::image::Image::new_owned(px, w as u32, h as u32))
}

// Installed (NSIS installer, winget, macOS .app) or the standalone exe. Only installed copies
// may run the updater: on a standalone exe it would install a second copy beside it.
#[tauri::command]
fn install_kind() -> &'static str {
  #[cfg(windows)]
  {
    // The NSIS installer puts its uninstaller next to the app's exe; the standalone has none.
    let installed = std::env::current_exe()
      .ok()
      .and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").exists()))
      .unwrap_or(false);
    if installed { "installed" } else { "standalone" }
  }
  #[cfg(target_os = "macos")]
  {
    "installed"
  }
  #[cfg(not(any(windows, target_os = "macos")))]
  {
    "standalone"
  }
}

fn refresh_toggle(app: &AppHandle) {
  if let Some(tray) = app.try_state::<Tray>() {
    let label = if tray.state.lock().unwrap().visible { "Hide" } else { "Show" };
    let _ = tray.toggle.set_text(label);
  }
}
fn refresh_pause(app: &AppHandle) {
  if let Some(tray) = app.try_state::<Tray>() {
    let st = tray.state.lock().unwrap();
    let _ = tray.pause.set_text(if st.paused { &st.resume_label } else { &st.pause_label });
  }
}

fn toggle_bubble(app: &AppHandle) {
  if let Some(win) = app.get_webview_window("bubble") {
    let visible = win.is_visible().unwrap_or(true);
    if visible {
      let _ = win.hide();
    } else {
      let _ = win.show();
    }
    // A hidden bubble puts the pomodoro on hold: the frontend pauses/resumes on this.
    let _ = app.emit_to("bubble", "visibility-changed", !visible);
    if let Some(tray) = app.try_state::<Tray>() {
      tray.state.lock().unwrap().visible = !visible;
    }
    refresh_toggle(app);
  }
}

// WebView2 flags for every window. All windows share one browser environment, and a window
// asking for different flags fails to open, so this must match the bubble's
// additionalBrowserArgs in tauri.conf.json (a test checks). wry's defaults are repeated
// because setting any args replaces them; the autoplay policy lets remembered breathing
// music start after a restart without a click.
const BROWSER_ARGS: &str =
  "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

fn open_settings(app: &AppHandle) {
  open_settings_on(app, None);
}

// Opens settings on a given pane (the tray's "Update to …" item opens About).
fn open_settings_on(app: &AppHandle, pane: Option<&str>) {
  if let Some(win) = app.get_webview_window("settings") {
    if let Some(p) = pane {
      let _ = app.emit_to("settings", "show-pane", p);
    }
    let _ = win.show();
    let _ = win.set_focus();
    return;
  }
  let _ = build_settings(app, pane);
}

fn build_settings(app: &AppHandle, pane: Option<&str>) -> Result<(), Box<dyn std::error::Error>> {
  let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/favicon.ico"))?;
  // `--pane <id>` (CI smoke tests / deep links) opens settings on a specific pane.
  // Validate against the known panes so an arbitrary value can't be spliced into the URL.
  const PANES: [&str; 6] = ["appearance", "patterns", "timers", "skins", "behavior", "about"];
  let args: Vec<String> = std::env::args().collect();
  let from_args = args.iter().position(|a| a == "--pane").and_then(|i| args.get(i + 1)).map(|s| s.as_str());
  let url = match pane.or(from_args) {
    Some(p) if PANES.contains(&p) => format!("settings.html?pane={p}"),
    _ => "settings.html".into(),
  };
  WebviewWindowBuilder::new(app, "settings", WebviewUrl::App(url.into()))
    .title("BreathPause")
    .inner_size(760.0, 640.0)
    .decorations(true)
    .resizable(false)
    .center()
    .visible(false)   // shown by the frontend after the saved position is restored (no flash)
    .additional_browser_args(BROWSER_ARGS)
    .icon(icon)?
    .build()?;
  Ok(())
}

// Parsed launch hooks for the frontend. Returns only the recognized options rather
// than exposing the raw argv to the webview.
#[derive(serde::Serialize)]
struct LaunchOptions {
  apply_settings: Option<String>,
  open_settings: bool,
}

#[tauri::command]
fn launch_options() -> LaunchOptions {
  let args: Vec<String> = std::env::args().collect();
  LaunchOptions {
    apply_settings: args
      .iter()
      .position(|a| a == "--apply-settings")
      .and_then(|i| args.get(i + 1))
      .cloned(),
    open_settings: args.iter().any(|a| a == "--settings"),
  }
}

// Screenshot of the monitor containing the (physical, global) point — downscaled and
// PNG-encoded. The break overlay shows it CSS-blurred as its "frosted" background:
// unlike the acrylic window effect, a blurred image survives focus loss and renders
// the same on every monitor.
#[tauri::command]
async fn capture_monitor(x: i32, y: i32) -> Result<tauri::ipc::Response, String> {
  #[cfg(any(windows, target_os = "macos"))]
  {
    let monitor = xcap::Monitor::from_point(x, y).map_err(|e| e.to_string())?;
    let img = monitor.capture_image().map_err(|e| e.to_string())?;
    // The overlay blurs it anyway — half size keeps PNG encode + IPC fast.
    let img = image::imageops::resize(
      &img,
      (img.width() / 2).max(1),
      (img.height() / 2).max(1),
      image::imageops::FilterType::Triangle,
    );
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(img)
      .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
      .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(png))
  }
  #[cfg(not(any(windows, target_os = "macos")))]
  {
    let _ = (x, y);
    Err("screen capture not supported on this platform".into())
  }
}

// The session's own lock flag. (Checking whether the input desktop is reachable misses
// the first seconds of a lock on Windows 11: the lock-screen curtain is on the user desktop.)
#[cfg(windows)]
fn screen_locked() -> bool {
  use windows_sys::Win32::System::RemoteDesktop::{
    WTSFreeMemory, WTSQuerySessionInformationW, WTSSessionInfoEx, WTSINFOEXW,
    WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION, WTS_SESSIONSTATE_LOCK,
  };
  unsafe {
    let mut buf = std::ptr::null_mut();
    let mut len = 0;
    if WTSQuerySessionInformationW(
      WTS_CURRENT_SERVER_HANDLE,
      WTS_CURRENT_SESSION,
      WTSSessionInfoEx,
      &mut buf,
      &mut len,
    ) == 0
    {
      return false;
    }
    let info = &*(buf as *const WTSINFOEXW);
    let locked =
      info.Level == 1 && info.Data.WTSInfoExLevel1.SessionFlags == WTS_SESSIONSTATE_LOCK as i32;
    WTSFreeMemory(buf.cast());
    locked
  }
}

fn open_pattern_editor(app: &AppHandle) {
  if let Some(win) = app.get_webview_window("pattern-editor") {
    let _ = win.show();
    let _ = win.set_focus();
    return;
  }
  let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/favicon.ico")) else { return };
  let Ok(builder) = WebviewWindowBuilder::new(
    app,
    "pattern-editor",
    WebviewUrl::App("pattern-editor.html".into()),
  )
  .title("breathpause — pattern")
  .inner_size(460.0, 500.0)
  .decorations(true)
  .resizable(false)
  .center()
  .visible(false)   // shown by the frontend after the saved position is restored (no flash)
  .additional_browser_args(BROWSER_ARGS)
  .icon(icon) else { return };
  let _ = builder.build();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![capture_monitor, launch_options, install_kind])
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init()) // relaunch after an update
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    // Single instance: a second launch focuses the running bubble and exits.
    .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
      if let Some(win) = app.get_webview_window("bubble") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit_to("bubble", "visibility-changed", true);
      }
      if args.iter().any(|a| a == "--settings") {
        open_settings(app);
      }
    }))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Labels start at the bubble's initial state: visible (Hide) and running (Pause).
      let toggle = MenuItem::with_id(app, "toggle", "Hide", true, None::<&str>)?;
      let pause = MenuItem::with_id(app, "pause", "Pause", true, None::<&str>)?;
      // Checked state comes from the bubble (music-changed), which owns the setting.
      let music = CheckMenuItem::with_id(app, "music", "Music", true, false, None::<&str>)?;
      let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
      let sep = PredefinedMenuItem::separator(app)?;
      let quit = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&toggle, &pause, &music, &settings, &sep, &quit])?;
      // Inserted above "Settings…" when the bubble finds an update (update-available).
      let update = MenuItem::with_id(app, "update", "Update…", true, None::<&str>)?;

      app.manage(Tray {
        menu: menu.clone(),
        toggle: toggle.clone(),
        pause: pause.clone(),
        music: music.clone(),
        update,
        settings: settings.clone(),
        exit: quit.clone(),
        state: Mutex::new(TrayState {
          visible: true,
          paused: false,
          pause_label: "Pause".into(),
          resume_label: "Resume".into(),
          update_shown: false,
        }),
      });

      TrayIconBuilder::with_id("main")
        .icon(tauri::image::Image::from_bytes(include_bytes!(
          "../icons/favicon.ico"
        ))?)
        .tooltip("breathpause")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
          "toggle" => toggle_bubble(app),
          "pause" => {
            let _ = app.emit_to("bubble", "toggle-pause", ());
          }
          "music" => {
            let _ = app.emit_to("bubble", "toggle-music", ());
          }
          "settings" => open_settings(app),
          "update" => open_settings_on(app, Some("about")),
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
          TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } => toggle_bubble(tray.app_handle()),
          TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
          } => open_settings(tray.app_handle()),
          _ => {}
        })
        .build(app)?;

      // JS exit button
      let h_quit = app.handle().clone();
      app.listen_any("app-quit", move |_| h_quit.exit(0));

      // Update tray labels (in place) when settings are saved. Pause/Resume words are stored
      // so the dynamic pause label uses them; the toggle (Show/Hide) stays state-driven.
      let h_tray = app.handle().clone();
      app.listen_any("apply-tray-text", move |event| {
        let Ok(payload) = serde_json::from_str::<TrayTextPayload>(event.payload()) else {
          return;
        };
        let h2 = h_tray.clone();
        let _ = h_tray.run_on_main_thread(move || {
          if let Some(tray) = h2.try_state::<Tray>() {
            {
              let mut st = tray.state.lock().unwrap();
              st.pause_label = payload.pause.clone();
              st.resume_label = payload.resume.clone();
            }
            let _ = tray.settings.set_text(&payload.settings);
            let _ = tray.exit.set_text(&payload.exit);
          }
          refresh_pause(&h2);
        });
      });

      // The bubble reports its pause state so the menu can show Pause vs Resume.
      let h_paused = app.handle().clone();
      app.listen_any("paused-changed", move |event| {
        let Ok(payload) = serde_json::from_str::<PausedPayload>(event.payload()) else {
          return;
        };
        let h2 = h_paused.clone();
        let _ = h_paused.run_on_main_thread(move || {
          if let Some(tray) = h2.try_state::<Tray>() {
            tray.state.lock().unwrap().paused = payload.paused;
          }
          refresh_pause(&h2);
        });
      });

      // The bubble reports music on/off (bubble button, tray, settings) for the check mark.
      let h_music = app.handle().clone();
      app.listen_any("music-changed", move |event| {
        let Ok(payload) = serde_json::from_str::<MusicPayload>(event.payload()) else {
          return;
        };
        let h2 = h_music.clone();
        let _ = h_music.run_on_main_thread(move || {
          if let Some(tray) = h2.try_state::<Tray>() {
            let _ = tray.music.set_checked(payload.on);
          }
        });
      });

      // The bubble found an update: add "Update to x.y.z…" to the menu and dot the tray icon.
      let h_upd = app.handle().clone();
      app.listen_any("update-available", move |event| {
        let Ok(payload) = serde_json::from_str::<UpdatePayload>(event.payload()) else {
          return;
        };
        let h2 = h_upd.clone();
        let _ = h_upd.run_on_main_thread(move || {
          let Some(tray) = h2.try_state::<Tray>() else { return };
          let _ = tray.update.set_text(format!("Update to {}…", payload.version));
          let mut st = tray.state.lock().unwrap();
          if st.update_shown {
            return;
          }
          st.update_shown = true;
          let _ = tray.menu.insert(&tray.update, 3); // above "Settings…"
          if let (Some(icon), Some(t)) = (dotted_tray_icon(), h2.tray_by_id("main")) {
            let _ = t.set_icon(Some(icon));
          }
        });
      });

      // Hide/show the bubble when the frontend asks (the global Hide hotkey)
      let h_tb = app.handle().clone();
      app.listen_any("toggle-bubble", move |_| {
        let h = h_tb.clone();
        let h2 = h.clone();
        let _ = h.run_on_main_thread(move || toggle_bubble(&h2));
      });

      // Open settings when the bubble emits open-settings (double-click in drag mode)
      let h_os = app.handle().clone();
      app.listen_any("open-settings", move |_| {
        let h = h_os.clone();
        let h2 = h.clone();
        let _ = h.run_on_main_thread(move || open_settings(&h2));
      });

      // Open the pattern-editor window when the settings pane requests it
      let h_pe = app.handle().clone();
      app.listen_any("open-pattern-editor", move |_| {
        let h = h_pe.clone();
        let h2 = h.clone();
        let _ = h.run_on_main_thread(move || open_pattern_editor(&h2));
      });

      // Tell the bubble when the session locks/unlocks so it can hold the pomodoro.
      // The WebView keeps rendering behind the lock screen, so the frontend can't see it.
      #[cfg(windows)]
      {
        let h_lock = app.handle().clone();
        std::thread::spawn(move || {
          let mut was_locked = false;
          loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let locked = screen_locked();
            if locked != was_locked {
              was_locked = locked;
              let _ = h_lock.emit_to("bubble", "screen-locked", locked);
            }
          }
        });
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
