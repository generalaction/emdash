#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod app;

fn main() {
    // `--export-bindings`: headless regen for CI / pre-commit.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--export-bindings") {
        match app::export_bindings_default() {
            Ok(()) => std::process::exit(0),
            Err(err) => {
                eprintln!("export_bindings failed: {err}");
                std::process::exit(1);
            }
        }
    }

    app::run();
}
