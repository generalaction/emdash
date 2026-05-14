//! Parser for `__TAURI_INVOKE<...>("name", ...)` channel names in the
//! TypeScript source emitted by tauri-specta. Shared by `build.rs` (via
//! `#[path]`) and the lib (`pub mod bindings_parser`) so unit tests run.
//! Tolerant of single-line, multi-line, and JSDoc-commented variants.

/// Extract channel names in first-occurrence order. Duplicates preserved.
pub fn extract_invoke_channels(bindings: &str) -> Vec<String> {
    let needle = "__TAURI_INVOKE";
    let mut out = Vec::new();
    let mut cursor = 0;

    while let Some(rel) = bindings[cursor..].find(needle) {
        let start = cursor + rel + needle.len();
        cursor = start;

        let after_generic = match skip_generic(&bindings[start..]) {
            Some(n) => start + n,
            None => continue,
        };

        let rest = bindings[after_generic..].trim_start();
        let Some(rest) = rest.strip_prefix('(') else {
            continue;
        };
        let rest = rest.trim_start();
        let Some(rest) = rest.strip_prefix('"') else {
            continue;
        };

        // Read until next unescaped `"`. Channel names don't escape, but
        // handle `\"` defensively.
        let mut name = String::new();
        let mut escape = false;
        for c in rest.chars() {
            if escape {
                name.push(c);
                escape = false;
                continue;
            }
            if c == '\\' {
                escape = true;
                continue;
            }
            if c == '"' {
                break;
            }
            name.push(c);
        }
        if !name.is_empty() {
            out.push(name);
        }
    }

    out
}

/// Skip a single `<...>` generic with balanced nesting (handles
/// `Result<T, E>`). Returns bytes consumed, or `None` on imbalance.
fn skip_generic(s: &str) -> Option<usize> {
    let trimmed = s.trim_start();
    let leading_ws = s.len() - trimmed.len();
    let mut chars = trimmed.char_indices();
    match chars.next() {
        Some((_, '<')) => {}
        _ => return Some(leading_ws),
    }
    let mut depth = 1;
    for (idx, c) in chars {
        match c {
            '<' => depth += 1,
            '>' => {
                depth -= 1;
                if depth == 0 {
                    return Some(leading_ws + idx + c.len_utf8());
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_arg_command() {
        let src = r#"getPath: () => __TAURI_INVOKE<string>("get_path"),"#;
        assert_eq!(extract_invoke_channels(src), vec!["get_path".to_string()]);
    }

    #[test]
    fn single_arg_command() {
        let src = r#"greet: (name: string) => __TAURI_INVOKE<string>("greet", { name }),"#;
        assert_eq!(extract_invoke_channels(src), vec!["greet".to_string()]);
    }

    #[test]
    fn multi_arg_command() {
        let src = r#"login: (user: string, pass: string) => __TAURI_INVOKE<Token>("login", { user, pass }),"#;
        assert_eq!(extract_invoke_channels(src), vec!["login".to_string()]);
    }

    #[test]
    fn doc_commented_command() {
        let src = r#"
            /**
             *  Returns the path.
             */
            getPath: () => __TAURI_INVOKE<string>("get_path"),
        "#;
        assert_eq!(extract_invoke_channels(src), vec!["get_path".to_string()]);
    }

    #[test]
    fn nested_generic_return_type() {
        let src = r#"fetch: () => __TAURI_INVOKE<Result<string, MyError>>("fetch"),"#;
        assert_eq!(extract_invoke_channels(src), vec!["fetch".to_string()]);
    }

    #[test]
    fn multi_line_invoke_broken_at_arrow() {
        let src = "greet: (name: string) =>\n    __TAURI_INVOKE<string>(\"greet\", { name }),";
        assert_eq!(extract_invoke_channels(src), vec!["greet".to_string()]);
    }

    #[test]
    fn multi_line_invoke_broken_inside_generic() {
        let src = "fetch: () => __TAURI_INVOKE<\n  Result<string, MyError>\n>(\"fetch\"),";
        assert_eq!(extract_invoke_channels(src), vec!["fetch".to_string()]);
    }

    #[test]
    fn multiple_commands_in_order() {
        let src = r#"
            greet: (n: string) => __TAURI_INVOKE<string>("greet", { n }),
            getPath: () => __TAURI_INVOKE<string>("get_path"),
            shutdown: () => __TAURI_INVOKE<null>("shutdown"),
        "#;
        assert_eq!(
            extract_invoke_channels(src),
            vec![
                "greet".to_string(),
                "get_path".to_string(),
                "shutdown".to_string()
            ],
        );
    }

    #[test]
    fn returns_empty_when_no_invoke_calls() {
        assert!(extract_invoke_channels("").is_empty());
        assert!(extract_invoke_channels("export const commands = {};").is_empty());
    }

    #[test]
    fn ignores_invoke_without_string_arg() {
        // Malformed shape — no quoted name. We don't synthesize a name.
        let src = r#"weird: () => __TAURI_INVOKE<string>(/* missing name */),"#;
        assert!(extract_invoke_channels(src).is_empty());
    }
}
