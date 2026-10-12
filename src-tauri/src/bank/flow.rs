// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/// A screenshot name that stays inside the folder it is joined to: relative,
/// plain components only (`screens/home` is fine, `../x`, `/etc/x`, `C:x` are
/// not). Names come from flow files, which may come from anyone's repository,
/// and are joined to the flow folder, the bank and the run folder.
pub fn safe_screenshot_name(name: &str) -> bool {
    use std::path::{Component, Path};
    !name.is_empty()
        && !name.contains('\\')
        && !name.contains(':')
        && Path::new(name)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

/// Extrait les noms des commandes `takeScreenshot` d'un flow Maestro, dans l'ordre.
/// Les noms qui sortiraient de leur dossier sont ignorés (voir [`safe_screenshot_name`]).
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
    names.retain(|n| safe_screenshot_name(n));
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

    #[test]
    fn names_escaping_their_folder_are_dropped() {
        let yaml = r#"
- takeScreenshot: ../../../Users/me/.ssh/id
- takeScreenshot: /etc/evil
- takeScreenshot:
    path: "screens/../../out"
- takeScreenshot: 'C:\\Windows\\x'
- takeScreenshot: screens/home
- takeScreenshot: login
"#;
        assert_eq!(
            screenshot_names(yaml),
            vec!["screens/home".to_string(), "login".to_string()]
        );
    }

    #[test]
    fn safe_names() {
        assert!(safe_screenshot_name("home"));
        assert!(safe_screenshot_name("screens/home"));
        assert!(safe_screenshot_name("home-bytel_2"));
        for bad in ["", "..", "../x", "a/../../b", "/abs", "./x", "a\\b", "C:x"] {
            assert!(!safe_screenshot_name(bad), "{bad:?}");
        }
    }
}
