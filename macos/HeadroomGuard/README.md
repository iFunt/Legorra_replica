# Headroom Guard

macOS menu bar app: a fork of [sandrich/headroom](https://github.com/sandrich/headroom) (MIT) with a privacy watch added.
Everything Headroom does (CPU, GPU, memory, battery, Claude Code and Grok limits and token usage) is kept as is.

## What the privacy watch adds

- **Red shield in the menu bar** with a count when an alert has not been reviewed, plus a macOS notification.
- **Per-app upload/download stats** for watched apps: today, last 15 minutes, a 7-day chart, and the hosts each app is connected to.
- **Watched apps**:
  - AI / LLM apps (Kimi, ChatGPT, Claude, Perplexity, DeepSeek, Gemini, Copilot, Cursor, Ollama, LM Studio, Grok, Mistral, Qwen, Raycast, Granola, Grammarly and others; see `Watchlist.ai` in `PrivacyModel.swift`)
  - browsers (traffic only; extensions run inside them)
  - any app you granted Screen Recording, Accessibility, Full Disk Access, Input Monitoring, Microphone or Camera
  - extra names you add under the `privacy.extraApps` default (comma-separated):
    `defaults write dev.headroomguard.HeadroomGuard privacy.extraApps "Notion, Slack"`
- **Browser extension audit** (Chrome, Brave, Edge, Arc, Vivaldi, Opera, other Chromium browsers, Firefox): each extension scored by what its manifest lets it do (all-sites access, cookies, history, clipboard, request interception, native messaging, debugger, ...).
- **Evidence log**: every alert is appended to `~/Library/Application Support/HeadroomGuard/privacy-events.jsonl` with time, size and destinations. **Export CSV** writes daily bytes per app to Downloads.

### Red alerts fire when

| Rule | Default | Change in |
| --- | --- | --- |
| A watched app sends more than X in 15 minutes | 5 MB | Settings > Privacy watch |
| A watched app sends more than Y in 15 minutes while it is not the frontmost app | 1 MB | Settings > Privacy watch |
| A new high-risk browser extension appears, or an extension gains permissions | always | |
| An app is newly granted Screen Recording / Accessibility / Full Disk Access / Input Monitoring / Mic / Camera | needs Full Disk Access | |

Browsers are not alerted on by volume unless you turn on "Alert on browser uploads too" (uploads and video calls would trigger it constantly).

## What it cannot do

- **It cannot see what the data was.** Traffic is TLS-encrypted and the app never inspects payloads. An alert means "this many bytes left for these hosts", which is the signal you act on, not proof that personal data was in it.
- **It cannot split browser traffic per extension.** macOS attributes extension traffic to the browser process. The extension audit covers capability and permission changes instead.
- Safari extensions are app extensions and are not audited.
- The macOS permissions list needs Full Disk Access for Headroom Guard (System Settings > Privacy & Security > Full Disk Access). Without it that section shows a button to the setting.
- Traffic is counted from launch; the first sample is a baseline.

## How it works

| Data | Source |
| --- | --- |
| Bytes per process | `/usr/bin/nettop -P -L 1 -x -J bytes_in,bytes_out` every 10 s, diffed per pid; helpers folded into their `.app` |
| Destinations | `/usr/sbin/lsof -nP -iTCP -sTCP:ESTABLISHED -iUDP -F pn` every 30 s, reverse DNS cached |
| Frontmost app | `NSWorkspace.frontmostApplication` |
| Extensions | Chromium profiles' `Extensions/<id>/<version>/manifest.json`; Firefox `extensions.json` |
| macOS permissions | user and system `TCC.db`, read-only via `/usr/bin/sqlite3` |

State is kept in `~/Library/Application Support/HeadroomGuard/privacy-state.json` (90 days of daily totals). Nothing is sent anywhere.

## Install (double-click)

1. In Finder, open `macos/HeadroomGuard` and double-click **Install Headroom Guard.command**.
   If macOS says it cannot be opened, right-click it > Open > Open.
2. It builds the app, installs it to Applications, puts a **Headroom Guard** shield icon on your Desktop and launches it.
3. Afterwards, double-click the Desktop icon to start it, or to open the dashboard if it is already running.

The icon is drawn by `scripts/make-guard-icon.py` (Pillow); rerun it to regenerate `Resources/AppIcon.icns`.

## Build

```bash
./build.sh            # builds build/HeadroomGuard.app
./build.sh install    # copies it to /Applications and launches it
./build.sh dmg        # packages build/HeadroomGuard-<version>.dmg
build/HeadroomGuard.app/Contents/MacOS/HeadroomGuard --privacy-selftest   # runs each probe once and prints results
```

Requires macOS 14+ and the Xcode command line tools. Not notarized: first launch needs System Settings > Privacy & Security > Open Anyway, or `xattr -dr com.apple.quarantine /Applications/HeadroomGuard.app`.

CI (`.github/workflows/headroom-guard.yml`) builds the app on a macOS runner, runs the self-test and uploads the `.app` as a build artifact.

## Source layout

Upstream files are unchanged except `main.swift` (shield item, privacy start-up, self-test), `Store.swift` (`privacy` store), `PopoverView.swift` (privacy column and settings), `Package.swift`, `build.sh` and `Info.plist` (renamed bundle). Added:

- `PrivacyModel.swift`: types, preferences, watchlist, app identity, `PrivacyStore`
- `NetworkMonitor.swift`: nettop and lsof sampling and parsing
- `Scanners.swift`: browser extension audit and macOS permission (TCC) scan
- `PrivacyMonitor.swift`: sampling loop, alert rules, notifications, evidence log, CSV export
- `PrivacyCard.swift`: dashboard column

## License

MIT, see [LICENSE](LICENSE). Original work © Headroom contributors.
