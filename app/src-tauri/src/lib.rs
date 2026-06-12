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

fn toggle_bubble(app: &AppHandle) {
  if let Some(win) = app.get_webview_window("bubble") {
    if win.is_visible().unwrap_or(true) {
      let _ = win.hide();
    } else {
      let _ = win.show();
    }
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
    .title("breathpause — settings")
    .inner_size(760.0, 640.0)
    .decorations(true)
    .resizable(false)
    .center()
    .visible(false)   // shown by the frontend after the saved position is restored (no flash)
    .icon(icon)?
    .build()?;
  Ok(())
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
  .icon(icon) else { return };
  let _ = builder.build();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    // Single instance: a second launch focuses the running bubble and exits.
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(win) = app.get_webview_window("bubble") {
        let _ = win.show();
        let _ = win.set_focus();
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

      let toggle = MenuItem::with_id(app, "toggle", "Show / Hide", true, None::<&str>)?;
      let pause = MenuItem::with_id(app, "pause", "Pause / Resume", true, None::<&str>)?;
      let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
      let sep = PredefinedMenuItem::separator(app)?;
      let quit = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&toggle, &pause, &settings, &sep, &quit])?;

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
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            toggle_bubble(tray.app_handle());
          }
        })
        .build(app)?;

      // JS exit button
      let h_quit = app.handle().clone();
      app.listen_any("app-quit", move |_| h_quit.exit(0));

      // Rebuild tray menu with translated labels when settings are saved
      let h_tray = app.handle().clone();
      app.listen_any("apply-tray-text", move |event| {
        let Ok(payload) = serde_json::from_str::<TrayTextPayload>(event.payload()) else {
          return;
        };
        let h = h_tray.clone();
        let h2 = h.clone();
        let _ = h.run_on_main_thread(move || {
          let h = &h2;
          let Ok(toggle) = MenuItem::with_id(h, "toggle", "Show / Hide", true, None::<&str>) else { return };
          let Ok(pause_item) = MenuItem::with_id(h, "pause", &payload.pause, true, None::<&str>) else { return };
          let Ok(settings_item) = MenuItem::with_id(h, "settings", &payload.settings, true, None::<&str>) else { return };
          let Ok(sep) = PredefinedMenuItem::separator(h) else { return };
          let Ok(quit_item) = MenuItem::with_id(h, "quit", &payload.exit, true, None::<&str>) else { return };
          let Ok(menu) = Menu::with_items(h, &[&toggle, &pause_item, &settings_item, &sep, &quit_item]) else { return };
          if let Some(tray) = h.tray_by_id("main") {
            let _ = tray.set_menu(Some(menu));
          }
        });
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
