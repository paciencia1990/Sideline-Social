# Expo SDK 57 Compatible Patch Consolidation and Verification

Date: 2026-08-20

Branch: `chore/expo-sdk57-patch-alignment`

HEAD and comparison base: `1ba61c5` (`origin/main` was also `1ba61c5` during verification)

## Outcome

The Expo SDK 57 patch alignment and the previously verified, semver-compatible dependency-security patches are consolidated in the current maintenance working tree. All requested static checks, 71 non-emulator regression gates, 30 Firebase emulator/rules suites, and both production mobile JavaScript exports passed. Final product-test failures: **0**.

During consolidation and verification, no commit, push, merge, Firebase deployment, EAS build, provider-setting change, or data mutation was performed. The completed change set may be committed and pushed afterward under a separate explicit instruction.

## Root cause and consolidation scope

The current Expo alignment work and the compatible security work had diverged from the same base commit (`1ba61c5`). The verified security work existed on sibling branch `chore/dependency-compatible-patches` at commit `8cd0073`, so it was absent from the current Expo maintenance branch rather than reverted by an Expo package operation.

The consolidation preserved the current branch and all existing work. It added the compatible root dependency resolutions and repaired three stale pagination-era regression tests. The three test repairs are byte-for-byte equivalent to their verified versions in `8cd0073`:

- `scripts/test-performance-core.cjs`
- `scripts/test-coach-communication-regressions.cjs`
- `scripts/test-private-message-visibility.cjs`

Those test failures were stale assertions that still expected unbounded team-history reads. The production behavior correctly uses bounded pagination; no production behavior was changed to satisfy the tests.

The Functions dependency manifests were not changed. The pre-existing untracked `docs/dependency-security-triage.md` was preserved and not edited.

## Resolved dependency versions

### Expo SDK 57 alignment

| Package | Resolved version |
| --- | ---: |
| `expo` | `57.0.15` |
| `expo-asset` | `57.0.13` |
| `expo-audio` | `57.0.4` |
| `expo-constants` | `57.0.13` |
| `expo-dev-client` | `57.0.14` |
| `expo-file-system` | `57.0.5` |
| `expo-image-manipulator` | `57.0.12` |
| `expo-image-picker` | `57.0.12` |
| `expo-linking` | `57.0.7` |
| `expo-location` | `57.0.12` |
| `expo-notifications` | `57.0.13` |
| `expo-router` | `57.0.15` |

### Compatible security patches

| Package | Resolved version(s) |
| --- | ---: |
| `undici` | `6.28.0` |
| `brace-expansion` | `1.1.18`, `5.0.9` |
| `js-yaml` | `4.3.1` |
| `protobufjs` | `7.6.5` |

`npm ls --all` completed successfully for the complete target set. No vulnerable predecessor of these target versions remains in the installed tree. The root lockfile and manifest are synchronized, and clean root and Functions installs completed successfully.

## Verification results

### Install, dependency, and static gates

- Root `npm ci`: passed; 1,026 packages installed.
- Functions `npm --prefix functions ci` with pinned Node `22.23.1` / npm `10.9.8`: passed; 241 packages installed.
- Functions reproducibility under the pinned Node 22 toolchain: passed.
- `npx expo install --check`: passed; dependencies are up to date.
- TypeScript typecheck: passed.
- ESLint: passed; only the repository's existing legacy ESLint-configuration notice was emitted.
- Functions build: passed under Node 22.
- Functions packaging validation: passed.
- `git diff --check`: passed; Git emitted only expected LF-to-CRLF working-copy notices on Windows.
- Functions `package.json` and `package-lock.json` remain identical to `HEAD`.

### Expo Doctor

Latest Expo Doctor result: **19/21 checks passed**. The two findings are compatibility/maintenance notices rather than failures introduced by this consolidation:

1. Native `android`/`ios` directories coexist with app-config native properties. Expo warns that Continuous Native Generation/EAS will not automatically synchronize fields such as orientation, icons, scheme, UI style, locales, platform configuration, and plugins into checked-in native projects.
2. `react-native-nitro-google-signin` is reported as untested on React Native's New Architecture.

### Release configuration validation

- Android production backup/release configuration: passed, including the Gradle release-bundle validation. Native autolinking reported the intended Expo patch versions.
- iOS production configuration: passed. `GOOGLE_SERVICES_INFO_PLIST` was not present in the local environment, so the external native Firebase plist could not be independently verified; no configuration or secret was changed.
- Production legal configuration: the first local validation/export attempts correctly stopped because required public URL environment variables were absent. Structural validation and the successful exports used public project-domain placeholder URLs supplied only to the child process. No repository configuration was modified.

### Non-emulator regression gates

**71/71 passed**: 70 repository gates under the root-supported toolchain plus the dedicated reproducibility gate under pinned Node 22. Coverage included:

- federated authentication, notifications, and deep links;
- friend search/request flows, private messaging, image and voice messages, deletion, forwarding, and caching;
- calendars, document picker, location/maps, squad discovery, schedules, bounded pagination, and archive behavior;
- lobby creation/join/start, synchronized starts, Trivia Blitz, Spot the Difference, Bomb Defusal, and star/reward behavior;
- Functions build, packaging, configuration, security, and dependency-reproducibility checks.

An initial aggregate runner invoked the Node-22-only reproducibility gate from Node 24 and received the expected runtime-version rejection. Running that gate with its documented Node 22 toolchain passed; this was a runner/toolchain mismatch, not a product failure.

### Firebase emulator and rules gates

**30/30 passed**, covering Authentication, Firestore, Realtime Database, Storage, and callable/trigger Functions behavior.

Two suites encountered local service-startup failures before their test code ran:

- `test:emulator:friend-search`: Functions definition initialization exceeded the emulator's 10-second startup window.
- `test:firestore:friend-request-rules`: Firestore port 8080 was not active within the 60-second startup window.

Each suite passed on an immediate isolated retry without a code or configuration change. Final emulator/rules failures: **0**. Expected local warnings about unavailable test secrets, callable App Check state, and Firebase package age did not fail any gate.

### Production JavaScript exports

Both minified production-mode exports passed with external source maps and bytecode disabled only to permit source inspection:

| Platform | Metro modules | Assets | JavaScript | Source map | Map sources |
| --- | ---: | ---: | ---: | ---: | ---: |
| Android | 3,881 | 79 | 7.4 MB | 23 MB | 3,888 |
| iOS | 3,791 | 75 | 7.2 MB | 22 MB | 3,798 |

Source-map inspection found the runtime Expo packages at the expected root `node_modules` paths and found **0** nested alternate copies of the target Expo packages on either platform. `expo-dev-client` is correctly absent from production runtime bundles. The compatible security targets are build/server/tooling dependencies and were not unexpectedly pulled into either mobile runtime bundle.

## Deferred advisories

No forced audit remediation was used.

- Root audit: **17 total** (`9 moderate`, `8 high`, `0 critical`). These are npm's transitive/package-amplified findings rooted in the deferred `image-size` denial-of-service advisories and the deferred `uuid` buffer-bounds advisory through the Expo/Metro/config tooling graph.
- Functions audit: **9 total** (`9 moderate`, `0 high`, `0 critical`). These are propagated through the deferred `uuid` chain and the current Firebase Admin/Functions dependency graph.

The available automated fixes require incompatible or major dependency movement (including major Firebase Admin/Functions changes or an inappropriate Expo downgrade) and are outside this compatible-patch task. `image-size`, `uuid`, major Firebase upgrades, and any behavior-changing remediation remain intentionally deferred for separate evaluation.

## Deployment and native-build decision

A Firebase deployment is **not required** for this change set because Functions manifests/code, Firebase rules, indexes, and provider configuration were not changed.

A new Android and iOS development/native build **is required before device acceptance testing** because the Expo alignment includes native modules. An already-installed development client will not incorporate those native dependency patches.

Recommended next action:

1. Review the five tracked source/manifest changes and this report.
2. After approval, create fresh Android and iOS development builds.
3. Validate on physical devices, prioritizing notifications, deep links, location/maps, audio, image picker/manipulation, and federated sign-in.
4. Handle the deferred `image-size`, `uuid`, and major Firebase upgrade paths in separate, explicitly scoped work.
