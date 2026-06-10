use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder,
};

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
  let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
    .title("breathpause — settings")
    .inner_size(720.0, 576.0)
    .decorations(false)
    .build();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // tray: left-click toggles the bubble; right-click menu like the old app
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

      // settings window's Exit button
      let handle = app.handle().clone();
      app.listen_any("app-quit", move |_| handle.exit(0));

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
