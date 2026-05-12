//! Windows-only ergonomics for subprocess spawning.
//!
//! On Windows, every `Command::new(...)` that runs a console app flashes
//! a `conhost.exe` window. The `CREATE_NO_WINDOW` flag suppresses that.
//! The trait is no-op on Unix so call sites stay portable.

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub trait CommandExtNoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl CommandExtNoWindow for std::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

impl CommandExtNoWindow for tokio::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}
