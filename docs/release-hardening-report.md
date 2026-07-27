# Sideline Social release-hardening report

Date: 2026-07-27
Repository: `C:\Dev\Sideline_Social_Code`

## Release recommendation

**Not ready for a new signed build or store submission.**

The scoped hardening implementation is complete and all 75 registered test scripts pass. A production build is intentionally blocked because the approved Privacy Policy, Terms of Use, and Support website URLs are absent from both project- and account-scoped EAS production environments. Android remote build quota is also unavailable this month, and no physical Android or iOS device was available for runtime acceptance testing.

After the owner publishes and configures the three legal URLs, the Expo compatibility patch set is reviewed in a separate dependency-maintenance change, and Android build quota is available, the next appropriate state is **ready to build for internal testing**. Store submission still requires signed-artifact inspection and the physical-device matrix in this report.

## 1. Initial state

- Branch: `main`
- Commit: `d3e4c5d7048b76800601ea9e3ebabb736e5288f6`
- Commit subject: `Fix Spot-the-Difference zoom and pan`
- Initial relationship: `main...origin/main`
- Initial working tree: clean
- Root app runtime pin: Node `24.16.0`
- Cloud Functions runtime: Node 20
- Expo / React Native: Expo `57.0.7`, React Native `0.86.0`
- EAS version source: remote

No `AGENTS.md` exists in this repository or its relevant parent directory. The release, backend, Firebase, privacy, TestFlight, and moderation documentation was reviewed before editing.

No optimized Spot-the-Difference image, filename, dimension, or game implementation was modified. The final source inventory remains 21 pairs / 42 WebP files at 1024 x 1024, totaling 8,557,026 bytes, with zero Spot scene PNGs.

## 2. Cloud Functions packaging

### Root cause

`functions/package.json` contained:

```json
"sideline-squad": "file:.."
```

No Cloud Functions source, script, TypeScript path alias, or runtime configuration imports the root application package. `geofire-common` is the intentionally shared dependency and is imported directly.

The local install had materialized `functions/node_modules/sideline-squad` as a Windows junction to the repository root. Its ignored npm lock contained 1,386 parent/root application package records. Although Firebase CLI excludes `node_modules` from the upload by default, the uploaded Functions manifest still referred to a parent directory that does not exist in Cloud Build. The junction also allowed undeclared root dependencies to resolve locally and exposed filesystem tools to recursive traversal.

A second clean-checkout defect was confirmed: `functions/lib` is ignored, `functions/package.json` points to `lib/index.js`, and Firebase had no predeploy build hook.

### Fix

- Removed the unused parent package dependency.
- Generated `functions/package-lock.json` with Node `20.19.4` and npm `10.8.2`; the root lockfile was not replaced.
- Removed the stale local junction.
- Added a Firebase predeploy TypeScript build.
- Added a regression that rejects:
  - the root package in any dependency group;
  - `file:`, `link:`, `workspace:`, relative, absolute, drive-letter, and UNC dependency paths;
  - lock entries outside the Functions package;
  - linked packages, machine paths, and accidental root-package records;
  - a missing modern lockfile or missing deploy build hook.

### Reproducibility evidence

A GUID-named system-temporary directory received only the Functions manifest, lock, TypeScript config, and source. Under Node `20.19.4` / npm `10.8.2`:

- `npm ci --no-audit --no-fund`: passed; 242 packages installed.
- Functions TypeScript build: passed.
- Root package/junction in the clean install: absent.
- Packaging regression: passed.
- Firebase Functions dry run: passed.
- Dry-run upload package: 409.53 KB.
- All 10 Functions emulator suites: passed.

The dry run did not deploy a function. It did verify the predeploy build, source analysis, and upload package, demonstrating that packaging no longer follows the former recursive root junction.

### Dependency audit

The clean full and production-only npm audits each report:

- 0 info
- 0 low
- 9 moderate
- 0 high
- 0 critical

The findings converge on `uuid <11.1.1` through the current Firebase Admin / Firestore / Storage / Google request stack. npm's complete remediation path proposes major upgrades to `firebase-admin` and `firebase-functions`; no automatic or breaking upgrade was applied.

Firebase CLI also reports that Node 20 was deprecated on 2026-04-30 and is scheduled for decommission on 2026-10-30. Google states that new deployments are unavailable after decommission and existing workloads may eventually be disabled. Schedule an isolated Node 22 migration, Firebase Functions/Admin upgrade, emulator pass, and staged deployment before that date. See the [Google Cloud Functions runtime schedule](https://docs.cloud.google.com/functions/docs/runtime-support).

## 3. Android backup and device-transfer protection

### Initial risk

- `app.config.js` did not disable backup.
- The committed source manifest explicitly set `android:allowBackup="true"`.
- The effective release manifest also had backup enabled and no backup-rule references.
- Firebase Auth persists state through AsyncStorage.
- AsyncStorage also held mode, selected Squad, coach-resource progress, notification retry IDs, and Trivia history.
- Logout previously removed Firebase Auth and active mode but left other account-specific local keys.

### Final policy

Backup is disabled, with deny-all XML rules retained as defense in depth:

- Expo config: `android.allowBackup=false`
- Committed native manifest:
  - `android:allowBackup="false"`
  - `android:fullBackupContent="@xml/backup_rules"`
  - `android:dataExtractionRules="@xml/data_extraction_rules"`
- Android 11-and-earlier `full-backup-content`: excludes every credential-protected and device-protected application storage domain.
- Android 12+ `data-extraction-rules`: duplicates the deny-all policy under both `cloud-backup` and `device-transfer`.
- A local Expo config plugin reapplies the manifest attributes and deterministically regenerates both XML files during prebuild.

Android documents that some Android 12+ manufacturers may permit device-to-device transfer despite `allowBackup=false`; the explicit `data-extraction-rules` exclusions cover that path. See [Android Auto Backup](https://developer.android.com/identity/data/autobackup) and [Android 12 backup/transfer behavior](https://developer.android.com/about/versions/12/behavior-changes-12).

### Local account-state cleanup

The shared sign-out flow now:

1. Attempts notification-token unregister while still authenticated.
2. Attempts Firebase sign-out.
3. Clears every AsyncStorage key except the generic device onboarding completion and language preference.
4. Clears the last notification response and in-memory voice playback URL cache.
5. Resets local auth/UI context even when Firebase or storage cleanup reports a failure.

Only sanitized error codes are logged. Account deletion now reuses this shared cleanup after the server-side deletion instead of maintaining a separate broad clear.

Ordinary Firebase Auth persistence is unchanged, so routine restart persistence is not weakened. Actual persistence/restart behavior still requires device testing.

### Verification

- Source manifest and both XML policies: passed.
- Expo production/development resolved config: passed.
- Config-plugin idempotency and deterministic XML generation: passed.
- Clean prebuild in a temporary project: passed.
- Fresh merged release manifest:
  - min SDK 24
  - target / compile SDK 36
  - backup disabled
  - both rule references present
- Android build-tools XML compilation: passed.
- Logout/account-deletion cleanup success and failure paths: passed.

An initial prebuild verification command used the repository as its process directory instead of the prepared temporary directory. Its generated tracked Android drift was restored byte-for-byte from the initial commit, and only the intended manifest/XML changes were reapplied. Final Git diff and hashes confirm no unrelated native source drift. The clean operation removed ignored `android/app/build` APK/AAB/cache output; those files were derived and recoverable, and the merged manifest and release JavaScript output were subsequently regenerated. No tracked source, production data, or Spot asset was lost.

This is native manifest/resource work. A new Android binary is required; an OTA update is insufficient. This repository also has Expo Updates disabled in the native manifest.

## 4. Global `activity` collection

### Usage decision

No active client feature reads or writes the top-level `/activity/{activityId}` collection. The former Community Activity feed was removed, and existing regressions require it to remain absent.

The following similarly named features are separate and unchanged:

- suggested-friend `sharedActivity` text;
- `squads.lastActivityAt`;
- user-scoped weekly challenges and reward transactions;
- React Native loading indicators.

The trusted `completeWeeklyChallenge` callable still writes an Admin SDK activity record with:

- `type`
- `userId`
- `displayName`
- `avatarUrl`
- `squadId`
- `challengeId`
- `weekKey`
- English and Spanish messages
- server `createdAt`

The document ID remains deterministic: `weeklyChallenge_${weekKey}_${uid}`. Account deletion still removes trusted history by `userId`. Existing production documents and legacy indexes were not changed.

### Final rule

```rules
match /activity/{activityId} {
  allow read, write: if false;
}
```

The Admin SDK bypasses client rules, so trusted creation and deletion cleanup remain available.

### Verification

The focused rules test confirms denial of:

- anonymous document/collection reads and writes;
- authenticated own and cross-user document/collection reads;
- self-attributed, cross-user, and arbitrary-field creates;
- all authenticated updates and deletes.

The Sideline Stars Functions emulator confirms trusted creation, correct fields/timestamp, and one document after an idempotent retry. The full Firestore suite also passes.

## 5. Authentication/profile test repair

The stale forgot-password assertion required the removed inline `KeyboardAvoidingView` implementation even though auth/profile forms now use `KeyboardAwareScrollView`.

The test now parses TSX with the TypeScript AST and verifies:

- shared `KeyboardAvoidingView -> ScrollView -> children` nesting;
- platform behavior, dismissal, tap persistence, focus reveal, and multiline resizing;
- controlled inputs and submission controls remain descendants of the shared wrapper in forgot password, email login, sign-up, and profile editing.

No production form was changed. This remains a structural AST regression because the repository does not yet have a React Native rendered-component test harness; the stronger rendered test is included in the post-release roadmap.

The auth-navigation regression was also updated after sign-out cleanup moved behind the shared helper. It now verifies notification cleanup precedes the shared sign-out call and that the helper receives Firebase sign-out and local-state cleanup.

## 6. Privacy, terms, and support configuration

### Implementation

- Added one shared validator used by runtime config, the production CLI gate, and iOS validation.
- URL parsing requires a public HTTPS URL and rejects malformed, credential-bearing, placeholder, localhost, IP, single-label, reserved/test, and nonstandard-port destinations.
- Validation errors name variables only; configured URL values are never echoed.
- The bundled support email remains exactly `joann@joinsidelinesocial.com`.
- The existing legal screen continues to open web links through `Linking.openURL`.
- The support address continues to open `mailto:joann@joinsidelinesocial.com`.
- Link accessibility roles and English/Spanish labels remain present.
- Invalid/missing URLs remain non-fatal in development.
- EAS production sets `REQUIRE_PRODUCTION_LEGAL_CONFIG=true`, so dynamic app-config evaluation blocks both Android and iOS production builds when configuration is missing.

Expo documents that the selected EAS environment is available during builds and that plain/sensitive values are available while dynamic app config is resolved. Client-facing `EXPO_PUBLIC_` values are embedded in the application and must not be treated as secrets. See [Using environment variables in EAS](https://docs.expo.dev/eas/environment-variables/usage/).

### Current status

Read-only EAS checks were performed without printing values. The following names are absent in both project- and account-scoped production environments:

- `EXPO_PUBLIC_PRIVACY_POLICY_URL`
- `EXPO_PUBLIC_TERMS_OF_USE_URL`
- `EXPO_PUBLIC_SUPPORT_URL`

`GOOGLE_SERVICES_INFO_PLIST` is present at project scope, but its secret file contents and bundle ID were not exposed or locally verified.

`npm run validate:legal` correctly fails on the three missing URLs. iOS warning-mode validation passes while identifying the same owner actions and the unavailable local plist. `APP_STORE_SUBMISSION_READY=true` correctly turns those conditions into a blocking failure.

Owner action:

1. Publish the approved Privacy Policy, Terms of Use, and Support pages.
2. Add all three variable names to the EAS production environment as plaintext or sensitive public values.
3. Run the strict validator in that environment.
4. Manually open all three destinations and the support `mailto:` link from a signed build.

No URL was invented.

## 7. Complete verification

### Passing gates

| Gate | Result |
| --- | --- |
| Root Node / npm | Node 24.16.0 / npm 11.13.0 |
| Root lockfile dry-run | Passed |
| Installed top-level dependency tree | Passed; no invalid/extraneous packages |
| Full TypeScript | Passed |
| Full ESLint | Passed with zero findings |
| Functions clean `npm ci` | Passed under Node 20.19.4 / npm 10.8.2 |
| Functions TypeScript | Passed |
| Functions packaging regression | Passed |
| Functions deployment dry run | Passed; 409.53 KB package; no deployment |
| Functions emulator suites | 10 / 10 passed |
| Firestore emulator scripts | 12 / 12 passed |
| Realtime Database emulator scripts | 1 / 1 passed |
| Storage emulator scripts | 1 / 1 passed |
| Non-emulator test scripts | 51 / 51 passed |
| Adjusted complete test inventory | 75 / 75 passed |
| Android backup source/plugin tests | Passed |
| Clean temporary Android prebuild | Passed |
| Merged Android release manifest | Passed |
| iOS warning-mode validator | Passed with documented warnings |
| Android production JS export | Passed |
| iOS production JS export | Passed |
| Exact Spot WebPs in both exports | Passed; 42 / 42 on each platform |
| `git diff --check` | Passed |

The audit brief's earlier expected count was 67. The current repository already had additional regressions from intervening feature fixes, and this task added six focused package tests, yielding 75 registered test scripts.

### Expected or unresolved failures

| Gate | Result / action |
| --- | --- |
| Strict legal validator | Correctly blocked by the three absent owner URLs |
| Strict local iOS submission validator | Correctly blocked by legal URLs and locally unavailable Firebase plist; the plist variable name exists in EAS production |
| Expo Doctor | 18 / 20 checks passed |
| Expo dependency compatibility | 12 packages reported below the SDK 57 expected patch/minor versions |
| Functions audit | 9 moderate transitive findings; no high/critical |

Expo Doctor's first failure is the expected non-CNG warning: a committed Android directory means EAS does not automatically synchronize app-config native fields. Backup configuration is explicitly synchronized by the committed manifest/XML plus config plugin and regression tests.

The second Doctor failure and `expo install --check` identify:

- `react-native-screens` 4.25.2, expected `~4.26.0`;
- Expo 57.0.7, expected `~57.0.8`;
- patch mismatches for `expo-asset`, `expo-audio`, `expo-constants`, `expo-dev-client`, `expo-linking`, `expo-location`, `expo-notifications`, `expo-router`, `expo-splash-screen`, and `expo-web-browser`.

No dependency was changed merely to silence the warning. Review the SDK 57 changelogs and apply this set in an isolated dependency-maintenance change with the full 75-script and device matrix.

Expected emulator logs included negative-test permission denials, local App Check `MISSING`, synthetic-project Admin config warnings, emulator shutdown messages, and scheduled Pub/Sub functions being ignored when Pub/Sub was not requested. The JOIN-code RTDB warning refers to a synthetic namespace; `/gameSessions` already declares the `squadId` index in checked-in rules.

## 8. Build profiles, signed build, and size

### EAS profiles

| Profile | Distribution | Android artifact | iOS method | Node / version behavior |
| --- | --- | --- | --- | --- |
| `development` | Internal development client | APK | Internal development client | Node 24.16.0; no auto-increment |
| `preview` | Internal | Installable APK by internal-distribution default | Ad hoc/internal | EAS image default Node; no auto-increment |
| `production` | Store | AAB | App Store | Node 24.16.0; remote app version source; auto-increment |

Read-only EAS history shows a successful internal Android build and recent successful production Android builds, indicating credentials were configured for those jobs. It does not prove that a new build would succeed unchanged.

### Why no current signed build was started

- The strict production legal gate fails.
- The user confirmed no Android build quota remains this month.
- The instruction requires all local release gates to pass before remote/signed work.

No EAS build, local signed release build, store submission, or Firebase deployment was started.

### Current export measurements

Ordinary production exports:

| Platform | Total export | Hermes bytecode | Emitted assets | Asset entries |
| --- | ---: | ---: | ---: | ---: |
| Android | 21,063,680 B | 9,480,712 B | 11,577,785 B | 78 |
| iOS | 19,892,443 B | 9,271,265 B | 10,616,259 B | 74 |

Android metadata contains 42 WebPs, 25 non-Spot PNGs, 9 fonts, and 2 XML assets. iOS metadata contains 42 WebPs, 24 non-Spot PNGs, and 8 fonts. Both exports were hash-checked against the exact 42 source Spot images.

The Atlas Android export reports:

- 3,759 modules;
- 14,930,759 bytes of represented module source;
- 9,480,998-byte instrumented Hermes bundle;
- 11,577,785 bytes of assets;
- 21,063,966 bytes total.

The Spot source/export contribution is 8,557,026 bytes.

### Historical artifact only

The newest remaining local AAB is the old version-code-5 baseline:

- Upload size: 156,488,103 bytes / 149.239 MiB.
- Spot entries: 42 PNG, 0 WebP.
- Spot PNG compressed contribution: 70,532,071 bytes.
- Historical x86_64 / xxhdpi / English emulator bundletool estimate: 106.14 MB.
- Historical selected split-APK raw payload: 162,776,857 bytes.
- Historical AAB native-library ZIP contribution across all four ABIs: 31,034,038 bytes.
- Historical native debug-symbol ZIP contribution: 26,201,481 bytes.

That AAB predates the 2026-07-27 WebP and zoom commits and must not be described as current. The latest EAS production build in read-only history also predates those commits.

No current AAB exists, so these requested current figures remain **not measurable**:

- AAB upload size;
- Play per-device download;
- selected APK payload;
- current native-library contribution;
- AAB asset contribution;
- AAB Spot WebP contribution;
- AAB reduction from 149.24 MiB;
- obsolete Spot PNG absence inside the final AAB.

The current post-WebP Android export is 76,112,413 bytes / 72.59 MiB smaller than the recorded pre-WebP export. Export reduction is not an AAB or Play-download reduction and is not reported as one.

The size audit now accepts an explicit `APP_SIZE_AAB_PATH`, validates the artifact, otherwise chooses the newest AAB by modification time, compares it with the 156,488,103-byte baseline, and reports Spot WebP/PNG entries. This prevents a future audit from silently selecting code 5 after a new bundle is downloaded.

After quota and legal configuration are available:

```powershell
npx.cmd eas-cli@latest build --platform android --profile preview --non-interactive
npx.cmd eas-cli@latest build --platform android --profile production --non-interactive

$env:APP_SIZE_AAB_PATH = 'C:\path\to\the-current-production.aab'
npm.cmd run audit:app-size
Remove-Item Env:APP_SIZE_AAB_PATH
```

For per-device measurement with a connected test phone:

```powershell
java -jar build\tools\bundletool-all-1.18.3.jar build-apks --bundle=<current.aab> --output=<current.apks> --mode=default
java -jar build\tools\bundletool-all-1.18.3.jar get-device-spec --output=<device.json>
java -jar build\tools\bundletool-all-1.18.3.jar get-size total --apks=<current.apks> --device-spec=<device.json> --human-readable-sizes
java -jar build\tools\bundletool-all-1.18.3.jar extract-apks --apks=<current.apks> --device-spec=<device.json> --output-dir=<selected-apks>
```

Sum the extracted APK files for selected payload and keep that separate from bundletool's compressed download estimate and raw AAB upload size.

## 9. Physical-device checks

No physical Android or iOS device was available. `adb devices -l` returned no connected device. A `Pixel_9` AVD exists, but no current signed internal artifact exists to install, and emulator testing is not a substitute for the requested physical-device matrix.

Therefore none of the following is claimed as a runtime pass:

- fresh install, routine restart persistence, logout, or account deletion;
- Android backup manager or two-device Android 12+ transfer;
- Friends, requests, Teams/Staff announcements, or Message a Parent;
- direct/group/private chat keyboard behavior;
- voice recording/playback;
- push delivery and deep-link routing;
- Spot WebP rendering/zoom/hotspots/scene changes;
- two-device JOIN-code multiplayer;
- English/Spanish, large text, TalkBack, or VoiceOver;
- iOS launch, safe areas, notification, audio, or auth lifecycle.

Required Android commands after the internal build is available include installation through its EAS artifact, `adb shell bmgr backupnow com.sidelinesquad.app` to confirm backup is disallowed, and a real Android 12+ setup-wizard device-transfer test. iOS requires a separately signed internal build and physical device.

## 10. Remaining blockers

1. Publish and configure the three production legal URLs.
2. Restore Android build quota or wait for quota renewal.
3. Produce new signed internal Android and iOS builds.
4. Produce a current production-equivalent AAB and complete bundletool measurements.
5. Run the full physical-device matrix.
6. Review and apply the 12 Expo compatibility updates as a separate small change.
7. Verify the EAS iOS Firebase plist's bundle ID without exposing its contents.
8. Plan and complete the Functions Node 20 -> Node 22 migration before 2026-10-30.
9. Review the nine moderate transitive Functions audit findings during that dependency/runtime change.

## 11. Post-release stabilization roadmap

These items were planned but not implemented.

### P1 — App Check

1. Inventory every callable, Firestore direct path, RTDB path, and Storage path with current client/version ownership.
2. Add debug-provider setup for local development and CI; never commit debug tokens.
3. Enable metrics/monitor mode and record attestation success, platform/version, and normalized failure reason without UID, profile, or content logging.
4. Review legitimate failures by OS/version and establish rollback and support procedures.
5. Progressively enforce the most abuse- or cost-sensitive callables first, one domain at a time.
6. Extend enforcement to Firestore, RTDB, and Storage only after client coverage is measured.
7. Keep an explicit recovery path for outdated, unsupported, restored, or temporarily unattested clients.
8. Add emulator/core tests for absent, invalid, debug, and valid attestation context before each enforcement change.

### P1 — Message pagination

Build a shared bounded-history primitive, then migrate one message domain per PR:

1. Maintain a small real-time head window.
2. Load older history with stable descending cursors and deterministic tie-breakers.
3. Deduplicate the live head and paged history by canonical message ID.
4. Reconcile hidden/deleted/tombstoned messages without reopening user-hidden content.
5. Preserve latest-preview and unread semantics independently of loaded history.
6. Add required composite indexes before client rollout.

Apply it to Team announcements, reply threads, private coach-parent messages, hidden-message reconciliation, and parent Team history. Tests must cover empty, 1, 50, 500, and multi-thousand-message fixtures; concurrent inserts/deletes; reconnect; cursor boundaries; and explicit Firestore read-count budgets.

### P1 — Runtime UI testing

1. Add React Native Testing Library rendered tests for shared keyboard wrappers, auth/profile forms, legal links, Friends states, and message composers.
2. Add a small Maestro or Detox suite using deterministic emulator/test accounts:
   - authentication and account lifecycle;
   - Friends search/request lifecycle;
   - Team roles and communication;
   - direct/group/private chat and keyboard;
   - voice permission/record/playback;
   - notification tap routing;
   - Spot, Trivia, and JOIN-code multiplayer.
3. Run Android and iOS jobs in English and Spanish.
4. Add large-text, screen-reader labels/roles, focus order, and minimum touch-target checks.
5. Save screenshots/layout bounds for keyboard-open states and failure diagnostics.

### P2 — Incremental modularization

Use small behavior-preserving PRs, never a rewrite:

1. Split `functions/src/index.ts` by domain while retaining the existing export names and emulator fixtures.
2. Split localization into typed namespaces without changing public keys.
3. Decompose the Friends screen into state/query hooks and focused presentational sections.
4. Add shared pagination/cursor primitives after the first bounded message migration proves the contract.
5. Introduce narrower context selectors to reduce unrelated rerenders.
6. Establish one canonical game-route registry and migrate one route family at a time.

Each PR must preserve callable names, route compatibility, localization fallback, authorization behavior, and the complete relevant emulator suite.

## 12. Exact files changed

### Functions and Firebase

- `firebase.json`
- `firestore.rules`
- `functions/package.json`
- `functions/package-lock.json`
- `scripts/test-functions-packaging.cjs`
- `scripts/test-activity-firestore-rules.cjs`
- `scripts/test-sideline-stars-functions-emulator.cjs`

### Android backup and local cleanup

- `app.config.js`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/res/xml/backup_rules.xml`
- `android/app/src/main/res/xml/data_extraction_rules.xml`
- `plugins/withAndroidBackupProtection.js`
- `services/localUserStateService.ts`
- `utils/localUserStateCore.ts`
- `context/AuthContext.tsx`
- `app/settings/delete-account.tsx`
- `scripts/test-android-backup-config.cjs`
- `scripts/validate-android-backup-release.cjs`
- `scripts/test-local-user-state.cjs`
- `scripts/test-android-variants-core.cjs`
- `scripts/test-auth-navigation-core.cjs`

### Auth/profile and legal release checks

- `scripts/test-auth-profile-ui-core.cjs`
- `config/legal.ts`
- `config/legalConfig.js`
- `config/legalConfig.d.ts`
- `eas.json`
- `scripts/validate-production-legal-config.cjs`
- `scripts/test-legal-release-config.cjs`
- `scripts/validate-ios-production-config.cjs`
- `scripts/test-ios-release-core.cjs`
- `scripts/test-support-contact.cjs`
- `docs/ios-app-store-submission-checklist.md`
- `docs/ugc-moderation-and-support-plan.md`

### Size audit and task integration

- `scripts/app-size-audit-core.cjs`
- `scripts/audit-app-size.cjs`
- `scripts/test-app-size-audit.cjs`
- `package.json`
- `docs/release-hardening-report.md`

## 13. Deployment and build requirements

No deployment or build was performed.

After review and explicit authorization:

- Deploy the locked activity rule:

```powershell
firebase.cmd deploy --only firestore:rules --project sideline-squad
```

- Functions packaging takes effect on the next Functions deployment. No runtime function source changed solely to apply the package lock, so do not redeploy all Functions just for churn. Complete the Node 22 / dependency migration before the 2026-10-30 deadline and deploy through the normal staged process.
- Build a new Android binary; native backup protection cannot ship through JavaScript-only delivery.
- Build internal artifacts before production:

```powershell
npx.cmd eas-cli@latest build --platform android --profile preview --non-interactive
npx.cmd eas-cli@latest build --platform ios --profile preview --non-interactive
```

- Only after signed internal/device acceptance:

```powershell
npx.cmd eas-cli@latest build --platform android --profile production --non-interactive
```

Do not submit any artifact until legal links, final manifest, dependency inventory, AAB contents, bundletool estimates, and physical-device results are reviewed.

## 14. Safe rollback

- Android backup config is one unit: roll back `app.config.js`, the plugin, native manifest attributes, and both XML files together. Partial rollback creates prebuild/native drift.
- The local-state cleanup can be rolled back independently, but doing so reintroduces cross-account cached state and is not recommended.
- The activity rule can be rolled back independently, but restoring the old authenticated read/self-create policy reopens an unused global collection and is not recommended.
- The legal gate can be rolled back independently, but doing so allows production builds with broken or absent legal destinations.
- The Functions lock/predeploy changes can be rolled back without data migration, but the parent `file:..` dependency must never be restored.
- The size-audit selection change is tooling-only and has no application/runtime effect.
- No schema migration, index deletion, production document mutation, credential change, or asset conversion occurred, so rollback is code/configuration-only.

All changes remain uncommitted for review.
