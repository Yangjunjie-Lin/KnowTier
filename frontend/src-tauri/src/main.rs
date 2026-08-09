use std::{
    error::Error,
    io::{self, BufRead, BufReader, Write},
    net::{Ipv4Addr, SocketAddr, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicU16, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{webview::PageLoadEvent, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const HOST: Ipv4Addr = Ipv4Addr::LOCALHOST;
const SIDECAR_NAME: &str = "cognigraph-desktop-sidecar";
const BOOTSTRAP_TOKEN_ENV: &str = "KNOWTIER_DESKTOP_BOOTSTRAP_TOKEN";
const CONTROL_TOKEN_ENV: &str = "KNOWTIER_DESKTOP_CONTROL_TOKEN";
const PARENT_PID_ENV: &str = "KNOWTIER_DESKTOP_PARENT_PID";
const PORT_ANNOUNCEMENT_PREFIX: &str = "KNOWTIER_DESKTOP_PORT=";
// A cold one-file PyInstaller launch can spend tens of seconds unpacking on a
// clean Windows machine, especially while antivirus scans the embedded archive.
const PORT_ANNOUNCEMENT_TIMEOUT: Duration = Duration::from_secs(120);
const READY_TIMEOUT: Duration = Duration::from_secs(120);
const WINDOW_CREATION_TIMEOUT: Duration = Duration::from_secs(10);
const PAGE_LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

struct DesktopState {
    port: AtomicU16,
    control_token: String,
    child: Mutex<Option<CommandChild>>,
    exited: AtomicBool,
    page_loaded: AtomicBool,
    shutting_down: AtomicBool,
}

fn random_token() -> io::Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| io::Error::other(error.to_string()))?;
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(encoded)
}

fn authenticated_request(
    port: u16,
    method: &str,
    path: &str,
    token: &str,
    read_timeout: Duration,
) -> bool {
    let address = SocketAddr::from((HOST, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(read_timeout));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {HOST}:{port}\r\nAuthorization: Bearer {token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut status_line = String::with_capacity(48);
    let Ok(length) = BufReader::new(stream).read_line(&mut status_line) else {
        return false;
    };
    if length == 0 {
        return false;
    }
    status_line.starts_with("HTTP/1.1 204")
        || status_line.starts_with("HTTP/1.1 202")
        || status_line.starts_with("HTTP/1.0 204")
        || status_line.starts_with("HTTP/1.0 202")
}

fn wait_until_ready(state: Arc<DesktopState>, bootstrap_token: String, app: tauri::AppHandle) {
    let port = state.port.load(Ordering::Acquire);
    let deadline = Instant::now() + READY_TIMEOUT;
    while Instant::now() < deadline && !state.exited.load(Ordering::Acquire) {
        if authenticated_request(
            port,
            "GET",
            "/desktop/ready",
            &bootstrap_token,
            READY_TIMEOUT,
        ) {
            if let Err(error) =
                create_window_on_main_thread(&app, port, &state.control_token, Arc::clone(&state))
            {
                eprintln!("KnowTier failed to create the webview window: {error}");
                break;
            }
            let page_deadline = Instant::now() + PAGE_LOAD_TIMEOUT;
            while Instant::now() < page_deadline && !state.exited.load(Ordering::Acquire) {
                if state.page_loaded.load(Ordering::Acquire) {
                    return;
                }
                thread::sleep(Duration::from_millis(50));
            }
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    state.shutting_down.store(true, Ordering::Release);
    request_graceful_shutdown(state, app, 1);
}

fn request_graceful_shutdown(state: Arc<DesktopState>, app: tauri::AppHandle, exit_code: i32) {
    thread::spawn(move || {
        let port = state.port.load(Ordering::Acquire);
        if port != 0 {
            let _ = authenticated_request(
                port,
                "POST",
                "/desktop/shutdown",
                &state.control_token,
                Duration::from_secs(1),
            );
        }
        let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
        while Instant::now() < deadline && !state.exited.load(Ordering::Acquire) {
            thread::sleep(Duration::from_millis(50));
        }
        if !state.exited.load(Ordering::Acquire) {
            if let Some(child) = state
                .child
                .lock()
                .expect("sidecar child lock poisoned")
                .take()
            {
                let _ = child.kill();
            }
        }
        app.exit(exit_code);
    });
}

fn parse_announced_port(output: &[u8]) -> Option<u16> {
    let line = std::str::from_utf8(output).ok()?.trim();
    let raw_port = line.strip_prefix(PORT_ANNOUNCEMENT_PREFIX)?;
    raw_port.parse::<u16>().ok().filter(|port| *port != 0)
}

fn api_proxy_script(port: u16, control_token: &str) -> String {
    format!(
        r#"
(() => {{
  const backend = "http://127.0.0.1:{port}";
  const authorization = "Bearer {control_token}";
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init = {{}}) => {{
    const raw = input instanceof Request ? input.url : String(input);
    const source = new URL(raw, globalThis.location.href);
    if (
      source.origin === globalThis.location.origin &&
      (source.pathname === "/api" || source.pathname.startsWith("/api/"))
    ) {{
      const target = backend + source.pathname + source.search + source.hash;
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init.headers || {{}}).forEach((value, key) => headers.set(key, value));
      headers.set("Authorization", authorization);
      const rewritten = input instanceof Request ? new Request(target, input) : target;
      return originalFetch(rewritten, {{ ...init, headers }});
    }}
    return originalFetch(input, init);
  }};
}})();
"#
    )
}

fn is_application_navigation(url: &Url) -> bool {
    let has_no_credentials = url.username().is_empty() && url.password().is_none();
    let application_origin = match url.scheme() {
        "tauri" => {
            has_no_credentials && url.host_str() == Some("localhost") && url.port().is_none()
        }
        "http" | "https" => {
            has_no_credentials && url.host_str() == Some("tauri.localhost") && url.port().is_none()
        }
        _ => false,
    };
    application_origin
        || (cfg!(debug_assertions)
            && has_no_credentials
            && url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(5173))
}

fn is_allowed_navigation(url: &Url) -> bool {
    is_application_navigation(url)
}

fn create_window_on_main_thread(
    app: &tauri::AppHandle,
    port: u16,
    control_token: &str,
    state: Arc<DesktopState>,
) -> Result<(), String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    let window_app = app.clone();
    let window_token = control_token.to_owned();
    app.run_on_main_thread(move || {
        let result = create_hidden_window(&window_app, port, &window_token, state)
            .map_err(|error| error.to_string());
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;
    receiver
        .recv_timeout(WINDOW_CREATION_TIMEOUT)
        .map_err(|error| format!("main-thread window creation timed out: {error}"))?
}

fn create_hidden_window(
    app: &tauri::AppHandle,
    port: u16,
    control_token: &str,
    state: Arc<DesktopState>,
) -> tauri::Result<()> {
    let script = api_proxy_script(port, control_token);
    let page_state = Arc::clone(&state);
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("KnowTier")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 640.0)
        .center()
        .visible(false)
        .initialization_script(script)
        .on_navigation(is_allowed_navigation)
        .on_page_load(move |window, payload| {
            if payload.event() == PageLoadEvent::Finished
                && is_application_navigation(payload.url())
                && window.show().is_ok()
            {
                let _ = window.set_focus();
                page_state.page_loaded.store(true, Ordering::Release);
            }
        })
        .build()?;
    Ok(())
}

fn run() -> Result<(), Box<dyn Error>> {
    let bootstrap_token = random_token()?;
    let control_token = random_token()?;
    let state = Arc::new(DesktopState {
        port: AtomicU16::new(0),
        control_token,
        child: Mutex::new(None),
        exited: AtomicBool::new(false),
        page_loaded: AtomicBool::new(false),
        shutting_down: AtomicBool::new(false),
    });
    let setup_state = Arc::clone(&state);
    let setup_bootstrap = bootstrap_token;

    let application = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _working_directory| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ))
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let (mut receiver, child) = app
                .shell()
                .sidecar(SIDECAR_NAME)?
                .env(BOOTSTRAP_TOKEN_ENV, &setup_bootstrap)
                .env(CONTROL_TOKEN_ENV, &setup_state.control_token)
                .env(PARENT_PID_ENV, std::process::id().to_string())
                .spawn()?;
            *setup_state
                .child
                .lock()
                .expect("sidecar child lock poisoned") = Some(child);

            let event_state = Arc::clone(&setup_state);
            let event_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut pending_bootstrap = Some(setup_bootstrap);
                while let Some(event) = receiver.recv().await {
                    match event {
                        CommandEvent::Terminated(_) | CommandEvent::Error(_) => {
                            event_state.exited.store(true, Ordering::Release);
                            if !event_state.shutting_down.load(Ordering::Acquire) {
                                event_state.shutting_down.store(true, Ordering::Release);
                                event_app.exit(1);
                            }
                        }
                        CommandEvent::Stdout(output) => {
                            let Some(port) = parse_announced_port(&output) else {
                                continue;
                            };
                            if event_state
                                .port
                                .compare_exchange(0, port, Ordering::AcqRel, Ordering::Acquire)
                                .is_err()
                            {
                                continue;
                            }
                            let Some(bootstrap) = pending_bootstrap.take() else {
                                continue;
                            };
                            let ready_state = Arc::clone(&event_state);
                            let ready_app = event_app.clone();
                            thread::spawn(move || {
                                wait_until_ready(ready_state, bootstrap, ready_app);
                            });
                        }
                        CommandEvent::Stderr(_) => {
                            // Drain logs without relaying potentially sensitive user data.
                        }
                        _ => {}
                    }
                }
            });

            let announcement_state = Arc::clone(&setup_state);
            let announcement_app = app.handle().clone();
            thread::spawn(move || {
                let deadline = Instant::now() + PORT_ANNOUNCEMENT_TIMEOUT;
                while Instant::now() < deadline
                    && announcement_state.port.load(Ordering::Acquire) == 0
                    && !announcement_state.exited.load(Ordering::Acquire)
                {
                    thread::sleep(Duration::from_millis(50));
                }
                if announcement_state.port.load(Ordering::Acquire) == 0
                    && !announcement_state.exited.load(Ordering::Acquire)
                {
                    announcement_state
                        .shutting_down
                        .store(true, Ordering::Release);
                    request_graceful_shutdown(announcement_state, announcement_app, 1);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())?;

    application.run(move |app, event| {
        if let RunEvent::ExitRequested { code, api, .. } = event {
            if state
                .shutting_down
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                api.prevent_exit();
                request_graceful_shutdown(Arc::clone(&state), app.clone(), code.unwrap_or(0));
            }
        }
    });
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("KnowTier desktop failed to start: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read as _, Write as _},
        net::TcpListener,
        thread,
        time::Duration,
    };

    use super::{authenticated_request, is_allowed_navigation, HOST};
    use tauri::Url;

    #[test]
    fn readiness_request_waits_for_a_delayed_sidecar_response() {
        let listener = TcpListener::bind((HOST, 0)).expect("test listener must bind");
        let port = listener
            .local_addr()
            .expect("test listener must have an address")
            .port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("test connection must arrive");
            let mut request = [0_u8; 1024];
            let bytes_read = stream
                .read(&mut request)
                .expect("test request must be readable");
            assert!(bytes_read > 0, "test request must not be empty");
            thread::sleep(Duration::from_millis(1_200));
            stream
                .write_all(
                    b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .expect("test response must be writable");
        });

        assert!(authenticated_request(
            port,
            "GET",
            "/desktop/ready",
            "test-bootstrap-token",
            Duration::from_secs(2),
        ));
        server.join().expect("test server must exit");
    }

    #[test]
    fn allows_tauri_application_origins_used_by_each_webview_runtime() {
        for raw_url in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/assets/index.js",
        ] {
            let url = Url::parse(raw_url).expect("test URL must parse");
            assert!(is_allowed_navigation(&url), "expected local app URL: {url}");
        }
    }

    #[test]
    fn rejects_external_and_lookalike_navigation_origins() {
        for raw_url in [
            "https://example.com/",
            "https://tauri.localhost.example.com/",
            "https://user@tauri.localhost/",
            "https://tauri.localhost:444/",
            "tauri://external/index.html",
            "about:blank",
            "about:srcdoc",
        ] {
            let url = Url::parse(raw_url).expect("test URL must parse");
            assert!(
                !is_allowed_navigation(&url),
                "expected navigation to be rejected: {url}"
            );
        }
    }
}
