// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Generated gRPC bindings for the Maestro Android on-device driver.
//!
//! The actual Rust types (`MaestroDriverClient`, `ViewHierarchyRequest`,
//! `ViewHierarchyResponse`, etc.) come from `build.rs` running protox +
//! tonic-build over `proto/maestro_android.proto`. We just re-export
//! them from this module so the rest of the crate can refer to
//! `crate::hierarchy::proto::...` without caring where the bindings
//! physically live (they actually sit in `$OUT_DIR`).

#![allow(clippy::enum_variant_names)]
#![allow(non_snake_case)]

tonic::include_proto!("maestro_android");
