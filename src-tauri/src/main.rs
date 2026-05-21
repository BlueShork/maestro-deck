// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

// Prevent additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    maestro_deck_lib::run()
}
