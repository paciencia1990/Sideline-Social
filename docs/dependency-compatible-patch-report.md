# Dependency compatible patch report

**Verification date:** 2026-08-20 (America/New_York)

**Branch:** `chore/dependency-compatible-patches`

**Base commit:** `1ba61c56c783b56a59947e00fbccb4eecee344b7`

**Base relationship:** `main`, `origin/main`, and `HEAD` all pointed to the base commit before the branch was created.

**Runtimes:** root Node.js 24.16.0 with npm 11.13.0; Cloud Functions Node.js 22.23.1 with npm 10.9.8.

## 1. Branch and starting state

The branch was created locally from the exact audited base above. The requested branch did not already exist. The only pre-existing worktree item was the untracked `docs/dependency-security-triage.md` report (45,073 bytes, last modified 2026-08-19 22:29:29); it was preserved and not edited by this task.

No commit, push, deployment, EAS build, store submission, production invocation, or production-data operation was performed.

## 2. Exact files changed

Task changes are limited to:

- `package.json`: changed the existing `overrides.undici` value from 6.27.0 to 6.28.0.
- `package-lock.json`: npm-generated compatible re-resolution of six installed package records.
- `scripts/test-performance-core.cjs`: replaced the obsolete single-`Promise.all` assertion with bounded query, look-ahead, deterministic cursor, realtime-newest/one-time-older, conditional legacy-read, visible-profile, coach-resolution, parallel-phase, and no-unbounded-scan contracts.
- `scripts/test-coach-communication-regressions.cjs`: replaced the unconditional legacy-read expression check with behavioral summary/fallback mapping cases for unread/read, missing and partial summaries, legacy reads, arrival order, tombstones, archived history, retries, visible-page work, authorization, and bounded latest preview.
- `scripts/test-private-message-visibility.cjs`: replaced nullable-initialization checks with visibility-gate behavior for partial hydration, reconnect, stale generations, empty conversations, older-page filtering, authorization, route/account clearing, and preserved delete/playback semantics.
- `docs/dependency-compatible-patch-report.md`: this report.

The pre-existing untracked `docs/dependency-security-triage.md` is carried on the branch but is not a task change.

No production application JavaScript/TypeScript, asset, Spot-the-Difference content, native Android/iOS file, Functions source, Firebase configuration, Rule, or index changed.

## 3. Exact package versions before and after

| Package/installation | Before | After | Result |
|---|---:|---:|---|
| Root Undici override and shared installation | 6.27.0 | 6.28.0 | Patched |
| `@expo/config-plugins` Brace Expansion | 5.0.7 | 5.0.9 | Patched within `^5.0.5` |
| `@typescript-eslint/typescript-estree` Brace Expansion | 5.0.7 | 5.0.9 | Patched within `^5.0.5` |
| Root legacy-tooling Brace Expansion | 1.1.16 | 1.1.18 | Patched within `^1.1.7` |
| Shared JS-YAML | 4.3.0 | 4.3.1 | Patched within existing parent ranges |
| Shared ProtobufJS under `@grpc/proto-loader` | 7.6.4 | 7.6.5 | Patched within `^7.2.5` |

The already-safe Expo Brace Expansion copies remained at 5.0.9. No 6.27.0 Undici, 5.0.7 or 1.1.16 Brace Expansion, 4.3.0 JS-YAML, or 7.6.4 ProtobufJS record remains.

Intentional non-target versions remain unchanged: `image-size@1.2.1`, root `xcode -> uuid@7.0.3`, `firebase@10.14.1`, Expo SDK 57 packages, React Native 0.86.2, and all Cloud Functions packages.

## 4. Dependency paths before and after

- Undici: `expo-atlas -> @expo/server` and `firebase -> @firebase/auth`, Auth Compat, Firestore, Functions, and Storage all shared the existing root override. Only the override/resolution changed from 6.27.0 to 6.28.0; parent versions and paths did not change.
- Brace Expansion 5.x production/build path: `expo`/`expo-splash-screen`/Nitro Google Sign-In `-> @expo/config-plugins@57.0.8 -> glob@13.0.6 -> minimatch@10.2.5 -> brace-expansion`, changed from 5.0.7 to 5.0.9.
- Brace Expansion 5.x development path: `eslint-config-expo@57.0.1 -> @typescript-eslint/parser@8.64.0 -> @typescript-eslint/typescript-estree@8.64.0 -> minimatch@10.2.5 -> brace-expansion`, changed from 5.0.7 to 5.0.9.
- Brace Expansion 1.x legacy tooling: ESLint 8/9, legacy config, import/react plugins, and `glob@7.2.3` `-> minimatch@3.1.5 -> brace-expansion`, changed from 1.1.16 to 1.1.18. It remained a separate 1.x installation; no cross-major override was used.
- JS-YAML: Expo CLI/XCPretty, ESLint 8, and ESLint 9 config parents still share one installation, changed from 4.3.0 to 4.3.1. Observed parent ranges remain `^4.1.0` and `^4.3.0`.
- ProtobufJS: `firebase@10.14.1 -> @firebase/firestore@4.7.3 -> @grpc/proto-loader@0.7.15 -> protobufjs`, changed from 7.6.4 to 7.6.5. `@grpc/proto-loader` still declares `^7.2.5`.

No parent package was upgraded, downgraded, added, or removed.

## 5. Root audit counts before and after

The audit service changed independently between the triage and this patch run. All snapshots are retained so the transient zero response is not mistaken for zero monitored risk.

| Snapshot | Production package-level | Full package-level | Unique upstream advisories |
|---|---:|---:|---:|
| 2026-08-19 triage, before patch | 30: 10 high, 20 moderate | 31: 10 high, 21 moderate | 10 |
| 2026-08-20 immediately before resolution, pinned root npm | 0 | 0 | 0 returned by the live service |
| 2026-08-20 after resolution, pinned root npm | 0 | 0 | 0 returned by the live service |
| 2026-08-20 final clean-install audit | 17: 8 high, 9 moderate | 17: 8 high, 9 moderate | 3 intentionally unresolved |

The zero response was also reproduced with npm 10 against the root lock before the live feed returned the current 17-package result. Direct installed-version and path verification, not either transient live response, proves removal of the seven targeted upstream advisories. The 17 final root package-level findings are amplification through Expo/Metro/Nitro/Xcode parents of the two `image-size` advisories and the UUID advisory already accepted below.

Functions remained 9 moderate package-level findings in both production and full audit under its pinned Node 22/npm 10 environment, representing one UUID upstream advisory. The Functions lockfile did not change. An earlier npm 11 read of the Functions lock also returned a transient zero response, reinforcing that the live feed/client response is not a reliable basis for declaring the repository vulnerability-free.

## 6. Advisories removed and intentionally unresolved

Direct version checks confirm removal of:

- Both monitored Brace Expansion denial-of-service advisories (GHSA-mh99-v99m-4gvg and GHSA-rgw5-rvv9-x895).
- The JS-YAML `!!omap` denial-of-service advisory (GHSA-5p4m-2wfm-xmqj).
- The ProtobufJS non-terminating parser advisory (GHSA-j3f2-48v5-ccww).
- All three monitored Undici advisories (GHSA-8xcm-r25x-g524, GHSA-m8rv-5g2x-5cg5, and GHSA-v3r7-h72x-cjcm).

The following monitored findings intentionally remain even though the current root audit response omits them:

- `image-size@1.2.1`: `expo -> @expo/cli/@expo/metro-config -> @expo/metro@56.0.0 -> metro@0.84.4 -> image-size@1.2.1`; GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq. No patched release was available in the triage.
- Root `uuid@7.0.3`: `expo/expo-splash-screen -> @expo/config-plugins -> xcode@3.0.1 -> uuid@7.0.3`; GHSA-w5hq-g745-h8pq. This build-only major migration is outside this branch.
- Functions UUID instances, all under `firebase-admin@12.7.0`: direct `uuid@10.0.0`; `@google-cloud/firestore@7.11.6 -> google-gax@4.6.1 -> uuid@9.0.1`; and `@google-cloud/storage@7.21.0 -> gaxios@6.7.1` / `teeny-request@9.0.0 -> uuid@9.0.1`. These produce the unchanged 9 moderate Functions package-level findings from GHSA-w5hq-g745-h8pq.

The project must not be represented as having zero monitored vulnerabilities.

## 7. Lockfile diff and source integrity

`npm update --package-lock-only` with npm 11.13.0 produced a 40-line lockfile diff: 20 removed lines and 20 added lines. Exactly six package records changed:

1. `node_modules/@expo/config-plugins/node_modules/brace-expansion`: version, registry tarball, integrity, and the package's published Node engine metadata.
2. `node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion`: the same 5.0.7-to-5.0.9 metadata change.
3. `node_modules/brace-expansion`: version, registry tarball, and integrity for 1.1.16-to-1.1.18.
4. `node_modules/js-yaml`: version, registry tarball, and integrity for 4.3.0-to-4.3.1.
5. `node_modules/protobufjs`: version, registry tarball, and integrity for 7.6.4-to-7.6.5.
6. `node_modules/undici`: version, registry tarball, and integrity for 6.27.0-to-6.28.0.

No package record was added or removed. The root lock still has 1,099 package records. Every populated `resolved` value is an immutable HTTPS npm-registry tarball; there are zero Git, arbitrary HTTP, local-file, link, workspace, or mutable sources. Every changed package retains an integrity hash. No direct dependency or development dependency changed.

## 8. Clean-install results

- Root `npm ci` passed under Node 24.16.0/npm 11.13.0 and installed 1,036 packages from the updated lock.
- Functions `npm ci` passed under Node 22.23.1/npm 10.9.8 and installed 241 packages.
- Functions TypeScript build passed under Node 22.
- Functions clean-install/reproducibility passed under Node 22.23.1.
- Functions packaging/isolation passed.
- `functions/package.json` SHA-256 remained `AEE34C1A51919418AE25C2AD0B39EA95364A4556740B6C440D8C43464B248F41`.
- `functions/package-lock.json` SHA-256 remained `5D02EC45598B9A4C6B8F496621CB7CB16E2B7D806CE9F17480579E4A67A48C5D`.

## 9. Tests and emulator results

Passing primary gates:

- Root typecheck.
- Root lint.
- Functions build under Node 22.
- Functions packaging and clean Node 22 reproducibility.
- All 71 registered non-emulator `test:*` scripts passed: 70 under root Node 24 and Functions clean-install/reproducibility under pinned Node 22.23.1.
- All 30 registered Firebase emulator/rules suites passed on the dependency patch. After repairing the test contracts, all nine required affected suites were rerun and passed: team-history pagination, Parent Team Rules, Team Messages Functions and Rules, Team Schedule Functions and Rules, Notifications Functions and Rules, and account standing.
- Android and iOS production exports passed.
- `git diff --check` passed.

The three failures were confirmed as regression-test drift, not production defects:

- `test:performance-core` originally protected parallel loading and avoidance of announcement N+1 work, but encoded the pre-pagination three-result `Promise.all` shape. Its replacement protects the actual contract: page size 20 plus one look-ahead, created-time/document-ID cursor ordering, bounded newest realtime snapshots, one-time older reads, summary-backed read elision, visible-page-only hydration, coach resolution in an independent phase, and no unbounded collection read.
- `test:coach-communication-regressions` originally protected legacy read-document interpretation, but assumed every item always had a `readStates[index]`. Its replacement exercises known unread/read IDs, missing and partially available summaries, legacy read documents, summary/page arrival order, moderated/deleted items, archived history, duplicate summary IDs, unknown unread totals, visible-only fallback work, Rules authorization, bounded latest preview, and the unchanged voice/Coach communication contracts.
- `test:private-message-visibility` originally used null canonical state as a proxy for hidden-state readiness. The paginated listener now uses separate chunk-readiness state, so empty canonical storage is safe. Its replacement exercises no emission before every hidden chunk, valid loaded-empty publication, reconnect reset, stale-generation rejection, pre-display older-page filtering, account/route state clearing, participant authorization, read-only archive behavior, participant-private hide, shared tombstone deletion, and unchanged voice playback revocation.

The synthetic 1,000-item unit and emulator fixtures reported 23 bounded initial parent reads, announcement/reply/private-message/upcoming-event realtime caps of 21/31/41/51, and zero collapsed Past Events reads. Cursor cases include identical timestamps, no duplicates or omissions, a realtime arrival between pages, and secure direct-by-ID notification routing. Production code was unchanged.

Focused commands `test:performance-core`, `test:coach-communication-regressions`, `test:private-message-visibility`, `test:team-history-pagination`, `test:parent-teams`, `test:team-messages`, `test:team-schedule`, and `test:notifications` all passed.

Root `npm ls --all` reports the same four documented peer-health problems: React 19 outside Lucide React Native's declared range, Firebase's AsyncStorage declaration versus installed 2.2.0, missing optional `@react-native/metro-config` for Worklets, and missing `@testing-library/dom` for the testing-library peer. No new problem appeared.

## 10. Android/iOS source-map verification

Temporary production exports used `APP_VARIANT=production`, external source maps, disabled bytecode only for inspection, and a cold Metro cache.

| Platform | Modules | Mapped sources | JS size | Target package-path hits |
|---|---:|---:|---:|---:|
| Android | 3,879 | 3,886 | 7,355,666 bytes | 0 |
| iOS | 3,790 | 3,797 | 7,200,898 bytes | 0 |

Exact `/node_modules/<package>/` matching found zero Android and zero iOS source-map sources for `undici`, `brace-expansion`, `js-yaml`, `protobufjs`, `image-size`, `uuid`, and `@grpc/proto-loader`.

A broad substring search initially found three sources containing “uuid” on each platform, all under `expo-modules-core/src/uuid`; these are Expo Modules' internal UUID utility and are not the vulnerable npm `uuid` package. Exact package-path matching is zero.

The Android/iOS module counts match the triage baseline. None of the patched packages entered either runtime bundle, no application or asset file changed, and no runtime-bundle change attributable to this dependency patch was found.

## 11. Expo install and Doctor results

Typecheck and lint passed. The live Expo compatibility service changed after the 2026-08-19 triage:

- `expo install --check` now requests 12 newer Expo SDK 57 patch releases.
- Exact live recommendations were `expo ~57.0.15`, `expo-asset ~57.0.13`, `expo-audio ~57.0.4`, `expo-constants ~57.0.13`, `expo-dev-client ~57.0.14`, `expo-file-system ~57.0.5`, `expo-image-manipulator ~57.0.12`, `expo-image-picker ~57.0.12`, `expo-linking ~57.0.7`, `expo-location ~57.0.12`, `expo-notifications ~57.0.13`, and `expo-router ~57.0.15`.
- `expo-doctor@latest` now passes 18 of 21 checks rather than the triage's 19 of 21.
- The two previously documented advisories remain: checked-in Android native folders with app-config fields, and incomplete New Architecture metadata for Nitro Google Sign-In.
- The third current failure is the same new 12-package Expo patch-alignment recommendation returned by `expo install --check`.

No Expo package or lock record changed in this branch, so this is externally driven baseline drift, not lockfile churn from the compatible security patches. The prohibited Expo update was not performed and no warning was suppressed.

## 12. Functions dependency confirmation

Cloud Functions manifests and locks are byte-identical to the starting state. `firebase-admin@12.7.0`, `firebase-functions@5.1.1`, Node 22 runtime configuration, 153 exported Functions, regions, generations, triggers, schedules, and secret bindings were not changed. The Functions audit remains 9 moderate package-level findings from one UUID advisory under the pinned Functions environment.

## 13. Native-build impact

No Android or iOS native file, app configuration, Expo plugin, React Native package, or native dependency changed. No native rebuild is specifically required for this patch. A normal future build will consume the patched build/dependency environment.

## 14. Firebase-deployment impact

No Firebase client version, Functions dependency/source, Rule, index, RTDB rule, Storage rule, runtime, or configuration changed. No Firebase, Rules, or index deployment is required. Emulator verification was local and used test project IDs; no production deployment or data mutation occurred.

## 15. Store-release impact

No immediate store release is required. The patched packages remain outside Android/iOS runtime source maps, and no app feature or native configuration changed. Normal future store builds will use the updated dependency/build environment.

## 16. Rollback instructions

Before a commit, restore only `package.json` and `package-lock.json` from base commit `1ba61c56c783b56a59947e00fbccb4eecee344b7`, then run the pinned root `npm ci`. Do not touch either documentation report when rolling back the dependency files.

After an owner-reviewed commit, roll back with a normal Git revert of that narrow manifest/lock/report commit followed by root `npm ci`. No Firebase rollback, native artifact rollback, Rules/index rollback, or production-data action is needed because none was deployed.

## 17. Remaining owner decisions

1. Review and approve the six-record compatible dependency diff.
2. Decide whether to take the newly available Expo SDK 57 patch alignment in a separate Expo dependency-health branch; do not mix it into this security patch.
3. Continue the documented risk acceptances and separate migration planning for `image-size`, root UUID, and Functions UUID.
4. Continue treating live audit-count changes as feed snapshots and verify installed versions directly; the service changed from an implausible zero to 17 root package-level findings during this work.

## 18. Temporary-artifact cleanup

The verified Android/iOS export directory under the system temp directory was deleted. Firestore, RTDB, Firebase, and emulator UI debug logs created in the repository were deleted. Emulator processes shut down after every suite. No export, source map, emulator data, debug log, generated native project, EAS artifact, or audit JSON was left for commit.

The clean-installed root and Functions `node_modules` trees and ignored compiled Functions output remain as normal local verification state; they do not appear in Git status. The final shell runtime remains Node 24.16.0/npm 11.13.0.

## Verdict

**COMPATIBLE PATCHES VERIFIED**

The six dependency records resolved compatibly, clean installs/builds passed, all 71 registered non-emulator scripts and every required affected emulator/Rules suite passed, the dependency patch's full 30-suite emulator gate remains green, and no targeted package entered a mobile runtime bundle. The repaired assertions now protect the bounded pagination, summary fallback, authorization, and visibility behavior they were intended to cover. Expo's separately deferred 18/21 advisory baseline remains unchanged and is not a failure of this compatible patch.
