//! Capture the user's login-shell environment so that subsequent shell-outs
//! (PTYs, git, package managers) see the full PATH a terminal would see,
//! even when the app is launched from Finder/Spotlight/AppImage.
//!
//! Ported faithfully from emdash Electron's `src/main/utils/userEnv.ts` and
//! `src/main/utils/childProcessEnv.ts`. The verbatim port — `$SHELL -ilc env`,
//! the 5 s timeout, the AppImage PATH scrubbing, the PRESERVE blocklist — is
//! a deliberate choice over Helmor's simpler `$SHELL -l -c env` approach.
//! See `docs/decisions/0001-initial-scaffold.md` (ADR-0001) for the rationale.
//!
//! Must remain free of `tauri::*` imports so `bin/emdash-cli` can link it.

use std::collections::HashMap;
use std::env;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

/// AppImage runtime vars — must never be overwritten or leaked into the probe
/// shell. Mirrors `APPIMAGE_ENV_KEYS` in `childProcessEnv.ts`.
const APPIMAGE_ENV_KEYS: &[&str] = &[
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "CHROME_DESKTOP",
    "GSETTINGS_SCHEMA_DIR",
    "OWD",
];

/// PATH-like vars whose entries pointing inside AppImage (`$APPDIR/...` or
/// `/tmp/.mount_*/...`) must be scrubbed before spawning the probe shell.
/// Otherwise login-shell hooks that resolve binaries by name through PATH
/// (mise, starship, oh-my-zsh) can re-enter the AppImage and fork-bomb the
/// app on Linux. See emdash#1679.
const APPIMAGE_PATH_LIKE_KEYS: &[&str] = &["PATH", "LD_LIBRARY_PATH", "XDG_DATA_DIRS"];

/// Keys from the captured shell env that must NOT overwrite our inherited
/// values. Tauri equivalent of `PRESERVE_KEYS` in `userEnv.ts`.
const PRESERVE_KEYS: &[&str] = &[
    // AppImage
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "CHROME_DESKTOP",
    "GSETTINGS_SCHEMA_DIR",
    "OWD",
    // Build toolchain
    "NODE_ENV",
];

/// Vars injected into the probe shell's env to suppress noisy init-time side
/// effects (auto-updaters, tmux autostart). Mirrors `SHELL_ENV_CAPTURE_GUARD`.
const SHELL_ENV_CAPTURE_GUARDS: &[(&str, &str)] = &[
    ("DISABLE_AUTO_UPDATE", "true"),
    ("ZSH_TMUX_AUTOSTART", "false"),
    ("ZSH_TMUX_AUTOSTARTED", "true"),
];

const CAPTURE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureStatus {
    Captured,
    SkippedWindows,
    Failed(String),
}

#[derive(Debug, Clone)]
pub struct ShellEnv {
    pub captured: HashMap<String, String>,
    pub shell: String,
    pub status: CaptureStatus,
}

impl ShellEnv {
    pub fn path(&self) -> String {
        self.captured.get("PATH").cloned().unwrap_or_default()
    }
}

static SHELL_ENV: OnceLock<ShellEnv> = OnceLock::new();

/// Returns the cached login-shell env. First call captures (may block up to
/// `CAPTURE_TIMEOUT`); subsequent calls hit the `OnceLock`.
pub fn shell_env() -> &'static ShellEnv {
    SHELL_ENV.get_or_init(inherit_login_shell_env)
}

/// Captures the login-shell environment once and applies the captured values to
/// this process. This makes future `std::process::Command` calls that inherit
/// `std::env` see the same PATH and shell-managed variables that `get_path`
/// exposes to the renderer.
pub fn apply_login_shell_env_to_process() -> &'static ShellEnv {
    let shell_env = shell_env();
    apply_captured_env_to_process(&shell_env.captured);
    shell_env
}

/// Returns the environment map future shell-out helpers should pass explicitly
/// when they do not want to inherit the whole process environment.
pub fn external_tool_env() -> HashMap<String, String> {
    shell_env().captured.clone()
}

/// Captures the user's login-shell environment. Tolerant of nonzero shell
/// exits, timeouts, and missing `$SHELL`. On any failure path the returned
/// `ShellEnv` carries the inherited (scrubbed) env and `status = Failed(...)`.
pub fn inherit_login_shell_env() -> ShellEnv {
    if cfg!(target_os = "windows") {
        // Windows PATH is managed differently — no login-shell capture.
        return ShellEnv {
            captured: env::vars().collect(),
            shell: env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string()),
            status: CaptureStatus::SkippedWindows,
        };
    }

    let shell = env::var("SHELL").unwrap_or_else(|_| default_shell().to_string());
    let base_env = build_external_tool_env(env::vars().collect());

    match run_login_shell(&shell, &base_env) {
        Ok(shell_env_map) => ShellEnv {
            captured: merge_shell_env(base_env, shell_env_map),
            shell,
            status: CaptureStatus::Captured,
        },
        Err(err) => ShellEnv {
            captured: base_env,
            shell,
            status: CaptureStatus::Failed(err),
        },
    }
}

fn default_shell() -> &'static str {
    if cfg!(target_os = "macos") {
        "/bin/zsh"
    } else {
        "/bin/bash"
    }
}

/// Strip AppImage runtime vars + AppImage-rooted PATH entries from an env map.
/// Equivalent to `buildExternalToolEnv` in `childProcessEnv.ts`.
pub fn build_external_tool_env(base: HashMap<String, String>) -> HashMap<String, String> {
    let app_dir = base.get("APPDIR").cloned();
    let mut out = base;

    for key in APPIMAGE_ENV_KEYS {
        out.remove(*key);
    }

    for key in APPIMAGE_PATH_LIKE_KEYS {
        if let Some(value) = out.get(*key).cloned() {
            let cleaned = strip_appimage_path_entries(&value, app_dir.as_deref());
            if cleaned.is_empty() {
                out.remove(*key);
            } else {
                out.insert((*key).to_string(), cleaned);
            }
        }
    }

    for key in ["PYTHONHOME", "PYTHONPATH"] {
        if let Some(value) = out.get(key).cloned() {
            let in_appdir = app_dir.as_deref().is_some_and(|d| value.starts_with(d));
            if in_appdir || value.contains("/tmp/.mount_") {
                out.remove(key);
            }
        }
    }

    out
}

fn strip_appimage_path_entries(value: &str, app_dir: Option<&str>) -> String {
    let sep = if cfg!(target_os = "windows") {
        ';'
    } else {
        ':'
    };
    value
        .split(sep)
        .filter(|p| !p.is_empty())
        .filter(|p| !app_dir.is_some_and(|d| p.starts_with(d)))
        .filter(|p| !p.contains("/tmp/.mount_"))
        .collect::<Vec<_>>()
        .join(&sep.to_string())
}

fn merge_shell_env(
    base: HashMap<String, String>,
    captured: HashMap<String, String>,
) -> HashMap<String, String> {
    let mut out = base.clone();
    for (key, value) in captured {
        if PRESERVE_KEYS.contains(&key.as_str()) {
            continue;
        }
        if key == "PATH" {
            let current = base.get("PATH").map(String::as_str).unwrap_or("");
            out.insert("PATH".to_string(), merge_path(&value, current));
        } else {
            out.insert(key, value);
        }
    }
    out
}

fn apply_captured_env_to_process(captured: &HashMap<String, String>) {
    for key in process_env_keys_to_remove_before_apply(captured) {
        env::remove_var(key);
    }

    for (key, value) in captured {
        env::set_var(key, value);
    }
}

fn process_env_keys_to_remove_before_apply(
    captured: &HashMap<String, String>,
) -> Vec<&'static str> {
    let mut keys = APPIMAGE_ENV_KEYS.to_vec();

    for key in APPIMAGE_PATH_LIKE_KEYS {
        if !captured.contains_key(*key) {
            keys.push(*key);
        }
    }

    keys
}

/// Merge two PATH strings: shell entries first (the user's full PATH), then
/// any entries from `current` not already in the shell PATH. Equivalent to
/// `mergePath` in `userEnv.ts`.
pub fn merge_path(shell_path: &str, current_path: &str) -> String {
    let sep = if cfg!(target_os = "windows") {
        ';'
    } else {
        ':'
    };
    let shell_entries: Vec<&str> = shell_path.split(sep).filter(|p| !p.is_empty()).collect();
    let seen: std::collections::HashSet<&str> = shell_entries.iter().copied().collect();
    let mut out: Vec<&str> = shell_entries.clone();
    for entry in current_path.split(sep).filter(|p| !p.is_empty()) {
        if !seen.contains(entry) {
            out.push(entry);
        }
    }
    out.join(&sep.to_string())
}

/// Parses `key=value` lines from `env` output. Ignores lines without `=` and
/// lines whose key doesn't match `^[A-Za-z_]\w*$`. Multi-line values aren't
/// supported (matches the JS implementation).
pub fn parse_env_output(raw: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in raw.split('\n') {
        let Some(eq) = line.find('=') else { continue };
        let key = line[..eq].trim();
        let value = &line[eq + 1..];
        if !key.is_empty() && is_valid_env_key(key) {
            out.insert(key.to_string(), value.to_string());
        }
    }
    out
}

fn is_valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    let first = match chars.next() {
        Some(c) => c,
        None => return false,
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn run_login_shell(
    shell: &str,
    base_env: &HashMap<String, String>,
) -> Result<HashMap<String, String>, String> {
    run_login_shell_with_timeout(shell, base_env, CAPTURE_TIMEOUT)
}

fn run_login_shell_with_timeout(
    shell: &str,
    base_env: &HashMap<String, String>,
    timeout: Duration,
) -> Result<HashMap<String, String>, String> {
    let shell = shell.to_string();
    let env: Vec<(String, String)> = base_env
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .chain(
            SHELL_ENV_CAPTURE_GUARDS
                .iter()
                .map(|(k, v)| ((*k).to_string(), (*v).to_string())),
        )
        .collect();

    let mut cmd = Command::new(&shell);
    cmd.arg("-ilc")
        .arg("env")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear();

    for (k, v) in env {
        cmd.env(k, v);
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let deadline = Instant::now() + timeout;

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                // Nonzero exit codes are tolerated — the shell may have warnings
                // on its rc files but still produce a usable `env` dump.
                let output = child
                    .wait_with_output()
                    .map_err(|e| format!("read output failed: {e}"))?;
                let raw = String::from_utf8_lossy(&output.stdout);
                return Ok(parse_env_output(&raw));
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("timeout".to_string());
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(format!("wait failed: {e}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_env_output_basic() {
        let raw = "PATH=/usr/bin:/bin\nHOME=/Users/foo\nSHELL=/bin/zsh\n";
        let out = parse_env_output(raw);
        assert_eq!(out.get("PATH").map(String::as_str), Some("/usr/bin:/bin"));
        assert_eq!(out.get("HOME").map(String::as_str), Some("/Users/foo"));
        assert_eq!(out.get("SHELL").map(String::as_str), Some("/bin/zsh"));
    }

    #[test]
    fn parse_env_output_ignores_garbage() {
        let raw = "not an env line\n1BADKEY=x\nVALID_KEY=y\n=missingkey\n";
        let out = parse_env_output(raw);
        assert_eq!(out.len(), 1);
        assert_eq!(out.get("VALID_KEY").map(String::as_str), Some("y"));
    }

    #[test]
    fn parse_env_output_handles_equals_in_value() {
        let raw = "FOO=a=b=c\n";
        assert_eq!(
            parse_env_output(raw).get("FOO").map(String::as_str),
            Some("a=b=c")
        );
    }

    #[test]
    fn merge_path_prepends_shell_entries() {
        let result = merge_path("/opt/homebrew/bin:/usr/local/bin", "/usr/bin:/bin");
        assert_eq!(result, "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
    }

    #[test]
    fn merge_path_dedupes_against_shell() {
        let result = merge_path("/opt/bin:/usr/bin", "/usr/bin:/bin");
        assert_eq!(result, "/opt/bin:/usr/bin:/bin");
    }

    #[test]
    fn merge_path_handles_empty_inputs() {
        assert_eq!(merge_path("", "/usr/bin"), "/usr/bin");
        assert_eq!(merge_path("/usr/bin", ""), "/usr/bin");
        assert_eq!(merge_path("", ""), "");
    }

    #[test]
    fn build_external_tool_env_strips_appimage_keys() {
        let mut base = HashMap::new();
        base.insert("APPDIR".to_string(), "/tmp/.mount_foo".to_string());
        base.insert("APPIMAGE".to_string(), "/path/to/app.AppImage".to_string());
        base.insert("HOME".to_string(), "/home/user".to_string());
        let out = build_external_tool_env(base);
        assert!(!out.contains_key("APPDIR"));
        assert!(!out.contains_key("APPIMAGE"));
        assert_eq!(out.get("HOME").map(String::as_str), Some("/home/user"));
    }

    #[test]
    fn build_external_tool_env_strips_appimage_path_entries() {
        let mut base = HashMap::new();
        base.insert("APPDIR".to_string(), "/tmp/.mount_foo".to_string());
        base.insert(
            "PATH".to_string(),
            "/tmp/.mount_foo/usr/bin:/usr/local/bin:/usr/bin".to_string(),
        );
        let out = build_external_tool_env(base);
        assert_eq!(
            out.get("PATH").map(String::as_str),
            Some("/usr/local/bin:/usr/bin"),
        );
    }

    #[test]
    fn merge_shell_env_preserves_blocklisted_keys() {
        let mut base = HashMap::new();
        base.insert("NODE_ENV".to_string(), "production".to_string());
        base.insert("PATH".to_string(), "/usr/bin".to_string());

        let mut captured = HashMap::new();
        captured.insert("NODE_ENV".to_string(), "development".to_string());
        captured.insert("PATH".to_string(), "/opt/homebrew/bin".to_string());
        captured.insert("CARGO_HOME".to_string(), "/home/user/.cargo".to_string());

        let out = merge_shell_env(base, captured);
        // PRESERVE_KEYS keeps NODE_ENV from being overwritten.
        assert_eq!(out.get("NODE_ENV").map(String::as_str), Some("production"));
        // PATH gets merged, not overwritten.
        assert_eq!(
            out.get("PATH").map(String::as_str),
            Some("/opt/homebrew/bin:/usr/bin")
        );
        // Other keys flow through.
        assert_eq!(
            out.get("CARGO_HOME").map(String::as_str),
            Some("/home/user/.cargo"),
        );
    }

    #[test]
    fn process_env_keys_to_remove_drops_appimage_and_missing_pathlike_vars() {
        let mut captured = HashMap::new();
        captured.insert("PATH".to_string(), "/usr/bin".to_string());

        let keys = process_env_keys_to_remove_before_apply(&captured);
        assert!(keys.contains(&"APPIMAGE"));
        assert!(keys.contains(&"APPDIR"));
        assert!(!keys.contains(&"PATH"));
        assert!(keys.contains(&"LD_LIBRARY_PATH"));
        assert!(keys.contains(&"XDG_DATA_DIRS"));
    }

    #[cfg(unix)]
    #[test]
    fn run_login_shell_parses_output_even_on_nonzero_exit() {
        use std::fs;

        let script = temp_executable_shell_script(
            "emdash-env-shell",
            "#!/bin/sh\nprintf 'PATH=/from-shell\\nNVM_DIR=/Users/test/.nvm\\n'\nexit 7\n",
        );

        let out = run_login_shell_with_timeout(
            script.to_str().unwrap(),
            &HashMap::new(),
            Duration::from_secs(1),
        )
        .unwrap();
        let _ = fs::remove_file(&script);

        assert_eq!(out.get("PATH").map(String::as_str), Some("/from-shell"));
        assert_eq!(
            out.get("NVM_DIR").map(String::as_str),
            Some("/Users/test/.nvm")
        );
    }

    #[cfg(unix)]
    #[test]
    fn run_login_shell_kills_timed_out_probe() {
        use std::fs;

        let script =
            temp_executable_shell_script("emdash-sleep-shell", "#!/bin/sh\nexec sleep 10\n");
        let started = Instant::now();
        let result = run_login_shell_with_timeout(
            script.to_str().unwrap(),
            &HashMap::new(),
            Duration::from_millis(50),
        );
        let _ = fs::remove_file(&script);

        assert_eq!(result.unwrap_err(), "timeout");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[cfg(unix)]
    fn temp_executable_shell_script(prefix: &str, content: &str) -> std::path::PathBuf {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let script = env::temp_dir().join(format!(
            "{prefix}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&script, content).unwrap();

        let mut permissions = fs::metadata(&script).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script, permissions).unwrap();
        script
    }
}
