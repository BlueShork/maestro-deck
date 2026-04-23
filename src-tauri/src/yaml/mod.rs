//! Maestro YAML flow generation.

use serde::{Deserialize, Serialize};

use crate::selector::Selector;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MaestroAction {
    LaunchApp { app_id: String },
    TapOn { selector: Selector },
    InputText { text: String },
    AssertVisible { selector: Selector },
    AssertNotVisible { selector: Selector },
    Scroll,
    ScrollUntilVisible { selector: Selector },
    Back,
    HideKeyboard,
    PressKey { key: String },
    WaitForAnimationToEnd,
}

/// Render an action as a YAML fragment that can be appended to a Maestro flow.
/// The output ends with a newline. The leading `- ` is included.
pub fn generate_command(action: &MaestroAction) -> String {
    match action {
        MaestroAction::LaunchApp { app_id } => {
            format!("- launchApp: \"{}\"\n", escape(app_id))
        }
        MaestroAction::TapOn { selector } => {
            format!("- tapOn:\n{}", indent_selector(selector, 4))
        }
        MaestroAction::InputText { text } => {
            format!("- inputText: \"{}\"\n", escape(text))
        }
        MaestroAction::AssertVisible { selector } => {
            format!("- assertVisible:\n{}", indent_selector(selector, 4))
        }
        MaestroAction::AssertNotVisible { selector } => {
            format!("- assertNotVisible:\n{}", indent_selector(selector, 4))
        }
        MaestroAction::Scroll => "- scroll\n".to_string(),
        MaestroAction::ScrollUntilVisible { selector } => {
            // Maestro nests the matcher under `element:`.
            let s = indent_selector(selector, 6);
            format!("- scrollUntilVisible:\n    element:\n{s}")
        }
        MaestroAction::Back => "- back\n".to_string(),
        MaestroAction::HideKeyboard => "- hideKeyboard\n".to_string(),
        MaestroAction::PressKey { key } => format!("- pressKey: \"{}\"\n", escape(key)),
        MaestroAction::WaitForAnimationToEnd => "- waitForAnimationToEnd\n".to_string(),
    }
}

/// Generate a complete flow document from an appId + actions.
pub fn generate_flow(app_id: &str, actions: &[MaestroAction]) -> String {
    let mut out = format!("appId: \"{}\"\n---\n", escape(app_id));
    for a in actions {
        out.push_str(&generate_command(a));
    }
    out
}

fn indent_selector(selector: &Selector, indent: usize) -> String {
    let pad = " ".repeat(indent);
    match selector {
        Selector::ResourceId { value } => format!("{pad}id: \"{}\"\n", escape(value)),
        Selector::Text { value } => format!("{pad}text: \"{}\"\n", escape(value)),
        Selector::ContentDesc { value } => {
            format!("{pad}accessibilityText: \"{}\"\n", escape(value))
        }
        Selector::Point { x_pct, y_pct } => {
            // Maestro expects integer percentages.
            let xs = x_pct.round() as i32;
            let ys = y_pct.round() as i32;
            format!("{pad}point: \"{xs}%, {ys}%\"\n")
        }
    }
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn launch_app() {
        let out = generate_command(&MaestroAction::LaunchApp {
            app_id: "com.example.app".into(),
        });
        assert_eq!(out, "- launchApp: \"com.example.app\"\n");
    }

    #[test]
    fn tap_on_resource_id() {
        let out = generate_command(&MaestroAction::TapOn {
            selector: Selector::ResourceId {
                value: "com.example:id/login".into(),
            },
        });
        assert_eq!(out, "- tapOn:\n    id: \"com.example:id/login\"\n");
    }

    #[test]
    fn tap_on_text() {
        let out = generate_command(&MaestroAction::TapOn {
            selector: Selector::Text {
                value: "Sign in".into(),
            },
        });
        assert_eq!(out, "- tapOn:\n    text: \"Sign in\"\n");
    }

    #[test]
    fn tap_on_content_desc() {
        let out = generate_command(&MaestroAction::TapOn {
            selector: Selector::ContentDesc {
                value: "Search".into(),
            },
        });
        assert_eq!(out, "- tapOn:\n    accessibilityText: \"Search\"\n");
    }

    #[test]
    fn tap_on_point() {
        let out = generate_command(&MaestroAction::TapOn {
            selector: Selector::Point {
                x_pct: 50.0,
                y_pct: 25.4,
            },
        });
        assert_eq!(out, "- tapOn:\n    point: \"50%, 25%\"\n");
    }

    #[test]
    fn input_text_escapes_quotes() {
        let out = generate_command(&MaestroAction::InputText {
            text: "He said \"hi\"".into(),
        });
        assert_eq!(out, "- inputText: \"He said \\\"hi\\\"\"\n");
    }

    #[test]
    fn assert_visible_with_text() {
        let out = generate_command(&MaestroAction::AssertVisible {
            selector: Selector::Text {
                value: "Welcome".into(),
            },
        });
        assert_eq!(out, "- assertVisible:\n    text: \"Welcome\"\n");
    }

    #[test]
    fn assert_not_visible() {
        let out = generate_command(&MaestroAction::AssertNotVisible {
            selector: Selector::Text {
                value: "Error".into(),
            },
        });
        assert_eq!(out, "- assertNotVisible:\n    text: \"Error\"\n");
    }

    #[test]
    fn scroll_until_visible() {
        let out = generate_command(&MaestroAction::ScrollUntilVisible {
            selector: Selector::Text {
                value: "Settings".into(),
            },
        });
        assert_eq!(
            out,
            "- scrollUntilVisible:\n    element:\n      text: \"Settings\"\n"
        );
    }

    #[test]
    fn simple_actions() {
        assert_eq!(generate_command(&MaestroAction::Scroll), "- scroll\n");
        assert_eq!(generate_command(&MaestroAction::Back), "- back\n");
        assert_eq!(
            generate_command(&MaestroAction::HideKeyboard),
            "- hideKeyboard\n"
        );
        assert_eq!(
            generate_command(&MaestroAction::WaitForAnimationToEnd),
            "- waitForAnimationToEnd\n"
        );
    }

    #[test]
    fn press_key() {
        let out = generate_command(&MaestroAction::PressKey {
            key: "Enter".into(),
        });
        assert_eq!(out, "- pressKey: \"Enter\"\n");
    }

    #[test]
    fn full_flow_round_trip_through_yaml_parser() {
        let flow = generate_flow(
            "com.example.app",
            &[
                MaestroAction::LaunchApp {
                    app_id: "com.example.app".into(),
                },
                MaestroAction::TapOn {
                    selector: Selector::ResourceId {
                        value: "com.example:id/login_button".into(),
                    },
                },
                MaestroAction::InputText {
                    text: "user@example.com".into(),
                },
                MaestroAction::AssertVisible {
                    selector: Selector::Text {
                        value: "Welcome".into(),
                    },
                },
                MaestroAction::Back,
            ],
        );

        // Multi-doc round-trip: ensure both the header and the steps array parse.
        let docs: Vec<serde_yaml::Value> = serde_yaml::Deserializer::from_str(&flow)
            .map(serde_yaml::Value::deserialize)
            .collect::<Result<_, _>>()
            .expect("yaml multi-doc parse");
        assert_eq!(docs.len(), 2);
        assert_eq!(docs[0]["appId"], "com.example.app");
        let steps = docs[1].as_sequence().expect("steps sequence");
        assert_eq!(steps.len(), 5);
    }
}
