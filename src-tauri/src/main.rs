#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod app;
mod commands;

fn main() {
    // CI / pre-commit can drive `cargo run -- --export-bindings` to regenerate
    // `ui/src/bindings.ts` without launching a webview. Useful for headless
    // verification that the committed bindings match the live Rust command set.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--export-bindings") {
        match app::export_bindings() {
            Ok(()) => std::process::exit(0),
            Err(err) => {
                eprintln!("export_bindings failed: {err}");
                std::process::exit(1);
            }
        }
    }

    app::run();
}
