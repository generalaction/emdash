//! `emdash-cli` — a CLI binary that links only against the `emdash_dev` lib
//! crate, never against the Tauri app module tree. Its existence enforces the
//! discipline that domain code in `lib.rs` (and modules `pub mod`'d from it)
//! stays free of `tauri::AppHandle` and webview-only types.
//!
//! For EMD-5 the surface is intentionally near-empty: `--version` is enough to
//! prove the invariant. Later issues add real subcommands as domain modules
//! land in `lib.rs`.

use std::env;
use std::process::ExitCode;

use emdash_dev::{greeting, shell_env};

const NAME: &str = env!("CARGO_PKG_NAME");
const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() -> ExitCode {
    link_domain_modules();

    let args: Vec<String> = env::args().skip(1).collect();

    match args.first().map(String::as_str) {
        Some("--version") | Some("-V") => {
            println!("{NAME} {VERSION}");
            ExitCode::SUCCESS
        }
        Some("--help") | Some("-h") | None => {
            print_help();
            ExitCode::SUCCESS
        }
        Some(other) => {
            eprintln!("error: unknown argument `{other}`");
            print_help();
            ExitCode::FAILURE
        }
    }
}

fn link_domain_modules() {
    let _ = greeting::greet("");
    let _ = shell_env::merge_path("", "");
}

fn print_help() {
    println!(
        "{NAME} {VERSION}
emdash-dev companion CLI

USAGE:
    {NAME} [OPTIONS]

OPTIONS:
    -V, --version    Print version
    -h, --help       Print this help"
    );
}
