# Physical iOS device support — setup guide

maestro-deck can drive a **physical iPhone/iPad** (screen view, inspector, tap/text,
flow runs) — the same things you do with an iOS simulator, with one difference: the
live preview refreshes at ~3 fps (the smooth 60 fps mirror is simulator-only). Running
a real device involves Apple code-signing, so a few one-time setup steps are required
that simulators don't need.

> **Hard requirement: maestro 2.5.1.** Physical-device support is currently locked to
> maestro **2.5.1**. The bridge installs patched maestro jars built specifically for
> 2.5.1; a different maestro version (2.4.x, 2.6.x, …) will not match and must not be
> used. Check yours with `maestro --version`.

---

## What you'll need (one-time)

| Requirement | Why | How |
|---|---|---|
| **macOS** | The whole toolchain is Apple-only | — |
| **Full Xcode** (not just Command Line Tools) | The on-device XCTest driver is compiled with `xcodebuild` | Install from the App Store, then run `sudo xcodebuild -license accept` and `xcode-select -p` (should point inside `Xcode.app`) |
| **maestro 2.5.1** | maestro-deck talks to it; the bridge patches it | `maestro --version` → must be `2.5.1` |
| **An Apple Team ID** | The driver app must be **signed** to run on a real device | Apple Developer account → *Membership → Team ID* (10 chars, e.g. `VJL93TUP2X`). A **free** Apple ID works too, but its certificate expires every 7 days (you'll re-run the first build weekly) |
| **iPhone/iPad on iOS 17+** with **Developer Mode** | Required to install/run the driver | *Settings → Privacy & Security → Developer Mode → On*, then reboot |
| **A USB cable + "Trust This Computer"** | The device is reached over USB | Plug in, unlock, tap **Trust** |

---

## Setup steps

### 1. Confirm maestro 2.5.1
```bash
maestro --version    # must print 2.5.1
```
If it prints something else, install 2.5.1 before continuing (physical support won't
work on other versions).

### 2. Find your Apple Team ID
- Sign in at [developer.apple.com](https://developer.apple.com) → **Membership** → copy the **Team ID**, **or**
- In a terminal: `security find-identity -v -p codesigning` — the Team ID is the
  10-character code in parentheses, e.g. `… (VJL93TUP2X)`.

### 3. Install the physical-device bridge (in maestro-deck)
1. Open **Settings → Tools**.
2. Find **“maestro-ios-device (physical iOS)”**.
3. Click **Install** — this downloads the bridge and the patched maestro 2.5.1 jars
   and sets them up automatically.
4. Wait until the row shows it's installed.

### 4. Enter your Apple Team ID
In the same **Settings → Tools** screen, fill **“Apple Team ID (iOS)”** with your Team
ID and save. (Leave empty only if your maestro is already configured with it.)

### 5. Enable Developer Mode on the device
On the iPhone/iPad: **Settings → Privacy & Security → Developer Mode → On**, reboot, and
confirm the prompt after restart.

### 6. Plug in and select the device
1. Connect the device by USB, unlock it, tap **Trust** if asked.
2. In maestro-deck the device appears in the selector labelled **“· device”**.
3. Select it.
   - **First time only:** maestro builds the XCTest driver onto the device — this can
     take **up to ~10 minutes**. Keep the device unlocked and plugged in. If iOS asks
     you to trust the developer app, accept (you may also need
     *Settings → General → VPN & Device Management* → trust your developer certificate).
   - After that, connecting is fast (the driver stays installed).
4. You should now see the screen, the view-hierarchy inspector, and be able to tap /
   type.

### 7. Run a flow
Run any flow against the device as usual. It executes on the real hardware.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Maestro not patched` | The bridge couldn't patch maestro. Re-run **Install** (Settings → Tools). Confirm `maestro --version` is **2.5.1**. |
| `Unsupported Maestro version` during install | Your maestro isn't 2.5.1. Install 2.5.1 and re-run Install. |
| Build fails / times out at first connect | Usually a signing problem: wrong/empty **Apple Team ID**, device not in **Developer Mode**, or the developer certificate isn't trusted on the device. Fix those and reselect the device. |
| Device doesn't appear in the selector | Unlock the phone, tap **Trust**, confirm **Developer Mode** is on. iOS 17+ may show the device only after you interact with it once. |
| Worked yesterday, fails today (free Apple account) | Free-account signing certificates expire after 7 days — reselect the device to rebuild/re-sign. |
| A maestro upgrade broke it | Upgrading maestro overwrites the patched jars. Re-run **Install** (and make sure you're back on 2.5.1). |
| Preview looks choppy (~3 fps) | Expected on physical devices — the smooth 60 fps preview is simulator-only. |

---

## Notes / current limitations

- **maestro 2.5.1 only** for now. Newer maestro support means rebuilding the patched
  jars for that version.
- Installing the bridge **replaces your maestro's jars** with patched 2.5.1 ones
  (backed up first). This is transparent for simulators / Android / Web, which keep
  working normally.
- Physical-device automation inherently requires Xcode + code-signing — there is no
  fully "plug-and-play" path on iOS the way there is for simulators. These steps are
  the minimum Apple allows.
