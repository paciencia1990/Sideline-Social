# Google Play Review Readiness Checklist

Audit date: July 18, 2026

Repository: `C:\Dev\Sideline_Social_Code`

Branch: `main`

## Overall result

**PARTIAL: the existing signed production AAB is technically uploadable, but it predates the 2026-07-20 privacy corrections and is not ready to submit. Publish the privacy policy/deletion web resource, deploy and verify backend corrections, then create and inspect a replacement AAB.**

The framework, Android build, API targeting, versioning, signing, 16 KB compatibility, clean install, cold launch, offline handling, and authenticated first-level navigation all pass. Remaining product/Play Console work is listed under **Remaining review blockers** and **Exact next steps**.

No Google Play upload, Firebase deployment, migration, commit, push, or source-file deletion was performed.

## Project stack

- Expo SDK 57.0.7 with Expo Router 57.0.7
- React Native 0.86.0
- React 19.2.3
- TypeScript 6.0.3
- Maintained native Android directory (`android/` is authoritative)
- React Native New Architecture enabled
- Hermes V1
- Firebase Authentication, Firestore, Realtime Database, Cloud Functions, Storage, and Cloud Messaging
- EAS Build with the existing managed Android upload keystore
- Node 24.16.0 for local and production EAS builds

## Incremental Expo upgrade checkpoints

The app was upgraded without skipping Expo SDK versions. Each stable checkpoint includes source/config snapshots and verified APK artifacts under `build/expo-upgrade-checkpoints/`.

| Checkpoint | Expo | React Native | React | Router | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Baseline | 51.0.39 | 0.74.5 | 18.2.0 | 3.5.24 | Inventoried before native changes |
| SDK 52 | 52.0.49 | 0.76.9 | 18.3.1 | 4.0.22 | Stable checkpoint; tests/build/startup pass |
| SDK 53 | 53.0.27 | 0.79.6 | 19.0.0 | 5.1.11 | Stable checkpoint; tests/build/startup pass |
| SDK 54 | 54.0.36 | 0.81.5 | 19.1.0 | 6.0.24 | Stable checkpoint; tests/build/startup pass |
| SDK 55 | 55.0.28 | 0.83.6 | 19.2.0 | 55.0.17 | Stable checkpoint; tests/build/startup pass |
| SDK 56 | 56.0.16 | 0.85.3 | 19.2.3 | 56.2.15 | Stable checkpoint; tests/build/startup pass |
| SDK 57 | 57.0.7 | 0.86.0 | 19.2.3 | 57.0.7 | Stable checkpoint; tests/build/startup pass |

## Important compatibility changes resolved

- Migrated voice recording/playback from deprecated `expo-av` to deferred `expo-audio` loading while preserving older-client fallback behavior and the shared permission flow.
- Preserved microphone-on-Record behavior, 90-second limit, preview, record-again, upload, playback, and localized Settings handling.
- Migrated navigation imports required by newer Expo Router releases.
- Adopted TypeScript 6 and React Native 0.86 type changes.
- Updated React Native New Architecture Android host wiring, Gradle wrapper, AGP/NDK integration, Hermes compiler path, edge-to-edge behavior, and Expo inline-module configuration incrementally.
- Preserved the package/application ID, EAS project ID, Firebase project/files, Google Maps placeholder, notification/microphone permissions, application scheme, and ABI controls.
- Added `expo-status-bar` to the dynamic config plugin list required by SDK 57 alignment.
- Updated the Google Services Gradle plugin to 4.4.4 without changing the Firebase project.
- Raised the Node engine/build runtime to the supported SDK 57 range.
- Pinned transitive `undici` to patched 6.27.0, eliminating the production high-severity advisory without changing the Firebase app major.
- Aligned `@firebase/rules-unit-testing` to 3.0.4, whose peer requirement matches the preserved Firebase 10.14.1 SDK.

## Final Android toolchain

- Minimum SDK: 24
- Compile SDK: 36
- Target SDK: 36
- Android Gradle Plugin: 8.12.0
- Gradle wrapper: 9.3.1
- Kotlin Gradle plugin: 2.1.20
- NDK: 27.1.12297006
- New Architecture: enabled
- Hermes: enabled
- Edge-to-edge: mandatory/enabled
- Application ID: `com.sidelinesquad.app`
- Version name: `1.0.0`
- Final version code: `5`

## Build commands used

```powershell
# Run under Node 24.16.0
npx expo install --fix
npx expo-doctor@latest
npm run typecheck
npm run lint

# All-ABI debug checkpoint
cd android
.\gradlew.bat assembleDebug --no-daemon --stacktrace

# Self-contained x86_64 release smoke checkpoint
$env:NODE_ENV='production'
.\gradlew.bat -PreactNativeArchitectures=x86_64 assembleRelease --no-daemon --stacktrace

# Android production JavaScript export
npx expo export --platform android --output-dir build\expo-upgrade-exports\sdk57

# Remotely signed production AAB (completed; not submitted to Play)
npx eas-cli@latest build --platform android --profile production --non-interactive --wait
```

Binary inspection/install commands used:

```powershell
zipalign -c -P 16 -v 4 <final-aab>
java -jar bundletool-all-1.18.3.jar dump manifest --bundle=<final-aab> --module=base
java -jar bundletool-all-1.18.3.jar dump config --bundle=<final-aab>
java -jar bundletool-all-1.18.3.jar build-apks --connected-device --bundle=<final-aab> --output=<apks>
java -jar bundletool-all-1.18.3.jar install-apks --apks=<apks>
llvm-readelf -lW <each-native-library>
adb shell am start -W -S -n com.sidelinesquad.app/.MainActivity
adb logcat
```

## Final artifacts

Production upload candidate:

`C:\Dev\Sideline_Social_Code\build\google-play-release\sideline-social-v1.0.0-code5-sdk57.aab`

- Size: 156,488,103 bytes
- SHA-256: `C4D3B377F8F32F0403D0184EFD747F9E26DD91DF4E90E23208A165FA6AFF194A`
- Package: `com.sidelinesquad.app`
- Version name/code: `1.0.0` / `5`
- Min/target SDK: 24 / 36
- Production signing: existing EAS remote upload keystore
- EAS build: `329ba1d6-a432-4642-9af7-664abc0f2b09`
- EAS build logs: <https://expo.dev/accounts/paciencia1990/projects/sideline-squad/builds/329ba1d6-a432-4642-9af7-664abc0f2b09>

Final emulator APK set generated from that exact AAB:

`C:\Dev\Sideline_Social_Code\build\google-play-release\sideline-social-code5-emulator.apks`

- SHA-256: `0B10F5859BAAF52CA282FBDDD081EE96F26246505CB16C954B63776B7C1ADF72`
- Locally debug-signed by bundletool only for emulator installation

SDK 57 checkpoint APKs:

- All-ABI debug: `build/expo-upgrade-checkpoints/sdk57-stable/sdk57-all-abi-debug.apk`
- x86_64 release smoke: `build/expo-upgrade-checkpoints/sdk57-stable/sdk57-x86_64-release-smoke.apk`

The earlier versionCode 4 production AAB is superseded. Do not upload it.

## 16 KB page-size and 64-bit verification

**PASS**

- Bundle configuration: `PAGE_ALIGNMENT_16K`
- AAB ZIP alignment: PASS with Android build-tools 36 `zipalign -P 16`
- Final release AAB ELF audit: 50/50 libraries pass
  - arm64-v8a: 25/25 at minimum `0x4000`
  - x86_64: 25/25 at minimum `0x4000`
- 64-bit ABIs included: arm64-v8a and x86_64
- Full evidence: `build/google-play-release/code5-aab-elf-alignment.json`

Every `PT_LOAD` segment in every arm64-v8a and x86_64 `.so` extracted directly from the final AAB was checked with NDK `llvm-readelf`.

## Device/emulator tested

- AVD: Pixel 9
- Device/model: `sdk_gphone16k_x86_64`
- Android/API: Android 17 / API 37
- Memory page size: 16,384 bytes
- Resolution/density: 1080 x 2424 / 420 dpi
- Install source: APK set generated from the final code-5 production AAB
- Install method: clean uninstall, bundletool `install-apks`, cold launch
- Physical device: not retested after the SDK 57 upgrade

## Smoke-test results

| Check | Result | Notes |
| --- | --- | --- |
| Clean uninstall/reinstall | PASS | Superseded build removed; code-5 AAB-derived APK set installed cleanly |
| Package/version/API | PASS | `com.sidelinesquad.app`, code 5, target 36 |
| Cold launch | PASS | 3.881 s immediately after clean install; 1.712 s after session cleanup |
| Splash/loading | PASS | Get Started screen rendered without Metro/dev server |
| Login UI | PASS | Email/password and Forgot Password rendered |
| Signup UI | PASS | First/last name, email, password, zip, optional sport rendered |
| Authenticated Home | PASS | Temporary Auth-only account reached real Home; account deleted afterward |
| Home tab | PASS | My Teams and first-level cards rendered |
| Squad tab | PASS | Nearby sidelines/search/create UI rendered |
| Games tab | PASS | Games list and join-code UI rendered |
| Friends tab | PASS | Friends, requests, chat, and empty state rendered |
| Profile tab | PASS | My Profile, identity, current mode card, and settings rendered |
| Offline handling | PASS | Airplane-mode sign-in stayed in-app and showed a generic friendly message |
| Android Back | PASS | Public auth routes return to launcher without trapping the user |
| Startup permissions | PASS | Microphone, fine location, and notifications remain denied/unrequested on clean launch |
| App-specific log scan | PASS | No fatal, JS, native-load, permission-denial, or missing-asset match |
| Temporary test cleanup | PASS | Auth-only accounts deleted; emulator app session/data cleared |

The temporary smoke accounts had no Firestore profile and were deleted in the same guarded test operation.

## Automated verification

- `npx expo install --fix`: PASS, dependencies up to date
- Expo Doctor: 19/20; only the expected maintained-native config synchronization warning
- TypeScript: PASS
- ESLint: PASS with zero warnings (legacy-config migration notice only)
- Existing regression suites: 23/23 PASS
- Android production JavaScript export: PASS
- All-ABI debug native build: PASS
- x86_64 embedded-JS release smoke build: PASS
- EAS production AAB: PASS
- Bundletool structural validation: PASS
- Normal Android bundle signature verification: PASS
- AAB ZIP alignment: PASS
- 16 KB release ELF audit: 50/50 PASS
- Clean AAB-derived install/startup: PASS
- Authenticated first-level navigation: PASS
- Production npm audit: 0 critical, 0 high, 11 moderate

The remaining moderate npm advisories are in Expo build/config tooling through the `xcode`/`uuid` chain. npm's forced repair proposes a breaking, incompatible Expo package change, so it was not applied.

## Crash and log findings

- No `FATAL EXCEPTION` or app `AndroidRuntime` crash.
- No React Native JavaScript error match.
- No `UnsatisfiedLinkError` or `dlopen` failure.
- No permission-denial/security exception from Sideline Social.
- No missing asset or missing JavaScript bundle error.
- Sensitive permissions were not requested during clean unauthenticated launch.
- Offline authentication failed gracefully without exposing raw Firebase/native errors.
- Authenticated Home showed a graceful Challenge unavailable state for the temporary profile-less account.

## Permissions review

Release-sensitive permissions map to visible features:

- Approximate/fine location: nearby Squad discovery
- Microphone: user-initiated voice messages
- Notifications: team, friend, and app alerts

`RECORD_AUDIO` appears exactly once in the final manifest. Obsolete external-storage permissions and release `SYSTEM_ALERT_WINDOW` are absent. Microphone permission remains deferred until Record; that behavior is covered by automated tests. Final grant/deny/Don't ask again testing on a physical Android device is still required.

## Signing and identity

- App name: Sideline Social
- Android package/application ID: `com.sidelinesquad.app`
- Native namespace: `com.sidelinesquad.app`
- Firebase Android client package: unchanged
- EAS project ID: unchanged
- Production signing: existing managed EAS upload keystore
- EAS remote version source: enabled
- EAS production auto-increment: enabled
- Final code: 5
- Google Play App Signing enrollment/upload-certificate match: confirm in Play Console

The checked-in local Gradle release type still uses the debug keystore for local smoke builds. The upload candidate is only the remotely signed EAS AAB listed above.

## Production content/security audit

- No runtime localhost/emulator endpoint found outside test code.
- No Maps production secret is tracked in git.
- The Maps key is stored as an EAS production secret and was confirmed present/matching in the final AAB without displaying it.
- Firebase client config files contain Firebase web/mobile API identifiers as expected; these are not the Maps production secret.
- Four runtime files contain `console.log` diagnostics. They were not visible in production UI and did not produce a startup failure, but they should be reviewed in a later logging-hardening pass.
- No sample/demo branding was observed.
- No Expo developer menu or Metro dependency appeared in the production install.
- Production npm audit has no critical/high advisories after the undici override.

## Remaining review blockers

### 1. Privacy policy

**Not found.** The app collects account, communication, location, audio, child/team association, and device/push data. Before review:

- Publish a legally reviewed privacy policy at a public HTTPS URL.
- Add a clearly labeled in-app privacy-policy link.
- Configure the same URL in Play Console.

### 2. Account deletion

**In-app deletion is implemented and emulator tested; the required public web resource is not found.** Before review:

- Rerun and deploy/verify the reviewed in-app/backend deletion revision, including the 2026-07-20 season and conversation reference cleanup.
- Publish a public account-deletion request URL.
- Define and disclose deletion/retention behavior for Authentication, Firestore, Storage, chats, messages, children, teams, squads, and safety records.

The public URL, retention periods and operational verification require product/legal decisions. The in-app flow must not be described as absent.

## Data Safety answers to prepare

Confirm the final declaration against the privacy policy, retention policy, Firebase contracts, and production behavior. Audited categories include:

- Personal information: name, email and user ID. Phone/profile-photo schema support exists, but no active collection UI/upload flow was found; do not declare those solely from schema presence
- Child information entered by a parent: display names and team associations
- Approximate/precise location: nearby Squad discovery
- User content: friend chat, team messages/replies, announcements, Squad names, reports
- Audio: team-wide and private voice messages
- App activity: teams/Squads, sessions/scores, challenges, rewards, friend requests, blocks, notification state
- Device/other identifiers: Firebase installation and FCM push tokens
- Diagnostics: no app-owned Crashlytics integration was found; confirm all provider behavior

Likely purposes: app functionality, account management, communication, safety/security, personalization, and notifications. Confirm encryption in transit, retention, deletion, optional vs required collection, data sharing/service-provider treatment, and whether Families/child-directed policy applies.

Official guidance: <https://support.google.com/googleplay/android-developer/answer/10787469>

## Store-listing assets and Play Console setup

Present in the repository:

- App name
- Standard/adaptive icons
- Splash artwork

Still required or not verified:

- Phone screenshots
- Tablet screenshots if tablet distribution remains enabled
- Feature graphic
- Final short description (80 characters maximum)
- Final full description
- Public privacy-policy URL
- Support contact/website
- App category/tags
- Content rating questionnaire
- Target audience/Families determination
- Ads declaration
- Data Safety form
- Account-deletion URL
- Dedicated non-personal reviewer credentials and App access instructions
- Release notes

Planning placeholders only:

- Short description: `[TODO: final Play short description]`
- Full description: `[TODO: final Play description]`
- Privacy policy: `[TODO: public HTTPS URL]`
- Account deletion: `[TODO: public HTTPS deletion URL]`
- Reviewer account: `[TODO: dedicated non-personal account]`

## Exact next steps

1. Publish the privacy policy and add its in-app link.
2. Deploy/verify the reviewed deletion corrections and publish the deletion-request URL.
3. Create a dedicated Parent/Coach reviewer account and App access instructions.
4. Complete Data Safety, content rating, audience/Families, ads, category/tags, support contact, and store descriptions.
5. Produce phone/tablet screenshots and a feature graphic from the final build.
6. Confirm Play App Signing enrollment and that the registered upload certificate matches the EAS credential.
7. Restrict the Maps key to `com.sidelinesquad.app` and the production signing certificate fingerprints in Google Cloud.
8. Run physical-device tests for notification, location, and microphone grant/deny/Settings flows, Parent/Coach switching, voice upload/playback, chats, teams, and Squads.
9. Build and inspect a replacement production AAB containing the reviewed privacy corrections, then upload it to Internal testing; do not use the pre-correction code-5 artifact for review.
10. Resolve every Play Console warning and pre-launch report issue before review/promotion.

Official policy references:

- Target API: <https://support.google.com/googleplay/android-developer/answer/11926878>
- 16 KB support: <https://developer.android.com/guide/practices/page-sizes>
- Privacy policy: <https://support.google.com/googleplay/android-developer/answer/17105854>
- Account deletion: <https://support.google.com/googleplay/android-developer/answer/13327111>

## Tracked files modified

- `.eslintrc.js`
- `GOOGLE_PLAY_REVIEW_CHECKLIST.md`
- `android/app/build.gradle`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/com/sidelinesquad/app/MainApplication.kt`
- `android/app/src/main/res/values/styles.xml`
- `android/build.gradle`
- `android/gradle.properties`
- `android/gradle/wrapper/gradle-wrapper.properties`
- `android/settings.gradle`
- `app.config.js`
- `app/_layout.tsx`
- `components/CoachResourceHeader.tsx`
- `components/GluestackInitializer.tsx`
- `components/NotificationCoordinator.tsx`
- `components/VoiceMemoComposer.tsx`
- `components/VoiceMemoPlayer.tsx`
- `eas.json`
- `i18n/polyfills.ts`
- `metro.config.js`
- `package-lock.json`
- `package.json`
- `scripts/test-coach-communication-regressions.cjs`
- `scripts/test-friend-chat-core.cjs` (pre-existing unrelated change preserved)
- `scripts/test-team-voice-private-core.cjs`
- `scripts/test-voice-microphone-permission.cjs`
- `services/teamVoiceAudioCapability.ts`
- `services/voiceMemoFileService.ts`
- `services/voiceMemoPermissionService.ts`
- `src/game/spotDifference/SpotDifferenceScreen.tsx`
- `tsconfig.json`

Generated checkpoints, native references, exports, logs, screenshots, APKs, APK sets, AABs, and alignment JSON are under ignored `build/` paths and are not tracked.

## Final status

**PARTIAL: the final code-5 AAB builds, signs, aligns, installs, launches, works offline, and passes authenticated first-level navigation. Complete privacy policy, account deletion, store listing, Data Safety, reviewer access, and physical-device testing before submitting it for Google Play review.**
