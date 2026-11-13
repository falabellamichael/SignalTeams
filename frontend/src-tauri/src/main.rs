#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    fs::OpenOptions,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{
    image::Image,
    webview::{NewWindowResponse, PermissionKind, PermissionResponse},
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const APP_URL: &str = "http://127.0.0.1:8075/";
const BOOTSTRAP_URL: &str = "http://tauri.localhost/";
const BACKEND: SocketAddr =
    SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 8075);
const CREATE_NO_WINDOW: u32 = 0x08000000;
const DETACHED_PROCESS: u32 = 0x00000008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
const LOGO_PNG: &[u8] = include_bytes!("../bootstrap/signalteams-logo.png");

#[link(name = "shell32")]
unsafe extern "system" {
    fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
}

/// Hand a URL to the system default browser — the webview denies new windows
/// and external navigations, so OAuth sign-ins and links open outside the app.
fn open_external(url: &str) {
    if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
        return;
    }
    log_event(&format!("open_external -> {url}"));
    // explorer.exe treats its arg as a folder first — long OAuth URLs fall
    // through to a Documents window. FileProtocolHandler goes straight to the
    // registered handler for the scheme (the default browser for http/https).
    let _ = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

fn is_app_origin(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "tauri" | "about" | "data" | "blob" | "ws" | "wss")
        || (matches!(url.scheme(), "http" | "https")
            && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost") | Some("tauri.localhost")))
}

fn log_event(msg: &str) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(r"D:\AgentHive\tauri-debug.log")
    {
        let _ = writeln!(f, "[{ts}] [pid={}] {msg}", std::process::id());
    }
}

/// Terminate any previous signalteams.exe instances (excluding our own PID) so WebView2 locks are freed.
fn cleanup_previous_instances() {
    let my_pid = std::process::id();
    let _ = Command::new("taskkill")
        .args([
            "/F",
            "/FI",
            &format!("PID ne {my_pid}"),
            "/IM",
            "signalteams.exe",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status();
    let _ = Command::new("taskkill")
        .args([
            "/F",
            "/FI",
            &format!("PID ne {my_pid}"),
            "/IM",
            "SignalHive.exe",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

fn backend_ready() -> std::io::Result<bool> {
    let timeout = Duration::from_secs(2);
    let mut stream = TcpStream::connect_timeout(&BACKEND, timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    stream.write_all(
        b"GET /api/auth/config HTTP/1.1\r\nHost: 127.0.0.1:8075\r\nConnection: close\r\n\r\n",
    )?;

    let mut response = String::new();
    stream.take(4096).read_to_string(&mut response)?;
    let Some((headers, body)) = response.split_once("\r\n\r\n") else {
        return Ok(false);
    };
    Ok(headers.starts_with("HTTP/1.1 200 ")
        && serde_json::from_str::<serde_json::Value>(body).is_ok())
}

fn ensure_backend() -> Result<(), String> {
    if backend_ready().unwrap_or(false) {
        log_event("Backend on :8075 is already ready");
        return Ok(());
    }
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let backend_dir = workspace.join("backend");
    let python = backend_dir.join(".venv/Scripts/python.exe");
    let runner = backend_dir.join("run.py");
    if !python.is_file() || !runner.is_file() {
        return Err("The SignalHive backend setup could not be found in backend/.venv.".into());
    }
    log_event("Spawning SignalHive backend on :8075");
    Command::new(python)
        .arg(runner)
        .current_dir(backend_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map_err(|error| format!("Could not start SignalHive backend: {error}"))?;

    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if backend_ready().unwrap_or(false) {
            log_event("Backend on :8075 became ready");
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("SignalHive backend is taking too long to start on :8075.".into());
        }
        thread::sleep(Duration::from_millis(250));
    }
}

fn try_build_window(
    app: &tauri::App,
    config: &tauri::utils::config::WindowConfig,
    titlebar: &str,
    custom_data_dir: Option<PathBuf>,
) -> tauri::Result<WebviewWindow> {
    let icon = Image::from_bytes(LOGO_PNG)?;
    let mut builder = WebviewWindowBuilder::from_config(app, config)?
        .icon(icon)?
        .initialization_script(titlebar)
        // window.open / target=_blank → the user's real browser (OAuth consent,
        // links in chat) — WebView2 denies popups outright otherwise
        .on_new_window(|url, _features| {
            log_event(&format!("on_new_window: {url}"));
            open_external(url.as_str());
            NewWindowResponse::Deny
        })
        // keep the app on its own origin; anything else goes to the browser
        .on_navigation(|url| {
            if is_app_origin(url) {
                true
            } else {
                log_event(&format!("on_navigation blocked: {url}"));
                open_external(url.as_str());
                false
            }
        })
        // voice/video features need mic/cam/screen; grant what the app uses
        .on_permission_request(|_webview, kind| match kind {
            PermissionKind::Microphone
            | PermissionKind::Camera
            | PermissionKind::DisplayCapture
            | PermissionKind::Notifications
            | PermissionKind::ClipboardRead => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .visible(true)
        .focused(true);
    if let Some(dir) = custom_data_dir {
        builder = builder.data_directory(dir);
    }
    builder.build()
}

fn main() {
    std::panic::set_hook(Box::new(|info| {
        log_event(&format!("PANIC: {info}"));
    }));
    log_event("SignalHive main() starting");

    let res = tauri::Builder::default()
        .setup(|app| {
            let config = &app.config().app.windows[0];
            let app_id: Vec<u16> = app.config().identifier.encode_utf16().chain([0]).collect();
            let result = unsafe { SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr()) };
            if result < 0 {
                log_event(&format!("SetCurrentProcessExplicitAppUserModelID failed: {result:#x}"));
            }

            if let Err(err) = ensure_backend() {
                log_event(&format!("ensure_backend error: {err}"));
            }

            let titlebar = include_str!("titlebar.js")
                .replace("__BOOTSTRAP_URL__", BOOTSTRAP_URL)
                .replace("__APP_URL__", APP_URL)
                .replace("__LOGO__", &STANDARD.encode(LOGO_PNG));

            log_event("Building WebviewWindow pointed at http://127.0.0.1:8075/");
            let window = match try_build_window(app, config, &titlebar, None) {
                Ok(w) => w,
                Err(first_err) => {
                    log_event(&format!("First build() attempt failed ({first_err:?}); cleaning up previous instances"));
                    cleanup_previous_instances();
                    thread::sleep(Duration::from_millis(450));
                    match try_build_window(app, config, &titlebar, None) {
                        Ok(w) => w,
                        Err(second_err) => {
                            log_event(&format!(
                                "Second build() attempt failed ({second_err:?}); using isolated data_directory"
                            ));
                            let fallback_dir = env::var_os("LOCALAPPDATA")
                                .map(PathBuf::from)
                                .unwrap_or_else(env::temp_dir)
                                .join("com.falab.signalteams")
                                .join(format!("profile-{}", std::process::id()));
                            try_build_window(app, config, &titlebar, Some(fallback_dir))?
                        }
                    }
                }
            };

            let _ = window.show();
            let _ = window.set_focus();
            log_event("WebviewWindow built and shown");

            window.on_window_event(|event| match event {
                WindowEvent::CloseRequested { .. } => {
                    log_event("WindowEvent::CloseRequested -> exiting process cleanly");
                    std::process::exit(0);
                }
                WindowEvent::Destroyed => {
                    log_event("WindowEvent::Destroyed -> exiting process cleanly");
                    std::process::exit(0);
                }
                WindowEvent::Focused(f) => {
                    log_event(&format!("WindowEvent::Focused({f})"));
                }
                _ => {}
            });

            Ok(())
        })
        .run(tauri::generate_context!());
    if let Err(e) = res {
        log_event(&format!("tauri::Builder::run error: {e:?}"));
    }
    log_event("SignalHive main() exiting");
}
