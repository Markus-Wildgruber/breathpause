use std::sync::Mutex;
use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
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

// Live tray state + handles so the toggle/pause labels can flip with the app's state.
struct TrayState {
  visible: bool,
  paused: bool,
  pause_label: String,
  resume_label: String,
}
struct Tray {
  toggle: MenuItem<tauri::Wry>,
  pause: MenuItem<tauri::Wry>,
  settings: MenuItem<tauri::Wry>,
  exit: MenuItem<tauri::Wry>,
  state: Mutex<TrayState>,
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

fn open_settings(app: &AppHandle) {
  if let Some(win) = app.get_webview_window("settings") {
    let _ = win.show();
    let _ = win.set_focus();
    return;
  }
  let _ = build_settings(app);
}

fn build_settings(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
  let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/favicon.ico"))?;
  WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
    .title("BreathPause")
    .inner_size(760.0, 640.0)
    .decorations(true)
    .resizable(false)
    .center()
    .visible(false)   // shown by the frontend after the saved position is restored (no flash)
    .icon(icon)?
    .build()?;
  Ok(())
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
  .icon(icon) else { return };
  let _ = builder.build();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![capture_monitor])
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    // Single instance: a second launch focuses the running bubble and exits.
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(win) = app.get_webview_window("bubble") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit_to("bubble", "visibility-changed", true);
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
      let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
      let sep = PredefinedMenuItem::separator(app)?;
      let quit = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&toggle, &pause, &settings, &sep, &quit])?;

      app.manage(Tray {
        toggle: toggle.clone(),
        pause: pause.clone(),
        settings: settings.clone(),
        exit: quit.clone(),
        state: Mutex::new(TrayState {
          visible: true,
          paused: false,
          pause_label: "Pause".into(),
          resume_label: "Resume".into(),
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
          "settings" => open_settings(app),
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

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
