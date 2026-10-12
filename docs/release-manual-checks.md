# Manual checks before the release

Changes from the 2026-10-12 performance / stability pass (branch
`chore/improve-performances`) that automated tests can't cover. Run them in
`pnpm tauri:dev` with real devices.

## 1. Android stream (frames now sent as base64)

- [ ] Plug in an Android phone, connect it: the mirror appears and stays fluid.
- [ ] Taps, swipes and wheel scrolling on the mirror still reach the phone.
- [ ] Open Settings, come back: the mirror resumes.
- [ ] Toggle "stream" off then on in Settings while connected.
- [ ] Farm phone (if available): the remote mirror still shows.

## 2. Switching devices (previous session is torn down first)

- [ ] Android connected and mirrored → connect an iOS simulator: only the iOS
      screen shows, no flicker between the two.
- [ ] iOS → Android: the Android stream starts (not stuck on "Waiting for the
      first frame").
- [ ] Reconnect the same iOS simulator: still fast (keeper kept warm).
- [ ] Android → Web browser and back.
- [ ] Connect to a device that fails (e.g. unplug it during connect): the UI
      shows nothing connected, no stale device.

## 3. Lazy-loaded parts

- [ ] Open the AI assistant (Billy): the panel opens, messages render (markdown,
      code blocks, Apply diff dialog).
- [ ] Open Settings, Image Bank, Plugins, Account pages.
- [ ] Sign in / sign out of Maestro Deck Cloud; the plan badge updates.
- [ ] Start a cloud run while signed in.
- [ ] Update dialog: release notes render (check from the version cell when an
      update is available).

## 4. End of run (runner:exit now waits for the last output lines)

- [ ] Run a passing flow: steps turn green, "Flow completed" toast.
- [ ] Run a failing flow: the failing step shows its error message.
- [ ] Stop a run mid-way: "Flow stopped" arrives promptly.
- [ ] Run All on a workspace.
- [ ] Note if the end of a run ever feels ~2 s late (a child process keeping
      maestro's output open).

## 5. Unsaved changes prompts

- [ ] Autosave off, edit a flow, click another file in the tree: Save / Don't
      Save / Cancel. Check all three.
- [ ] Same with "New flow" from the tree.
- [ ] Edit, then quit (Cmd+Q): the unsaved prompt appears; after answering,
      no second "Quit Maestro Deck?" dialog.
- [ ] Autosave on: switching files or quitting saves silently.
- [ ] Untitled buffer with edits → open a file: Save asks where to save.

## 6. Misc

- [ ] Workspace tree: open a folder, switch to another quickly — the tree shows
      the right folder.
- [ ] Image bank with many screenshots: thumbnails load while scrolling;
      delete a screenshot and a device.
- [ ] Inspect mode: hover highlight, right-click menu inserts once per click.
- [ ] Device healthcheck button.
- [ ] Settings → tool paths: open and save.

## 7. Security fixes

- [ ] Billy `launch_app` / `stop_app` still work with a real package name
      (Android) and bundle id (iOS simulator).
- [ ] Screenshot bank with a nested name (`takeScreenshot: screens/home`):
      seeded, compared and "Replace baseline" still work.
- [ ] Billy `write_flow` into a new sub-folder of the workspace still works.
