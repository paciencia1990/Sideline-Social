# Google Play Review Readiness Checklist

Audit date: July 17, 2026

Repository: `C:\Dev\Sideline_Social_Code`

Branch: `main`

## Overall result

**FAIL: must fix before upload.**

The app builds and launches, and a production Android App Bundle can be generated with the managed EAS upload credential. It must not be submitted for review yet because:

1. Expo SDK 51 / React Native 0.74 native libraries are not compatible with 16 KB memory pages. All 49 arm64 native libraries inspected in the production bundle had LOAD segment alignment below 16 KB. Google Play requires 16 KB support for API 35+ submissions.
2. No public privacy-policy URL or in-app privacy-policy screen/link was found.
3. The app supports account creation but no in-app account-deletion path or account-deletion web URL was found.
4. A complete authenticated smoke test could not be performed because no dedicated Play-review/test credentials were provided.

## Project stack

- Expo SDK 51 with Expo Router
- React Native 0.74.5
- React 18.2
- Maintained native Android directory
- Firebase Authentication, Firestore, Realtime Database, Cloud Functions, Storage, and Cloud Messaging
- Hermes JavaScript engine
- EAS Build for production signing and App Bundle generation

This is not a purely managed Expo project. Because `android/` is checked in, the native Gradle and manifest files are authoritative for Android builds.

## Changes made during this audit

- Added repeatable npm commands for the debug APK, debug installation, and production AAB.
- Set the checked-in Android target SDK to API 35, which is the current Google Play submission minimum for phone apps.
- Kept compile SDK at API 34 because Expo SDK 51's permission module fails Kotlin compilation against compile SDK 35. This is a temporary compatibility measure, not the long-term Play-readiness solution.
- Removed obsolete READ/WRITE external-storage permissions from the merged Android manifest using manifest-merger removal directives.
- Removed `SYSTEM_ALERT_WINDOW` from the main manifest. It remains debug-only through `android/app/src/debug/AndroidManifest.xml`.
- Preserved required location, microphone, notification, networking, vibration, and Firebase messaging permissions.
- Added Android versionCode 1 to the Expo config for consistency with the checked-in native source. EAS production builds use remote version management and auto-increment.
- Added the existing Google Maps key to the EAS production environment as a project-scoped secret. The value is not stored in source control.

## Build commands used

```powershell
npm run android:apk:debug
cd android
.\gradlew.bat processDebugMainManifest processReleaseMainManifest assembleDebug
cd ..
npx eas-cli@latest build --platform android --profile production --non-interactive --wait
```

Additional validation and install-test commands used:

```powershell
npm run typecheck
npm run lint
npm run test:voice-microphone-permission
java -jar bundletool-all-1.18.3.jar validate --bundle <bundle-path>
java -jar bundletool-all-1.18.3.jar build-apks --mode=universal --bundle <bundle-path> --output <apks-path>
adb install -r -t <debug-apk>
adb shell am start -W -n com.sidelinesquad.app/.MainActivity
adb logcat
```

## Build artifacts

Debug install APK:

`C:\Dev\Sideline_Social_Code\android\app\build\outputs\apk\debug\app-debug.apk`

- Package: `com.sidelinesquad.app`
- Version name: `1.0.0`
- Version code: `1`
- Minimum SDK: 23
- Target SDK: 35
- Signed with the standard Android debug certificate
- Architectures: arm64-v8a, armeabi-v7a, x86, x86_64

Final production AAB:

`C:\Dev\Sideline_Social_Code\android\app\build\outputs\bundle\production\sideline-social-1.0.0-3.aab`

- EAS production build uses remote version auto-increment.
- Version name: `1.0.0`
- Version code: `3`
- Distribution: Google Play Store
- Signing: managed EAS Android upload keystore
- Architectures: arm64-v8a, armeabi-v7a, x86, x86_64
- SHA-256: `42BDAE873582AD8F41F852DE6C8BC4CCE6B9D58F810FF7F8A4671D6CD0DE5FE2`
- Bundletool structural validation: PASS
- Clean AAB-derived install and cold launch: PASS
- **Do not upload for review until the 16 KB page-size blocker is fixed.**

An earlier validation bundle, version code 2, was generated and installed successfully. It was superseded because its uploaded source snapshot preceded the obsolete-storage-permission cleanup.

## Device and emulator testing

### Physical device attempt

- Device: Samsung SM-S931U1
- OS: Android 16
- API level: 36
- Result: inconclusive
- The existing package was selected for clean uninstall/reinstall, but the device disconnected from ADB during the 157 MB APK transfer and did not reconnect during the test window.
- The app may need to be reinstalled on this device from the saved debug APK.

### Completed emulator test

- AVD: Pixel 9
- Reported model: `sdk_gphone16k_x86_64`
- OS: Android 17
- API level: 37
- RAM for successful run: 4 GB
- Page size environment: 16 KB compatibility testing

The first 2 GB emulator run was killed by Android's low-memory killer before startup completed. This was an emulator resource condition, not an application exception. After restarting with 4 GB RAM, both the debug client and the AAB-derived production app launched successfully.

## Smoke-test results

| Check | Result | Notes |
| --- | --- | --- |
| Clean uninstall/reinstall | PASS on emulator | Package was removed and reinstalled from scratch. Physical device disconnected during its attempt. |
| Cold launch | PASS | Main activity launched and remained foreground. |
| Splash/loading completes | PASS | Branded welcome screen appeared. |
| Production JavaScript embedded | PASS | AAB-derived app launched without Metro or a development server. |
| Home screen | NOT TESTED | Requires an authenticated account and completed onboarding. |
| Login UI | PASS | Email/password screen rendered with Sign In and Forgot Password actions. |
| Signup UI | PASS | First name, last name, email, password, zip code, optional sport, and Create Account controls rendered. |
| Actual login/signup backend | NOT TESTED | No dedicated test credentials; no production Firebase account was created during the audit. |
| Guest/demo mode | NOT AVAILABLE | Authentication is required. |
| Main tab navigation | NOT TESTED | Requires authenticated onboarding. |
| First unauthenticated actions | PASS | Get Started, Sign in with Email, Create Account, and Android Back navigation worked. |
| Offline handling | PASS, limited | Offline sign-in stayed in-app and displayed a generic credential error; no crash occurred. The message does not distinguish offline from invalid credentials. |
| Android Back | PASS for tested auth routes | Back returned from email login/signup to the auth choice without trapping the user. |
| Startup permission prompts | PASS | Microphone, fine location, and notification permissions remained denied after cold launch. |
| Microphone permission flow | PASS automated test | Permission is requested only after the user taps Record; denial and Settings handling remain covered. |
| Privacy policy/link | FAIL | No privacy-policy URL or in-app policy link found. |
| Account deletion | FAIL | No in-app deletion flow or deletion web URL found. |

Authenticated Home, tab navigation, team/squad flows, notification permission timing after login, location request timing, voice recording on a real device, and privacy/account actions still require a dedicated reviewer account and physical-device test.

## Crash and logcat findings

- No `FATAL EXCEPTION`, AndroidRuntime crash, React Native fatal startup error, Firebase startup error, security exception, permission denial, missing asset error, or missing JavaScript bundle error occurred in the successful 4 GB emulator runs.
- The production AAB-derived process stayed foreground and rendered the welcome screen.
- Microphone, location, and notification runtime permissions were not granted or requested during startup.
- The initial emulator process termination was explicitly reported by Android's low-memory killer while the 2 GB emulator was below its memory watermark.
- Android 17 displayed a compatibility warning because the native libraries are not 16 KB aligned. This is a real Google Play blocker, not an emulator-only cosmetic warning.
- A debug-only React Native LogBox showed the underlying Firebase network error during the offline test. The user-facing app message remained generic, and the AAB-derived production install did not contain the developer menu.

## Google Play readiness

### Target SDK

- Current checked-in target: API 35
- Current Google Play phone-app minimum on July 17, 2026: API 35
- Starting August 31, 2026, new apps and updates must target API 36.
- Because the framework must be upgraded for 16 KB support anyway, the replacement build should target API 36 now.

Official policy:

https://support.google.com/googleplay/android-developer/answer/11926878

### 16 KB memory-page support

**FAIL**

- Google Play has required 16 KB page-size support for API 35+ submissions since November 1, 2025.
- Android 17 displayed the native compatibility warning.
- ELF audit: 49 arm64 libraries checked, 0 passed 16 KB LOAD-segment alignment.
- React Native first added full 16 KB support in React Native 0.77. This project uses React Native 0.74.5.

Official guidance:

https://developer.android.com/guide/practices/page-sizes

### App Bundle and signing

- Production format: Android App Bundle (`.aab`) — PASS
- Bundletool structural validation — PASS
- EAS managed upload keystore used — PASS
- 64-bit arm64-v8a and x86_64 native libraries included — PASS
- Google Play App Signing enrollment/verification — must be confirmed in Play Console
- The checked-in Gradle release block still references the debug keystore for direct local release builds. The documented production path is EAS, which injects and uses the managed remote keystore. Do not upload a direct local `bundleRelease` artifact unless proper local release signing is configured.

### Application identity and versions

- App name: Sideline Social
- Android package/application ID: `com.sidelinesquad.app`
- Native namespace: `com.sidelinesquad.app`
- Firebase Android client package: expected to match `com.sidelinesquad.app`
- Version name: `1.0.0`
- Native local version code: `1`
- EAS remote version source: enabled
- EAS production auto-increment: enabled
- Latest final audit build version code: `3`

### Permissions

Release permissions with user-facing sensitive access:

- Approximate/fine location: used to find nearby squads
- Microphone: used for user-initiated voice messages
- Notifications: used for team/friend/app notifications

These permissions map to visible app features. Location, microphone, and notification permission timing still needs complete authenticated physical-device testing.

Obsolete external-storage permissions were removed from the final merged source manifest. `SYSTEM_ALERT_WINDOW` is debug-only and is absent from the release merged manifest.

### Privacy policy and account deletion

**FAIL**

- No public privacy-policy URL is configured.
- No in-app privacy-policy text or link was found.
- No in-app account-deletion flow was found.
- No public account-deletion request URL was found.

Google Play requires every app to supply a privacy-policy link. Apps that allow account creation must also provide an in-app deletion path and a web deletion path.

Official requirements:

https://support.google.com/googleplay/android-developer/answer/17105854

https://support.google.com/googleplay/android-developer/answer/13327111

### Data Safety answers to prepare

The Play Console declaration must be confirmed against production Firebase configuration, retention policy, service-provider contracts, and final privacy policy. Based on the audited code, prepare answers for at least:

- Personal information: name, email address, optional phone number, profile image/URL, account/user ID
- Child information entered by a parent: child display names and team associations
- Approximate and precise location: nearby-squad discovery
- User content: friend chats, team messages/replies, announcements, group names, reports
- Audio files: team-wide and private voice messages
- App activity: squads/teams joined, game sessions/scores, challenges, rewards, friend requests, blocks, notification read state
- Device or other identifiers: Firebase/FCM installation and push tokens
- Crash/diagnostic data: no app-owned Crashlytics integration was found, but final SDK behavior must be verified

Likely purposes include app functionality, account management, communications, safety/security, personalization of sports/community content, and notifications. Confirm whether any data is considered “shared” under Play's definitions, how Firebase acts as a service provider, whether all data is encrypted in transit, retention periods, deletion behavior, optional versus required collection, and whether child-directed/Families policies apply.

Official Data Safety guidance:

https://support.google.com/googleplay/android-developer/answer/10787469

### Store-listing assets and metadata

Present:

- App name: Sideline Social
- 1024 × 1024 standard icon
- 1024 × 1024 adaptive foreground icon
- Splash artwork

Not found and still required/preparation needed:

- Phone screenshots
- 7-inch and 10-inch tablet screenshots if tablet distribution remains enabled
- Feature graphic
- Short description
- Full description
- Public privacy-policy URL
- Support email/website/phone as applicable
- App category and tags
- Content rating questionnaire
- Target audience and Families-policy determination
- Ads declaration
- App access instructions and dedicated reviewer credentials
- Data Safety form
- Account-deletion URL
- Release notes

Suggested placeholders for planning only:

- Short description: `[TODO: final Play short description, maximum 80 characters]`
- Full description: `[TODO: final feature-focused Play description]`
- Privacy policy: `[TODO: public HTTPS URL]`
- Account deletion: `[TODO: public HTTPS deletion-request URL]`
- Reviewer credentials: `[TODO: dedicated non-personal review account]`

### Production content audit

- No localhost or emulator endpoint is used by normal application runtime code; localhost references found were confined to test scripts.
- Production AAB install launched the app directly without the Expo developer menu.
- Google Maps key is provided to EAS as a production secret. Restrict the key in Google Cloud to the Android application ID and production signing-certificate SHA-1/SHA-256 values.
- Firebase configuration points to the Sideline project rather than an emulator.
- Source-level console logging remains in several app/service files. Most entries are error diagnostics and are not visible in the production UI, but debug instrumentation logs should be removed or guarded during the framework-upgrade pass.
- Google and Apple sign-in methods currently log “not configured” if called; no first-level buttons for those providers were observed in the tested Android auth flow.
- No sample/demo branding was observed in the production welcome/auth screens.

## Exact next steps before Google Play submission

1. Create a dedicated upgrade branch and upgrade from Expo SDK 51 / React Native 0.74 to at least Expo SDK 54 / React Native 0.81. SDK 54 targets API 36, supports 16 KB pages, and is the final Expo release that permits the legacy architecture. A move to current stable Expo SDK 56 is preferable but also requires New Architecture migration.
2. Regenerate or carefully merge the maintained Android native project during the Expo upgrade. Preserve the package ID, Firebase setup, Maps manifest placeholder, microphone permission, deferred audio compatibility behavior, and the storage-permission removal directives.
3. Rebuild a production AAB and rerun bundletool validation, arm64 ELF alignment checks, and a 16 KB emulator launch with compatibility mode disabled/fatal.
4. Re-run all TypeScript, ESLint, authentication, navigation, profile, notification, squad/team, chat, voice, and Android JavaScript export tests after the framework upgrade.
5. Publish a legally reviewed privacy policy at a public HTTPS URL. Include developer identity/contact, collected and shared data, purposes, Firebase/processor disclosures, security, retention, deletion, children's data, and policy-change handling.
6. Add a clearly labeled privacy-policy link inside the app and configure the same URL in Play Console.
7. Implement authenticated in-app account deletion and publish a web deletion-request URL. Verify associated Firebase Authentication and stored user data are deleted or retained exactly as disclosed.
8. Create a dedicated Play-review account with representative Parent and Coach access. Do not use a personal account. Supply exact navigation instructions in App access.
9. Complete authenticated physical-device smoke tests, including Home/tabs, Parent/Coach switching, teams/squads, friend chat, notifications, location denial/grant, microphone denial/grant/Settings, offline behavior, and Android Back.
10. Prepare screenshots, feature graphic, short/full descriptions, category/tags, support contact, content rating, target audience, ads declaration, Data Safety form, and release notes.
11. Confirm Google Play App Signing enrollment and that the EAS upload certificate matches the registered upload certificate. Restrict the Google Maps API key to the final production signing fingerprints.
12. Upload the replacement 16 KB-compatible API 36 AAB to Internal testing first. Resolve every Play Console warning and pre-launch report issue before promoting to closed or production review.

## Automated verification

- Debug APK build: PASS
- Debug and release merged-manifest generation: PASS
- Production EAS App Bundle build: PASS
- Bundletool validation: PASS
- AAB-derived production install: PASS
- Cold launch and splash completion: PASS
- TypeScript: PASS
- ESLint: PASS
- Voice microphone-permission regression test: PASS
- Target API 35: PASS for current policy, temporary
- 64-bit support: PASS
- 16 KB native alignment: FAIL
- Privacy policy: FAIL
- Account deletion: FAIL
- Full authenticated smoke test: NOT TESTED
