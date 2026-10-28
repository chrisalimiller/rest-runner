mod certs;
mod http;
#[cfg(test)]
mod tls_tests;

use std::sync::Arc;

use tauri::Manager;

/// Sends one request without following redirects (see src/lib/http.ts).
#[tauri::command]
async fn http_send(
    state: tauri::State<'_, Arc<http::HttpState>>,
    request: http::HttpRequest,
) -> Result<http::HttpResponse, String> {
    state.inner().send(request).await
}

/// Aborts a call started by `http_send`.
#[tauri::command]
fn http_cancel(state: tauri::State<'_, Arc<http::HttpState>>, id: String) {
    state.cancel(&id);
}

/// Checks and copies the picked certificate files into the app's data folder (see src/certs.rs).
#[tauri::command]
async fn cert_import(
    certs: tauri::State<'_, Arc<certs::CertStore>>,
    http: tauri::State<'_, Arc<http::HttpState>>,
    request: certs::ImportRequest,
) -> Result<certs::Imported, String> {
    let store = certs.inner().clone();
    let imported = tauri::async_runtime::spawn_blocking(move || store.import(&request))
        .await
        .map_err(|e| e.to_string())?;
    http.clear_clients();
    imported
}

/// Replaces the passphrase kept in the system keychain, after checking it opens the certificate.
#[tauri::command]
async fn cert_set_passphrase(
    certs: tauri::State<'_, Arc<certs::CertStore>>,
    http: tauri::State<'_, Arc<http::HttpState>>,
    id: String,
    passphrase: String,
) -> Result<(), String> {
    let store = certs.inner().clone();
    let done = tauri::async_runtime::spawn_blocking(move || store.set_passphrase(&id, &passphrase))
        .await
        .map_err(|e| e.to_string())?;
    http.clear_clients();
    done
}

/// Reads an entry's files and passphrase, for a workspace export that includes them.
#[tauri::command]
fn cert_export(certs: tauri::State<'_, Arc<certs::CertStore>>, id: String) -> Result<certs::ExportedFiles, String> {
    certs.export_files(&id)
}

/// Removes an imported certificate's files and passphrase.
#[tauri::command]
fn cert_delete(
    certs: tauri::State<'_, Arc<certs::CertStore>>,
    http: tauri::State<'_, Arc<http::HttpState>>,
    id: String,
) {
    certs.delete(&id);
    http.clear_clients();
}

/// Writes a report file to the path the user picked in the Save dialog.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Could not save {path}: {e}"))
}

/// The macOS menu bar without Close Window. Tauri's default menu binds Cmd+W to Close Window,
/// which the system handles before the page sees the key, so the app could not use Cmd+W to
/// close a request tab. The red window button and Cmd+Q still close the window and quit.
/// Cmd+T is free in the default menu, so nothing else changes.
#[cfg(target_os = "macos")]
fn app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

    let name = app.package_info().name.clone();
    let app_menu = Submenu::with_items(
        app,
        name,
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    // Copy, paste and the rest only work in the page through these items.
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view_menu = Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?],
    )?;
    Menu::with_items(app, &[&app_menu, &edit_menu, &view_menu, &window_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(|app| app_menu(app));
    builder
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            write_text_file,
            http_send,
            http_cancel,
            cert_import,
            cert_set_passphrase,
            cert_export,
            cert_delete
        ])
        .setup(|app| {
            let dir = app.path().app_data_dir()?.join("certificates");
            let store = Arc::new(certs::CertStore::new(dir, Arc::new(certs::Keychain)));
            app.manage(store.clone());
            app.manage(Arc::new(http::HttpState::new(store)));
            #[cfg(windows)]
            if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                title_bar::paint(&window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running REST Runner");
}

/// Colors the native Windows title bar like the app's top bar (GitHub dark).
/// Needs Windows 11; on Windows 10 the calls fail quietly and the dark theme's title bar stays.
#[cfg(windows)]
mod title_bar {
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
    };

    /// COLORREF is 0x00BBGGRR.
    const fn colorref(rgb: u32) -> u32 {
        ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)
    }

    const CAPTION: u32 = colorref(0x010409); // --bg-inset, the top bar background
    const TEXT: u32 = colorref(0xe6edf3); // --text
    const BORDER: u32 = colorref(0x21262d); // --border-muted, the top bar's bottom border

    pub fn paint(window: &tauri::WebviewWindow) {
        let Ok(hwnd) = window.hwnd() else { return };
        for (attribute, color) in [
            (DWMWA_CAPTION_COLOR, CAPTION),
            (DWMWA_TEXT_COLOR, TEXT),
            (DWMWA_BORDER_COLOR, BORDER),
        ] {
            unsafe {
                DwmSetWindowAttribute(
                    hwnd.0 as _,
                    attribute as _,
                    &color as *const u32 as *const _,
                    std::mem::size_of::<u32>() as u32,
                );
            }
        }
    }
}
