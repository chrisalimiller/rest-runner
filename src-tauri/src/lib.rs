#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Sends HTTP requests from Rust so the app is not limited by browser CORS rules.
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running REST Runner");
}
