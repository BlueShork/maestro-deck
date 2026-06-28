// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/// Extrait les noms des commandes `takeScreenshot` d'un flow Maestro, dans l'ordre.
pub fn screenshot_names(flow_yaml: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut lines = flow_yaml.lines().peekable();
    while let Some(raw) = lines.next() {
        let line = raw.trim_start_matches('-').trim();
        let Some(rest) = line.strip_prefix("takeScreenshot:") else {
            continue;
        };
        let inline = rest.trim();
        if !inline.is_empty() {
            // Forme courte: `takeScreenshot: name`
            names.push(unquote(inline));
        } else if let Some(next) = lines.peek() {
            // Forme objet: `path: name` sur la ligne suivante
            if let Some(path) = next.trim().strip_prefix("path:") {
                names.push(unquote(path.trim()));
            }
        }
    }
    names
}

fn unquote(s: &str) -> String {
    s.trim_matches(|c| c == '"' || c == '\'').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_short_and_object_forms() {
        let yaml = r#"
appId: com.example
---
- launchApp
- takeScreenshot: login
- tapOn: "Next"
- takeScreenshot:
    path: home
"#;
        assert_eq!(
            screenshot_names(yaml),
            vec!["login".to_string(), "home".to_string()]
        );
    }

    #[test]
    fn returns_empty_when_none() {
        assert_eq!(screenshot_names("- launchApp\n").len(), 0);
    }
}
