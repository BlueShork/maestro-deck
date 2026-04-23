//! Maestro YAML flow generation. Stub — agent fills in (plan §4 Phase 5).
use crate::selector::Selector;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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

pub fn generate_command(_action: &MaestroAction) -> String {
    String::new()
}
