<div align="center">
  <img src="public/cybermonkey.svg" width="88" alt="Cybermonkey logo">
  <h1>Cybermonkey</h1>
  <p><strong>Your mobile tests. With proof built in.</strong></p>
  <p>An open-source desktop workspace to create, record and replay Android &amp; iOS test scenarios — with AI.</p>
  <p><a href="README.fr.md">Français</a> · <strong>English</strong></p>
  <p>
    <a href="https://pickywawa.github.io/cybermonkey/">Website</a> ·
    <a href="https://github.com/pickywawa/cybermonkey/releases/latest">Download</a> ·
    <a href="https://pickywawa.github.io/cybermonkey/fonctionnement.html">How it works</a> ·
    <a href="https://pickywawa.github.io/cybermonkey/fonctionnalites.html">Features</a> ·
    <a href="https://pickywawa.github.io/cybermonkey/aide.html">Help</a> ·
    <a href="CHANGELOG.md">What’s new</a>
  </p>
  <p>
    <a href="https://github.com/pickywawa/cybermonkey/releases/latest"><img src="https://img.shields.io/github/v/release/pickywawa/cybermonkey?style=flat-square&color=6d8bff" alt="Latest release"></a>
    <a href="https://github.com/pickywawa/cybermonkey/actions/workflows/ci.yml"><img src="https://github.com/pickywawa/cybermonkey/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22d3c5?style=flat-square" alt="MIT"></a>
  </p>
</div>

![Cybermonkey campaign progress](site/assets/screenshots/progression.png)

_Screenshots use demonstration data (fictional app “Atlas Mobile”)._

## What you can do

| Create                                                                                                                                     | Run                                                                                                                                          | Understand                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Describe a journey**: Claude Code, Codex or GitHub Copilot explore your real devices; you review the synthesis before anything is saved. | **Campaigns** per OS with a screenshot per step, fast screen-change detection, **selector self-repair** and **structured failure analysis**. | **Progress** in elements by the **last result** of each, per OS of the project, results linked to the scenario tree, a **screen map** by module with each screen's status and capture. |
| **Record on the phone**: use the app by hand, steps are inferred (ambiguous taps settled by the AI).                                       | Work on **both OS or one at a time**; OS-specific steps are “not applicable” elsewhere, gaps never fail a run.                               | Reports in **text, CSV, Markdown, Confluence, HTML, JUnit XML, JSON**.                                                                                                                 |
| **Build by hand**: click components on the live mirror.                                                                                    | **Interactive or auto-approve** exploration, project **variables** (created on the fly by the AI).                                           | Device **diagnostics** with exact fixes and an AI diagnosis.                                                                                                                           |
| **Import test cases** from Squash TM, TestRail, Azure Test Plans, Gherkin, CSV, JSON, Markdown.                                            | **Web views** the accessibility tree cannot read are driven through a labeled grid on the screenshot.                                        | Detachable **Devices** and **AI** windows, automatic updates, 7 themes, French &amp; English.                                                                                          |

<p align="center">
  <img src="site/assets/screenshots/synthese.png" width="49%" alt="AI synthesis">
  <img src="site/assets/screenshots/cartographie.png" width="49%" alt="Screen map">
</p>

## Built to last

Mobile tests fail for reasons that are not bugs. Cybermonkey is built so that **a failure means something**.

|                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rich steps**     | Tap, **long press**, **double tap**, swipe, **scroll until a component is visible**, launch / relaunch / close / background the app, **deep links**, **answer system dialogs**, orientation, keyboard, **capture a text into a variable**. Checks: visible, absent, text, contains, enabled, selected, **regular expression**, **component count**.                                                                                                                                                        |
| **Scenario logic** | **Conditions** (“if the cookie banner is visible, close it”, skipped — not failed — otherwise), **sub-scenario calls** (write “Log in” once), **datasets** (one pass per table row, columns are variables), **value capture** reused in later steps.                                                                                                                                                                                                                                                       |
| **Environments**   | Staging, pre-prod… each with its own variables overriding the common ones; one selector switches creation, runs and MCP.                                                                                                                                                                                                                                                                                                                                                                                   |
| **Interruptions**  | Popups, toasts, _session expired_ messages, the login screen after a logout, permission dialogs, crashes. When a step fails, the app is relaunched if it vanished, system dialogs are answered (never a button that deletes, logs out or pays), your **interruption handlers** (ordinary scenarios triggered by what is on screen, chainable, able to log in again and **go back to where the test was**) run, and as a last resort the AI closes an unexpected popup. Everything is traced in the report. |
| **Reliability**    | **Targeted retry** (a step passing only on the 2nd attempt is marked **unstable**, not hidden), lost-tap protection after a relaunch, **stability history** (“passed 8 of 10” — regression or fragile test?), **selector durability audit** with the identifier to ask developers for, **AI selector repairs** applied to the scenarios in one click.                                                                                                                                                      |
| **Diagnostics**    | **Video** of failing scenarios only, **device log** around the failure, **network-trouble detection** (offline, timeout, TLS, 5xx, 401/403), **visual comparison** with the last pass (changed areas outlined).                                                                                                                                                                                                                                                                                            |
| **Speed**          | Android and iOS driven **in parallel**, condition-based waits, **deep-link shortcut** to a start screen, per-step **duration profile** (acting vs. gathering evidence).                                                                                                                                                                                                                                                                                                                                    |

Details: [Features](https://pickywawa.github.io/cybermonkey/fonctionnalites.html).

## MCP server

Cybermonkey embeds an **MCP server** with **45 tools** (on by default, local only, token-protected, fully switchable in _Settings → MCP_; every tool can be toggled within its group). A calling AI can list scenarios, find the navigation path to a step, move the app to a screen, replay any item in any order, read structured results (failing step, screenshot, analysis), explore and click on the devices, and create + verify new scenarios, on both OS at once. See [docs/mcp.md](docs/mcp.md).

```sh
claude mcp add --transport http cybermonkey http://127.0.0.1:4750/mcp --header "Authorization: Bearer <token>"
```

## Command line & CI/CD

Cybermonkey runs a campaign **without a window** and returns an **exit code** your pipeline understands (Jenkins, GitHub Actions, GitLab CI…). The CI builds the app, then asks a **test machine** (a Mac or PC with devices or emulators, set up as a self-hosted agent/runner) to install it and play the campaign: a throwaway CI runner has no phone, so the engine runs where the devices are.

```sh
/Applications/Cybermonkey.app/Contents/MacOS/Cybermonkey --cli run \
  --project "Atlas Mobile" --env staging \
  --android-app app-debug.apk --fresh --out reports
```

- **Installs the build** (`.apk`, simulator `.app`, iPhone `.ipa`), optionally uninstalling first for a blank start (`--fresh`).
- **Exit codes** that tell _the app is broken_ (`1`) from _the machine is broken_ (`2`): a missing device or a run that executed nothing is never green. `3` = timeout or interruption.
- **Reports** in `junit.xml`, `html.html`, `json.json` (or any export format), plus screenshots and videos with `--artifacts`.
- Same projects, paired devices, environments (`--env`, for the run only) and interruption handling as the app.

Jenkins, GitHub Actions and GitLab examples, every option, and what it does not do yet: [docs/cli.md](docs/cli.md) (French).

## Integrations: Git, notifications, test tools, tickets

_Settings → Integrations._ Everything is optional and off by default. These features react to the app's events (a step fails, a run ends, a scenario is edited) and also work from the [command line](docs/cli.md) in CI/CD.

- **Git** — if the projects folder is a git repository, the tab says so (branch, upstream, changes, ahead/behind) and can offer to **pull** (on start, every N minutes) and to **commit + push** after something is created, edited or run. **Always through a confirmation window** that lists the files and lets you edit the commit message. It never merges, rebases, overwrites or force-pushes: pulls are fast-forward only, and on a conflict or diverged history it tells you and touches nothing.
- **Slack, Teams, e-mail** — notify on a **regression** (a step that used to pass and now fails; one message per run), on each **failing test** (off by default, capped per run), on **campaign progress** (every 5, 10, 20, 25 or 50 %, each threshold once) and at the **end of a run**. Optionally include the AI analysis, and screenshot and video (**e-mail only**: Slack and Teams webhooks cannot carry files).
- **TestRail, Azure Test Plans** — send a run's results back to the tool, for scenarios linked to a case by import. Never on by default; _with confirmation_ or _automatic_. Not yet tested against a live instance. Squash TM is not supported (its results API could not be verified).
- **Jira, GitHub tickets** — create a ticket on a regression, once per set of regressions (no duplicate while the ticket is open). For Jira, fixed extra fields as JSON, and an optional **AI-written ticket**: you describe your custom fields in free text (or paste an example `curl`) and the AI drafts the ticket; Cybermonkey validates it and sends the request itself — the AI never sees your token, and cannot change the project, issue type or reporter.
- **Secrets** (tokens, webhooks, SMTP password) are stored apart from settings and the project, encrypted by the system when possible; in CI they come from environment variables such as `CYBERMONKEY_JIRA_TOKEN`. Values of secret-looking project variables are masked in every message.

Full guide: [docs/integrations.md](docs/integrations.md) (French).

## Remote devices and device farms

Test on phones **that are not plugged into this machine** (_Settings → Devices_): an Android phone reached **over the network** (`adb connect`, with Android 11+ pairing), a **device cloud** (**BrowserStack**, **Sauce Labs**, **AWS Device Farm**) or **your own Appium server**. Each remote device becomes a device in the Devices panel, usable in runs, AI exploration and recording.

- **Cost under control**: a cloud session only starts during a run, an exploration or a recording, **ends with it**, and a session opened by hand closes after N idle minutes.
- **Your application** is sent to the provider (button in settings, `--android-app` / `--ios-app` on the command line, or `remote upload` once per pipeline).
- **In CI**: `--android-device remote:<id>`, `--adb-host`, `remote test|upload|status|adb-connect|adb-pair`. A cloud session that cannot open is an infrastructure error (exit 2), never a test failure. Keys come from environment variables (`BROWSERSTACK_ACCESS_KEY`, `SAUCE_ACCESS_KEY`, `AWS_SECRET_ACCESS_KEY`…).
- **Not tested on a real account**: checked against simulated servers (and the AWS signature against AWS's published example). No tunnel (BrowserStack Local), no device catalog.

Full guide: [docs/remote-devices.md](docs/remote-devices.md) (French).

## Download

| System                    | Installer                                                                                         | Notes                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **macOS** (Apple Silicon) | [`Cybermonkey-<version>-mac-arm64.dmg`](https://github.com/pickywawa/cybermonkey/releases/latest) | Open the DMG and drag Cybermonkey into Applications. Locally ad-hoc signed (no Apple notarization): allow it in **System Settings → Privacy &amp; Security → Open Anyway** on first launch. |
| **Windows** (x64)         | [`Cybermonkey-<version>-win-x64.exe`](https://github.com/pickywawa/cybermonkey/releases/latest)   | NSIS installer (per-user, changeable folder). **Not code-signed**: SmartScreen shows “Windows protected your PC” → **More info → Run anyway**.                                              |
| Linux, Intel Mac          | build from source                                                                                 | See _Development_ below.                                                                                                                                                                    |

Built-in updates detect later stable releases and open the installer for your system.

### What works on Windows

Cybermonkey runs on Windows 10/11 and drives **Android** devices and emulators: AI creation, recording, import, campaigns, interruption handling, environments, the MCP server, video, device log (logcat) and visual comparison all work.

**iOS does not work on Windows.** iOS simulators, the WebDriverAgent build and device discovery rely on Xcode (`simctl`, `devicectl`, `xcodebuild`), which only exists on macOS. An advanced mode (preinstalled/external WDA for an iOS 18+ iPhone plus a RemoteXPC tunnel, see the [Appium XCUITest docs](https://appium.github.io/appium-xcuitest-driver/latest/guides/non-macos-hosts/)) is present in the settings but is **neither tested nor guaranteed**. Use a Mac for iOS.

Other Windows notes: the Android SDK (`%LOCALAPPDATA%\Android\Sdk`) and Android Studio’s bundled JDK are detected automatically; otherwise install platform-tools and a JDK (`winget install Google.PlatformTools EclipseAdoptium.Temurin.21.JDK`) or set `ANDROID_HOME` / `JAVA_HOME`. The Windows installer is built and unit-tested on GitHub’s Windows runners; device runs have been validated on macOS.

## Device setup

| Target  | Requirements                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------- |
| Android | Android Platform Tools (`adb`), a JDK, USB debugging; emulators work too.                                                  |
| iOS     | macOS + Xcode. Simulators need no signing; physical iPhones need Developer Mode, a Team ID and a WebDriverAgent bundle id. |

Appium, UiAutomator2 and XCUITest are bundled. Open a device’s **Diagnostics** to see what is missing and how to fix it. Full guide: [Help](https://pickywawa.github.io/cybermonkey/aide.html).

## Data and AI

Projects, variables, captures and results stay on your machine. The selected AI provider receives the relevant request and UI context using **your own** account; no Cybermonkey account exists. Variables are **not** an encrypted vault: scenarios store `${NAME}` placeholders, values live in the project folder.

## Development

Node.js **22.12+**.

```sh
git clone https://github.com/pickywawa/cybermonkey.git
cd cybermonkey
npm ci
npm run dev
```

| Command                             | Purpose                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                       | Vite + TypeScript watch + Electron with automatic backend restart. |
| `npm run dev:web`                   | Browser preview with demo data (no devices, no real AI).           |
| `npm run typecheck && npm test`     | Types and unit tests.                                              |
| `npm run build`                     | Production build.                                                  |
| `npm run dist -- --mac dmg --arm64` | macOS installer.                                                   |
| `npm run site`                      | Regenerate the website in `site/`.                                 |

Use `CYBERMONKEY_USER_DATA=/absolute/path npm run dev` for an isolated profile. Architecture and how to add a feature: [docs/architecture.md](docs/architecture.md).

MIT · © 2026 pickywawa
