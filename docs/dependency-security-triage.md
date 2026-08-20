# Dependency security triage

**Repository:** Sideline Social mobile application and Firebase Cloud Functions

**Audit date:** 2026-08-19 (America/New_York)

**Baseline:** `main` at `1ba61c56c783b56a59947e00fbccb4eecee344b7`; `origin/main` was the same commit; the worktree was clean

**Scope:** analysis and remediation planning only; no dependency, native, Firebase, rules, index, application-code, deployment, or production-data change

## 1. Executive summary

The current audits report no critical vulnerabilities. The root application reports 30 package-level production findings (10 high, 20 moderate) and 31 findings when development dependencies are included (10 high, 21 moderate). Cloud Functions reports 9 package-level production/full findings, all moderate. Those package-level totals are amplification through parent packages: the two lockfiles contain **10 distinct upstream advisories** affecting six package names in the root and one of those package names (`uuid`) in Functions.

No advisory is demonstrably reachable from an Android or iOS user. Temporary production exports for both platforms succeeded, and their complete source maps contained zero sources from `brace-expansion`, `image-size`, `js-yaml`, `protobufjs`, `undici`, `uuid`, or `@grpc/proto-loader`. Firebase's React Native/browser implementations were selected; its vulnerable Node implementations were not shipped.

The Functions deployment does contain four vulnerable `uuid` installations through `firebase-admin` and Google client libraries. However, the defect is limited to the `v3`, `v5`, and `v6` APIs when a caller supplies an undersized output buffer or invalid offset. Sideline Social does not import `uuid`. Static inspection found only `firebase-admin` Eventarc code calling `uuid.v4()` with no output buffer, which is explicitly outside the advisory. Loading all 153 compiled Function exports under the pinned Node 22 runtime loaded none of the four `uuid` installations or their affected parent clients. Therefore this is a deployed dependency concern, but no callable, HTTP endpoint, Firestore/RTDB trigger, schedule, Storage flow, or administrator-controlled path to the vulnerable API was found.

The clearest near-term remediation is a narrow change of the existing root `undici` override from `6.27.0` to `6.28.0`, followed by lockfile-only compatible refreshes to `brace-expansion` 5.0.9/1.1.18, `js-yaml` 4.3.1, and `protobufjs` 7.6.5. These changes were **not** made during this triage. The `image-size` advisories currently have no patched release. Root `uuid` and Functions `uuid` require upstream/coordinated major migrations rather than an unverified forced override.

Contextual result: no P0 or P1 item was identified. Six advisories are solely P2 planned remediation, three are solely P3 monitor/document, and the single UUID advisory is P3 for its root build-tool instance but P2 for its four Functions instances. This does not erase their upstream severity.

## 2. Audit date, runtimes, registry, and repository state

| System | Runtime used | npm | Declared runtime | Registry |
|---|---:|---:|---|---|
| Root Expo application | Node 24.16.0 | 11.13.0 | `.nvmrc` 24.16.0; `engines.node >=22.13 <25` | `https://registry.npmjs.org/` |
| Cloud Functions | Node 22.23.1 | 10.9.8 | `functions/.nvmrc` 22.23.1; `engines.node` 22; `firebase.json` `nodejs22` | `https://registry.npmjs.org/` |

Both lockfiles use lockfile version 3. The root lock contains 1,099 package records; the Functions lock contains 242. Root audit metadata classified 729 production, 359 development, and 65 optional dependencies (1,098 total dependencies). Functions classified 140 production, 1 development, and 101 optional dependencies (241 total dependencies).

No `AGENTS.md` was present in the repository or its parent directories. The relevant performance, release-hardening, federated-authentication, moderation, Node 22 migration, backend-readiness, friend-chat, and UGC/support reports were reviewed before analysis.

The configured Functions platform remains Node 22, first-generation Functions, primarily `us-central1`, with existing trigger definitions and secret bindings unchanged. No production Function was invoked. No secret value, credential, signing material, token, private key, environment value, or user data was printed or recorded.

## 3. Root and Functions advisory counts

| Audit | Critical | High | Moderate | Low | Package-level total | Distinct upstream advisories |
|---|---:|---:|---:|---:|---:|---:|
| Root, `--omit=dev` | 0 | 10 | 20 | 0 | 30 | 10 |
| Root, full tree | 0 | 10 | 21 | 0 | 31 | 10 |
| Functions, `--omit=dev` | 0 | 0 | 9 | 0 | 9 | 1 |
| Functions, full tree | 0 | 0 | 9 | 0 | 9 | 1 |

The change from the prior performance report is a reduction of the root production high count from 12 to 10; the moderate and Functions counts are unchanged. Counts are snapshots of npm's advisory graph on the audit date and should not be used as a substitute for the normalized records below.

`npm ls --all` was healthy for Functions but returned `ELSPROBLEMS` for the root after a successful clean install. The root warnings are separate dependency-health items: `lucide-react-native@0.468.0` does not declare React 19 support, Firebase 10 declares AsyncStorage 1.x while 2.2.0 is installed, and optional/test peer packages `@react-native/metro-config` and `@testing-library/dom` are absent. Expo's own version check nevertheless reported all Expo-managed versions aligned. These peer issues should be resolved in their own dependency-health stage, not conflated with the 10 security advisories.

## 4. Unique-advisory table

“Instances” counts installed vulnerable package instances, not npm's parent-package amplification. Root production has one vulnerable `brace-expansion`; the other two appear only in the full development tree.

| npm source / GHSA / CVE | Package and installed version(s) | Upstream severity / CVSS | Scope and kind | Instances | Affected range | First patched | Context |
|---|---|---|---|---:|---|---|---|
| 1130588 / [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) / CVE-2026-14257 | `brace-expansion` 5.0.7; 1.1.16 | High / 7.5 / `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H` | Root; prod tooling + dev tooling; transitive | 3 full, 1 prod | `<1.1.17`; `>=4 <5.0.8` (installed lines) | 1.1.17, 5.0.8; superseded by the next advisory's 1.1.18/5.0.9 | P2 |
| 1130734 / [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) / CVE-2026-69152 | `brace-expansion` 5.0.7; 1.1.16 | High / 7.5 / same vector | Root; prod tooling + dev tooling; transitive | 3 full, 1 prod | `<1.1.18`; `>=4 <5.0.9` | 1.1.18, 5.0.9 | P2 |
| 1138808 / [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) / CVE-2025-71330 | `image-size` 1.2.1 | High / current GHSA 8.7 / `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:N` | Root Expo/Metro build tooling; transitive | 1 | `<=2.0.2` | None | P3 |
| 1138809 / [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) / CVE-2025-71329 | `image-size` 1.2.1 | High / current GHSA 8.7 / same vector | Root Expo/Metro build tooling; transitive | 1 | `<=2.0.2` | None | P3 |
| 1138115 / [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) / CVE-2026-59870 | `js-yaml` 4.3.0 | High / 7.5 / `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H` | Root Expo CLI + lint tooling; transitive | 1 shared | `>=4.0.0 <4.3.1` | 4.3.1 | P2 |
| 1123964 / [GHSA-j3f2-48v5-ccww](https://github.com/advisories/GHSA-j3f2-48v5-ccww) / CVE-2026-59877 | `protobufjs` 7.6.4 | Moderate / 5.3 / `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L` | Root Firebase Node/gRPC implementation; transitive production graph | 1 | `>=7.5.0 <=7.6.4` | 7.6.5 | P3 |
| 1130716 / [GHSA-8xcm-r25x-g524](https://github.com/advisories/GHSA-8xcm-r25x-g524) / CVE-2026-16728 | `undici` 6.27.0, root override | Moderate / 4.8 / `CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N` | Root Firebase Node implementations + dev server; transitive | 1 shared | `<6.28.0` | 6.28.0 | P2 |
| 1130727 / [GHSA-m8rv-5g2x-5cg5](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5) / CVE-2026-15157 | `undici` 6.27.0, root override | Moderate / 4.2 / `CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N` | Same | 1 shared | `<6.28.0` | 6.28.0 | P2 |
| 1130732 / [GHSA-v3r7-h72x-cjcm](https://github.com/advisories/GHSA-v3r7-h72x-cjcm) / CVE-2026-16729 | `undici` 6.27.0, root override | Moderate / 4.8 / `CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N` | Same | 1 shared | `<6.28.0` | 6.28.0 | P2 |
| 1119441 / [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) / CVE-2026-41907 | Root `uuid` 7.0.3; Functions 9.0.1 x3 and 10.0.0 x1 | Moderate / 7.5 / `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N` | Root iOS config tooling; Functions deployed transitive graph | Root 1; Functions 4 | `<11.1.1` | 11.1.1 | P3 root; P2 Functions |

GitHub updated both `image-size` records to CVSS 4.0 score 8.7 after the audit feed still exposed CVSS 3.1 score 7.5. This report preserves the current upstream value and notes the feed discrepancy rather than choosing the lower score.

## 5. Full dependency paths

The following paths terminate at every vulnerable installed instance. Multiple parent packages may share a single deduplicated installation.

### Root

- Production/build `brace-expansion@5.0.7`: `expo@57.0.14 -> @expo/cli@57.0.16` (also `@expo/config`, `@expo/prebuild-config`, `@expo/inline-modules`, and `expo-splash-screen`) `-> @expo/config-plugins@57.0.8 -> glob@13.0.6 -> minimatch@10.2.5 -> brace-expansion@5.0.7`. `react-native-nitro-google-signin@1.3.0 -> @expo/config-plugins@57.0.8` reaches the same instance.
- Development `brace-expansion@5.0.7`: `eslint-config-expo@57.0.1 -> @typescript-eslint/parser@8.64.0 -> @typescript-eslint/typescript-estree@8.64.0 -> minimatch@10.2.5 -> brace-expansion@5.0.7`.
- Development `brace-expansion@1.1.16`: `eslint@8.57.1` and its `@eslint/eslintrc`/legacy config paths, plus `eslint-plugin-import` and `eslint-plugin-react`, `-> minimatch@3.1.5 -> brace-expansion@1.1.16`.
- `image-size@1.2.1`: `expo -> @expo/cli/@expo/metro-config -> @expo/metro@56.0.0 -> metro@0.84.4 -> image-size@1.2.1`; the aligned React Native path `react-native@0.86.2 -> @react-native/community-cli-plugin -> metro@0.84.4` deduplicates to the same instance.
- `js-yaml@4.3.0`: production/build path `expo -> @expo/cli -> @expo/xcpretty@4.4.4 -> js-yaml@4.3.0`; development paths `eslint@8.57.1 -> js-yaml` and `eslint-config-expo -> eslint-plugin-expo -> eslint@9.39.5 -> @eslint/eslintrc@3.3.6 -> js-yaml`, all deduplicated.
- `protobufjs@7.6.4`: `firebase@10.14.1 -> @firebase/firestore@4.7.3 -> @grpc/proto-loader@0.7.15 -> protobufjs@7.6.4`; `@firebase/firestore -> @grpc/grpc-js@1.9.16 -> @grpc/proto-loader` reaches the same instance.
- `undici@6.27.0`: the root `overrides.undici` forces a shared copy for `firebase@10.14.1 -> @firebase/auth@1.7.9`, `@firebase/functions@0.11.8`, and `@firebase/storage@0.13.2`, whose declared Node dependency was 6.19.7; development path `expo-atlas@0.4.3 -> @expo/server@0.5.3 -> undici` declared `^6.18.2`.
- `uuid@7.0.3`: `expo -> @expo/cli/@expo/config-plugins -> xcode@3.0.1 -> uuid@7.0.3`.

The tree also contains non-vulnerable `brace-expansion@5.0.9` copies under current Expo packages. Their presence does not repair the separate 5.0.7 and 1.1.16 instances.

### Functions

- `functions -> firebase-admin@12.7.0 -> uuid@10.0.0`.
- `functions -> firebase-admin@12.7.0 -> @google-cloud/storage@7.21.0 -> gaxios@6.7.1 -> uuid@9.0.1`.
- `functions -> firebase-admin@12.7.0 -> @google-cloud/firestore@7.11.6 -> google-gax@4.6.1 -> uuid@9.0.1`.
- `functions -> firebase-admin@12.7.0 -> @google-cloud/storage@7.21.0 -> teeny-request@9.0.0 -> uuid@9.0.1`; `retry-request@7.0.2` from Storage and Google GAX also reaches that `teeny-request` copy.
- `firebase-functions@5.1.1 -> firebase-admin@12.7.0` is a peer path to the same four installations. It does not add a fifth `uuid` instance.

## 6. Mobile-runtime exposure

| Environment | Result |
|---|---|
| 1. Android/iOS JavaScript runtime | Firebase app/auth/firestore/functions/storage client modules are used, but none of the six vulnerable package names appeared in either source map. The selected Firebase Auth entry declares a distinct `react-native` build; vulnerable `undici` references are confined to its `node` exports. |
| 2. Android native runtime | No advisory package is a native Android library. The Android export and Android variant/Firebase OAuth tests passed. |
| 3. iOS native runtime | No advisory package is an iOS runtime library. `xcode/uuid` edits Xcode project files during configuration; it is not linked into the app. The iOS export and release-config tests passed. |
| 6. Expo/Metro build tooling | `brace-expansion`, `image-size`, `js-yaml`, and root `uuid` execute only on the developer/CI host. `image-size` reads repository asset buffers while Metro builds. |
| 7. Test/lint/development tooling | Two vulnerable `brace-expansion` copies and part of the shared `js-yaml` use belong to ESLint/TypeScript tooling. `expo-atlas` contributes a development-only path to the shared `undici`. |
| 8. Unused/unexpected packaging | None found. One small `@expo/cli/build/metro-require/require.js` runtime helper is intentionally part of Metro's bundle bootstrap; none of that helper's vulnerable Node dependencies was included. |

Android export: 3,879 modules, 7.4 MB unminified JavaScript, 23 MB source map. iOS export: 3,790 modules, 7.2 MB unminified JavaScript, 22 MB source map. The `--no-bytecode` option was used only so sources could be inspected; normal release Hermes bytecode should remain enabled.

Platform sandboxing is not the primary mitigation because the vulnerable code is absent. If it were accidentally bundled, mobile JavaScript still does not expose Node's filesystem, HTTP dispatcher, or `.proto` loader surfaces used by these records. Source-map absence is stronger evidence than that fallback observation.

## 7. Cloud Functions exposure

The Functions lockfile and package tree are cleanly isolated from the root application. A clean install/build in a temporary directory succeeded with only the Functions manifest, lockfile, TypeScript configuration, and source. Packaging checks found no `file:`, link, workspace, developer-machine, or root-package dependency.

The compiled entry point exports 153 Functions. Requiring that entry point with Node 22.23.1 registered all exports but loaded zero modules from `uuid`, `gaxios`, `google-gax`, `retry-request`, or `teeny-request`. Thus the affected code does not run at cold-start/module initialization.

Sideline Social imports the legacy namespace form of `firebase-admin` and uses Auth, Firestore, RTDB, Storage, Messaging, and callable/trigger support throughout authenticated callables, HTTP media endpoints, Firestore/RTDB triggers, and schedules. This broad use explains why the packages are deployable dependencies, but it does not establish reachability of the specific `uuid` buffer-writing methods.

Static inspection found one actual `uuid` consumer in installed Firebase Admin code: Eventarc utilities call `uuid.v4()` without a caller-provided buffer. The advisory explicitly excludes `v4`; it affects `v3`, `v5`, and `v6` only when an external output buffer/offset is supplied. No Sideline Social source or compiled output imports `uuid`, calls those methods, accepts a UUID output buffer, or passes remote input to such a buffer. The Google client parents declare `uuid` but their installed JavaScript contained no runtime import found by repository-wide search.

Result: the vulnerable packages are present in the deployed dependency closure, but affected functionality is not confirmed to execute in any exported Function. Risk would increase if Eventarc or another Google client begins using `v3`/`v5`/`v6` with caller-controlled buffer bounds, if a new direct UUID import is added, or if a future transitive version introduces such a call.

## 8. Build/CI and administration exposure

- `brace-expansion`: a malicious repository/configuration glob pattern or a compromised tool supplying an attacker-influenced brace expression can exhaust memory or CPU in a developer or CI process. Normal app inputs and network responses are not passed to Expo's glob patterns.
- `image-size`: Metro passes local asset contents to `image-size`. A crafted ICNS, JXL, or HEIF asset committed through an untrusted contribution or introduced by a compromised dependency can hang the build process. The shipped assets are repository-controlled WebP/PNG/font files and both current exports completed.
- `js-yaml`: exploitation requires an untrusted YAML document containing a large `!!omap` sequence to reach `yaml.load`. Current use is Expo Xcode-output/lint configuration tooling; no application API parses remote YAML. Repository YAML is code-reviewed.
- `protobufjs`: the vulnerable reflection path requires parsing attacker-influenced `.proto` schema text via `parse`, `Root.load`, or `Root.loadSync`. The installed package is below Firebase's Node-only gRPC loader. Sideline Social does not accept or parse `.proto` input.
- `undici`: the affected APIs are Node HTTP dispatcher retry interception, a duck-typed blob body's unvalidated `type`, and `setCookie` attributes. The mobile client uses Firebase's React Native/browser builds, and local Expo server use does not implement an application proxy/cookie service with these APIs.
- root `uuid`: `xcode@3.0.1` calls `uuid.v4()` without a buffer solely to generate Xcode project identifiers. The affected APIs are not called.

Developer/CI controls should therefore include protected branches, review of binary/asset additions, lockfile review, registry integrity/integrity hashes, clean ephemeral CI installs, time/memory limits for builds, and no use of repository contributions as unsandboxed production services.

## 9. Advisory reachability records

### Brace expansion: both GHSAs

Vulnerable functionality is recursive brace/glob expansion with unbounded output length or intermediate arrays. The prerequisite is attacker influence over a string passed directly to `expand()` or transitively to a brace-enabled glob/minimatch operation. Sideline Social source has no direct import. The vulnerable production-classified copy belongs to Expo/config tooling; development copies belong to lint/type tooling. Neither mobile export contains the package. It does not execute in Functions. Existing mitigations are repository-controlled patterns, reviewed configuration, and bounded CI workers; remaining uncertainty is whether an Expo command could ever incorporate an untrusted filename into a brace pattern rather than treating it as a path. Classification: P2 because high-severity DoS patches fit existing ranges and should not wait for a major migration.

### Image-size: both GHSAs

Vulnerable functionality is an infinite loop in ICNS or JXL/HEIF parsers when a crafted box/entry has zero size. Metro invokes `image-size` on local assets at build time. A malicious asset must first enter the repository or dependency asset graph. The package is absent from device exports and Functions. Current reviewed assets exported successfully, but parsing itself has no timeout and a future malicious asset could hang a developer or CI worker. There is no patched package version as of the audit date; npm's suggestion to install Expo 53.0.27 is an unrelated, breaking downgrade and would not make `image-size` safe because all published versions through 2.0.2 are affected. Classification: P3 pending an upstream fix.

### JS-YAML

Vulnerable functionality is quadratic key-uniqueness checking for the default-schema `!!omap` type. Exploitation requires untrusted YAML parsed by `yaml.load`. The single installation is shared by Expo CLI/XCPretty and ESLint; application code does not import it, no device export includes it, and Functions has no affected instance. Repository/config input is reviewed, so only workstation/CI availability is exposed. Version 4.3.1 is a compatible patch accepted by all observed `^4.1.0`/`^4.3.0` parent ranges. Classification: P2.

### ProtobufJS

Vulnerable functionality is a non-terminating `.proto` option parser. Exploitation requires attacker-influenced schema text ending an option before `=` and use of reflection parsing (`parse`, `Root.load`, or `Root.loadSync`). Sideline Social processes Firebase binary data with trusted library schemas and never accepts `.proto` schema input. The package is in Firebase 10's Node/gRPC branch and absent from both mobile exports; Functions resolves a different, non-advised protobuf version. Version 7.6.5 is range-compatible. Remaining uncertainty is future Firebase tooling executed under Node, not mobile runtime. Classification: P3.

### Undici: all three GHSAs

The response-desynchronization record requires `interceptors.retry()`, a malicious/faulty partial upstream response, and forwarding the stale `Content-Length` downstream. The CRLF record requires a hand-built blob-like body or Blob subclass whose attacker-controlled `type` reaches `request`, `stream`, `pipeline`, or `dispatch`; native `Blob` and `fetch()` are not affected. The cookie record requires untrusted values in `setCookie`'s `domain` or `unparsed` fields. Sideline Social source invokes none of these Undici APIs. Firebase's `node` exports contain Undici, while React Native exports are selected for the app; both mobile maps contain zero Undici source. Cloud Functions has no Undici installation from this root lockfile. The existing override is a compensating compatibility pin, but it now pins the last affected 6.x release. Version 6.28.0 supports Node `>=18.17` and patches all three records. Classification: P2.

### UUID

Vulnerable functionality is silent partial output from UUID API methods `v3`, `v5`, or `v6` when an external buffer is too small or an offset places the 16-byte write out of bounds. It is an integrity/robustness issue; exploitation requires a call to those APIs with attacker-influenced bounds. Root `xcode` calls only `v4()` with no buffer and is absent from device exports. Functions source calls no UUID API, cold start loads no UUID module, and installed Firebase Admin Eventarc code also calls only `v4()` with no buffer. Thus direct exploitability is not demonstrated. Root is P3 because it is build-only and replacing uuid 7 with 11 under `xcode` is an unverified major override. Functions is P2 because four affected copies remain in the deployed dependency closure and removal requires coordinated Firebase SDK migration.

No record is classified “safe” merely because it is transitive. For all runtime claims, the status is supported by import, package-export, compiled-load, and source-map evidence. Any new call path that invalidates that evidence changes the status to `UNCONFIRMED` until re-traced.

## 10. Contextual P0-P3 classification and monitoring

| Priority | Advisories | Evidence and compensating controls | Risk-increase trigger | Monitor/review |
|---|---|---|---|---|
| P0 | None | No critical or confirmed compromise path. | New critical advisory plus confirmed production reachability. | Every audit/incident. |
| P1 | None | No user/device or affected Functions API path found. | Source-map inclusion, new direct import, affected Function call path, or active exploitation. | Every release. |
| P2 | Both `brace-expansion`; `js-yaml`; all three `undici`; Functions `uuid` | Build inputs are reviewed and packages are absent from device bundles; Functions UUID APIs are not loaded/called. Compatible patches exist for the first five; Functions needs coordinated migration. | Untrusted repository/build input, CI offered as a service, new Node server/proxy path, direct UUID API use, or upstream consumer call to affected UUID methods. | Owner decision by 2026-08-26; re-audit after each patch branch and before public release. |
| P3 | Both `image-size`; `protobufjs`; root `uuid` | Build-only or Node-only code absent from device bundles; affected APIs not called; `image-size` has no patch. | Unreviewed asset ingestion, remote `.proto` parsing, root UUID method change, upstream patch/release, Expo/Metro update. | Monthly and on Expo/Metro/Firebase releases; next calendar review 2026-09-19. |

All unresolved P2/P3 records retain their upstream high/moderate rating. A repository asset upload service, dynamic config/glob service, Node proxy, YAML import feature, `.proto` import feature, Eventarc use, or UUID buffer API would require immediate reclassification and a fresh reachability trace.

## 11. Fixed-version availability

| Package | Current | Minimum candidate | Compatibility assessment |
|---|---|---|---|
| `brace-expansion` | 5.0.7 and 1.1.16 vulnerable copies | 5.0.9 and 1.1.18 | Existing parent semver ranges accept the corresponding patched line. A single global 5.x override must **not** replace the 1.x copy. Prefer a normal targeted lockfile re-resolution. |
| `image-size` | 1.2.1 | None; npm latest is 2.0.2 and is still affected | Wait for maintainer/Metro/Expo resolution; do not upgrade merely for audit optics. |
| `js-yaml` | 4.3.0 | 4.3.1 | Existing parent ranges accept it; low API risk. |
| `protobufjs` | 7.6.4 | 7.6.5 | `@grpc/proto-loader` declares `^7.2.5`; patch is range-compatible. |
| `undici` | override 6.27.0 | 6.28.0 | Same major, supports current Node versions, patches all three advisories. Firebase 10 declares exact 6.19.7, so any override is already outside Firebase's literal declaration; regression tests remain mandatory. |
| root `uuid` | 7.0.3 | 11.1.1 | Major jump; `xcode@3.0.1` declares `^7.0.3` and is itself latest. Do not force. |
| Functions `uuid` | 9.0.1/10.0.0 | 11.1.1 | Major jump under multiple Google libraries. Do not force. Migrate top-level Firebase packages and re-audit. |

`npm audit` marks the compatible transitive patches as `true`, but for the broad parent chains it proposes `expo@53.0.27` and `expo-splash-screen@55.0.24`, both breaking downgrades from aligned Expo SDK 57. It proposes `firebase@12.18.0`, `firebase-admin@14.3.0`, and `firebase-functions@7.3.2` as semver-major upgrades. The Expo downgrade suggestions are rejected. The Firebase suggestions are migration candidates, not automatic fixes.

## 12. Safe compatible fixes

No fix was applied. The following should be a dedicated short-lived branch with a pre-change tag or commit.

1. Change the root top-level `overrides.undici` value only, from `6.27.0` to `6.28.0`. No peer change is expected. A native rebuild is not intrinsically required because the package is Node-only and absent from the mobile bundle, but Android/iOS exports and Firebase client/auth tests must still prove that resolution remains correct. No Firebase deployment is required; a store release is unnecessary if source maps remain identical with respect to shipped modules.
2. Re-resolve `brace-expansion` within existing parent ranges so the vulnerable 5.x copies become at least 5.0.9 and the 1.x copy becomes at least 1.1.18. **Top-level dependency change: none.** Do not add a global override that collapses incompatible major lines. Clean install, lint, TypeScript, Expo Doctor, config/plugin tests, and both exports are required.
3. Re-resolve shared `js-yaml` to at least 4.3.1. **Top-level dependency change: none.** Run lint, Expo config introspection, Android variant, iOS release, and auth/native-config tests.
4. Re-resolve `protobufjs` to at least 7.6.5 under `@grpc/proto-loader`. **Top-level dependency change: none.** Run Firebase client tests, both exports, and confirm `protobufjs` remains absent from their maps.

Rollback for this branch is a normal revert of its small manifest/lockfile commit followed by `npm ci`. Never edit the generated lockfile by hand.

## 13. Breaking migrations required

### Firebase JavaScript SDK

Top-level change: `firebase@10.14.1` to a separately tested current candidate, presently `12.18.0`. Firebase's official 11.0.0 notes state that Node bundles removed `undici` and `node-fetch` in favor of native fetch; 12.0.0 raises Node/tooling requirements to Node 20 and ES2020. This app already satisfies those runtime floors, but Auth, Firestore, Functions, Storage, AsyncStorage persistence, emulator contracts, offline behavior, and TypeScript signatures require full migration testing. Do not combine this with Expo/React Native changes. Rollback is revert + clean install; any store rollout requires normal staged mobile rollback.

### Cloud Functions SDKs

Top-level changes: `firebase-admin@12.7.0` and `firebase-functions@5.1.1` together. The current Functions 5 peer range accepts only Admin 11/12. The fully current audit candidates are `firebase-admin@14.3.0` and `firebase-functions@7.3.2`; Functions 7 accepts Admin 11-14. Admin 13.10 officially removed its direct UUID dependency, but only a clean audit after migration can prove all nested Google copies are gone. Admin 14 requires Node 22 (already configured) and removes legacy namespace support, so the project's many `import * as admin from 'firebase-admin'` calls need modular-entry-point migration. Functions 7 removes `functions.config()`, requires TypeScript 5, targets ES2022, changes emulator async error handling, and uses Express 5. Preserve every function export name, region, first-generation trigger, runtime option, schedule, and secret binding.

This stage requires compilation, packaging/reproducibility tests, the complete Functions emulator suite, manifest diff, dry-run/package inspection, then separate deployment approval with rollback to the previous package/lock/source commit and prior deployed revision. No deployment was performed here.

### Expo/React Native and tooling

There is no security-supported reason to downgrade Expo 57 or independently change React Native 0.86.2. Expo documents that each SDK targets one React Native version; current SDK 57 targets RN 0.86 and React 19.2.3. Wait for an Expo/Metro release that replaces or patches `image-size`, then migrate through Expo's supported SDK workflow. A physical-device build is mandatory for any native package change.

ESLint 8 and its legacy config are deprecated, and the root tree contains ESLint 8/9 plus TypeScript/ESLint peer debt. Upgrade ESLint/config packages and TypeScript in a separate tooling stage after runtime migrations. These upgrades are not required to land the compatible `brace-expansion`/`js-yaml` patches.

## 14. Expo Doctor advisory analysis

### Checked-in native folders

Expo Doctor passed 19 of 21 checks and warned that the tracked `android` directory coexists with app configuration. There is no tracked `ios` directory. The Android project is intentionally source-controlled: it contains 48 tracked files, explicit production/development application IDs, labels, schemes, Firebase client selection, OAuth metadata, backup rules, and New Architecture configuration.

Expo states that when native directories are present, EAS Build does not automatically sync app-config fields. The warned fields are `orientation`, `icon`, `scheme`, `userInterfaceStyle`, `locales`, `ios`, `android`, and `plugins`. Existing Android variant/backup and iOS release introspection tests validate important resolved fields, permissions, schemes, package IDs, Firebase files, entitlements, localization, legal config, and auth provider setup. Those tests passed. No current native/config mismatch was proven, but the tests do not guarantee every future plugin mutation is mirrored in checked-in Android files.

Safe comparison procedure: start from a clean commit, create a disposable clone or detached temporary worktree, run its own clean install, generate a clean prebuild there with identical non-secret configuration, and compare only the generated native tree/config outputs against the tracked project. Review changes; never run `expo prebuild --clean` in the main worktree. If the project intends a bare/source-controlled workflow, document that policy and retain a tested sync checklist; do not silence the Doctor check merely to get 21/21.

### Google Sign-In and New Architecture

Installed versions are `react-native-nitro-google-signin@1.3.0` and `react-native-nitro-modules@0.36.5`. Expo SDK 57/RN 0.86 runs only the New Architecture; Android also sets it true. The maintainer describes the library as Nitro-powered, requires RN `>=0.76`, provides an Expo config plugin/example, and says a native development build is required. Version 2.0.0 is current and upgrades Nitro/Nitrogen to 0.36.5 plus RN 0.87 example/codegen changes; it is a major and should not be taken merely to silence metadata.

React Native Directory's current entry marks Android, iOS, and config-plugin support but omits its `newArchitecture` field. Expo Doctor therefore reports “Untested,” not “incompatible.” This is a metadata gap, not proof of failure. Existing automated federated-auth, Android variant/OAuth, iOS release, identity, navigation, profile, Apple revocation, and post-SDK 57 tests all passed. Provider flags remain disabled by default, and the rollout report requires development and production physical-device sign-in/link/delete validation before enabling either provider. Automated tests cannot validate Credential Manager, installed native code, release signing SHA fingerprints, Google consent/account selection, or Apple presentation.

Plan: do not suppress the warning. Ask the library maintainer to mark verified New Architecture support in React Native Directory; monitor 2.0.x; test 1.3.0 and any candidate upgrade on signed Android/iOS physical devices. Replacement is not justified by the warning alone.

## 15. Temporary risk acceptances requiring owner approval

| Acceptance | Why needed | Controls | Expiry/trigger |
|---|---|---|---|
| Keep `image-size@1.2.1` temporarily | No patched release exists through 2.0.2. | Review binary assets/dependencies, protected branches, ephemeral/time-limited CI, do not ingest user images into Metro. | 2026-09-19 or first upstream/Expo patch. |
| Keep root `uuid@7.0.3` under xcode | Latest xcode still declares UUID 7; actual call is safe `v4()` without a buffer. | No direct app import; verify absent from exports; review config-plugin updates. | Next Expo/config-plugin/xcode release or call-site change. |
| Keep Functions UUID copies until coordinated migration | Forced UUID 11 override is outside Google parent ranges; affected APIs are not loaded/called. | No direct UUID use; import/cold-start check; emulator coverage; monitor Admin/Functions releases. | Owner-approved migration target, no later than next Functions dependency cycle; immediate review on new call path. |
| Accept Expo Doctor 19/21 temporarily | Native directory is intentional; directory metadata is incomplete. | Keep release/config tests, disposable prebuild comparison, physical-device auth gate, no warning suppression. | Revisit each native/plugin/Expo upgrade and before providers are enabled. |
| Short acceptance while compatible root patches are prepared | Patches exist, but this triage was intentionally non-mutating. | Reviewed build inputs; no device inclusion; narrow patch branch. | Owner decision by 2026-08-26. |

Approval should name an owner, date, accepted conditions, expiry, and tracking issue. An expired acceptance is not an implicit extension.

## 16. Staged remediation roadmap

1. **Compatible transitive/override patches.** Branch from the audited commit; change only Undici and compatible lock resolutions for brace expansion, JS-YAML, and ProtobufJS. Re-audit and export. Roll back by reverting this one commit.
2. **Firebase mobile SDK migration.** Separate branch for `firebase` 12.x (or the then-current supported candidate), including AsyncStorage peer resolution. Do not touch Functions or Expo. Emulator/client tests plus signed-device Auth/Firestore/Storage/Functions checks.
3. **Cloud Functions Admin/Functions migration.** Separate branch for Functions 7 + Admin 14 modular imports; retain Node 22, gcfv1 behavior, regions, names, triggers, schedules, and secrets. Full emulator suite and separately approved deployment/canary.
4. **Supported Expo/React Native/native-library migration.** Only when an Expo-supported release provides value or upstream `image-size` remediation. Upgrade Expo first and let it select React Native; include Nitro Google Sign-In evaluation and disposable native diff.
5. **TypeScript/ESLint dependency-health migration.** Resolve legacy ESLint, duplicate major lines, React/AsyncStorage peer declarations, and missing optional test peers without mixing runtime dependency changes.
6. **Monitored transitives.** Recheck `image-size`, xcode/UUID, React Native Directory metadata, and all advisories monthly and on relevant releases.

Every stage gets a separate branch/rollback point, narrow dependency scope, reviewed lockfile diff, clean install, targeted and full regression tests, both production exports, and its own deployment/store approval. Stages must not be collapsed merely to reduce audit counts.

## 17. Test requirements per stage

Minimum gate for every dependency stage:

- root and Functions clean install under their pinned Node versions;
- root `typecheck` and `lint`; Functions build and Node 22 isolation/reproducibility;
- `npm audit --omit=dev`, full audit, `npm ls --all`, SBOM comparison, and source-integrity review;
- `expo install --check` and `expo-doctor@latest`, with warnings investigated rather than excluded;
- Android and iOS production exports with source-map/package inclusion comparison;
- `test:functions-packaging`, `test:android-variants`, `test:ios-release`, `test:federated-auth`, `test:auth-identity`, `test:auth-navigation`, `test:auth-profile-ui`, `test:apple-authorization-revocation`, and `test:post-sdk57-regressions`;
- full repository regression suite after targeted tests;
- relevant Firebase emulator suites for Auth, Firestore, RTDB, Storage, callable/HTTP Functions, notifications, chat, squads, schedules, games, moderation, and account deletion when Firebase dependencies change;
- physical Android/iOS device tests when a native/runtime/Auth package changes, including signed release identity, Google/Apple login, linking, reauthentication, deletion/revocation, offline/reconnect, notifications, media, background/resume, and upgrade-from-installed-build behavior;
- `git diff --check`, generated/native/config manifest review, and confirmation that only intended files changed.

This triage itself passed root clean install, Functions clean install/build, Functions isolated Node 22 reproducibility, typecheck, lint, all targeted tests named above, Expo version alignment, Android/iOS exports, and `git diff --check`. Expo Doctor's two documented warnings remain.

## 18. Native-build, store-release, and Firebase-deployment impact

| Stage | Native rebuild | Store release | Firebase deploy |
|---|---|---|---|
| Compatible Node/tooling transitives | Not expected; exports still required | No if bundle/native output is unchanged | No |
| Firebase mobile SDK | Yes for final integration confidence, even if JS-only | Yes to deliver changed client code | No server deploy; emulator/backend compatibility tests required |
| Functions Admin/Functions | No app rebuild intrinsically | No, unless paired client contract change (avoid pairing) | Yes, separately approved; preserve manifest and use staged rollback |
| Expo/RN/Nitro/native packages | Yes, Android and iOS | Yes | No unless contracts also change |
| TypeScript/ESLint only | No | No | No, unless emitted Functions output changes; verify it does not |

No EAS build, store submission, Firebase deployment, rule/index deployment, or production invocation occurred during triage.

## 19. Rollback guidance

- Tag or record the exact pre-stage commit and retain both lockfiles.
- Make one dependency concern per commit; never combine Firebase client, Functions, Expo/RN, and lint changes.
- For compatible patches, revert the manifest/lock commit and run the pinned `npm ci` commands.
- For mobile SDK/native changes, retain the last approved Android/iOS artifacts and use normal staged store rollout/rollback; database/rule compatibility must remain backward compatible across app versions.
- For Functions, capture the pre-deploy Firebase function manifest and deployed revision inventory, deploy only after approval, monitor errors/latency/auth failures, and roll back source/package lock to the prior commit followed by a controlled redeploy. Never rename/recreate Functions as a shortcut because it can alter triggers, regions, generations, or secret bindings.
- For checked-in native projects, restore through a reviewed Git revert, not a destructive clean prebuild in the main worktree.
- If a rollback cannot restore compatibility without data/schema change, stop and obtain a separate migration/production-data approval.

## 20. Commands and evidence sources

### Commands executed

Read-only inventory and audit commands (nonzero audit/outdated/Doctor exits were treated as evidence, not task failure):

```powershell
node --version
npm --version
npm config get registry
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main

npm audit --omit=dev --json
npm audit --json
npm ls --all --json
npm outdated --json
npm sbom --omit=dev --sbom-format cyclonedx
npm sbom --sbom-format cyclonedx

npm --prefix functions audit --omit=dev --json
npm --prefix functions audit --json
npm --prefix functions ls --all --json
npm --prefix functions outdated --json
npm --prefix functions sbom --omit=dev --sbom-format cyclonedx
npm --prefix functions sbom --sbom-format cyclonedx

npm ci
npm --prefix functions ci
npm run typecheck
npm run lint
npm --prefix functions run build
npx expo install --check
npx expo-doctor@latest

npm run test:functions-packaging
node scripts/test-functions-node22-reproducibility.cjs
npm run test:android-variants
npm run test:ios-release
npm run test:federated-auth
npm run test:auth-identity
npm run test:auth-navigation
npm run test:auth-profile-ui
npm run test:apple-authorization-revocation
npm run test:post-sdk57-regressions

npx expo export --platform android --source-maps external --no-bytecode --clear --output-dir <temporary>
npx expo export --platform ios --source-maps external --no-bytecode --output-dir <temporary>
git diff --check
```

Additional evidence came from `npm explain`, lockfile/SBOM traversal, repository import/call-site searches, Firebase package export maps, source-map source enumeration, compiled Function cold-start module enumeration, protected-file SHA-256 comparison, and read-only npm package metadata queries. Raw audits, dependency trees, SBOMs, and exports were kept in the system temporary directory only and deleted after this report was finalized.

### Authoritative external sources

- GitHub Security Advisory records linked in the unique-advisory table; each record links its assigned NVD CVE.
- Official npm registry metadata for installed/latest/patched versions and peer/engine ranges.
- [Expo SDK version matrix](https://docs.expo.dev/versions/latest/), [Expo New Architecture guidance](https://docs.expo.dev/guides/new-architecture/), [package/Doctor configuration](https://docs.expo.dev/versions/latest/config/package-json/), [native project upgrade guidance](https://docs.expo.dev/bare/upgrade/), and [SDK upgrade workflow](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/).
- [Firebase JavaScript SDK release notes](https://firebase.google.com/support/release-notes/js), [Firebase Admin Node release notes](https://firebase.google.com/support/release-notes/admin/node), [Firebase release notes for Functions 7](https://firebase.google.com/support/releases), and [Functions runtime management](https://firebase.google.com/docs/functions/manage-functions).
- [Undici 6.28.0 release](https://github.com/nodejs/undici/releases/tag/v6.28.0), [ProtobufJS 7.6.5 release](https://github.com/protobufjs/protobuf.js/releases/tag/protobufjs-v7.6.5), and the official repositories linked by npm metadata.
- [Nitro Google Sign-In maintainer documentation](https://github.com/react-native-nitro-google-sign-in/google-signin), [2.0.0 release notes](https://github.com/react-native-nitro-google-sign-in/google-signin/releases/tag/v2.0.0), and the [React Native Directory data entry](https://github.com/react-native-community/directory/blob/main/react-native-libraries.json).

### Integrity conclusion

Before/after SHA-256 hashes match for `package.json`, `package-lock.json`, `functions/package.json`, `functions/package-lock.json`, `app.config.js`, `firebase.json`, Firestore/RTDB/Storage rules, and Firestore indexes. Git remained on the same `main` commit, and no application, native, Firebase, rule, index, dependency, or lockfile change was present. This Markdown file is the only intended repository change.

## Verdict

**NO IMMEDIATE RUNTIME BLOCKER IDENTIFIED**
