mod http;

/// Sends one request without following redirects (see src/lib/http.ts).
#[tauri::command]
async fn http_send(
    state: tauri::State<'_, http::HttpState>,
    request: http::HttpRequest,
) -> Result<http::HttpResponse, String> {
    state.send(request).await
}

/// Aborts a call started by `http_send`.
#[tauri::command]
fn http_cancel(state: tauri::State<'_, http::HttpState>, id: String) {
    state.cancel(&id);
}

/// Writes a report file to the path the user picked in the Save dialog.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Could not save {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(http::HttpState::new().expect("could not start the HTTP client"))
        .invoke_handler(tauri::generate_handler![write_text_file, http_send, http_cancel])
        .setup(|_app| {
            #[cfg(windows)]
            if let Some(window) = tauri::Manager::get_webview_window(_app, "main") {
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
