fn main() {
    // Generate Rust bindings for the Maestro on-device driver's gRPC API.
    // The vendored proto file under src-tauri/proto/ is the official
    // contract between the Maestro CLI and the on-device driver (see
    // github.com/mobile-dev-inc/maestro, maestro-proto module). Re-vendor
    // manually when Maestro bumps the proto schema — the generated code
    // lands in $OUT_DIR and is included via tonic::include_proto!.
    //
    // `protox` is a pure-Rust protobuf compiler, so contributors don't
    // have to install the `protoc` binary to build the project.
    let fds = protox::compile(["proto/maestro_android.proto"], ["proto"])
        .expect("failed to parse maestro_android.proto with protox");

    tonic_build::configure()
        .build_server(false)
        .build_client(true)
        .compile_fds(fds)
        .expect("failed to generate tonic bindings from descriptor set");

    println!("cargo:rerun-if-changed=proto/maestro_android.proto");

    tauri_build::build()
}
