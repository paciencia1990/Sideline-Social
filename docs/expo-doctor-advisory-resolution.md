# Expo Doctor Advisory Resolution

Date: 2026-08-20

Branch: `chore/expo-sdk57-patch-alignment`

Baseline commit: `2dd231a` (`origin/chore/expo-sdk57-patch-alignment` matched before this task)

## Outcome

The two Expo Doctor advisories were resolved without deleting native projects, changing authentication behavior, upgrading a major dependency, or weakening broad validation.

- Before: **19/21 checks passed**, with the native-config synchronization advisory and the React Native Directory New Architecture advisory.
- After: **20/20 checks passed**. Expo's single `appConfigFieldsNotSyncedCheck` is intentionally disabled using its documented setting because the project has an audited mixed native strategy and a stronger project-specific parity gate. The React Native Directory check remains enabled; only `react-native-nitro-google-signin` is excluded.

This is intentionally not reported as 21/21. One generic check is disabled and replaced by `npm run test:native-config-parity`, while all 20 checks that still run pass.

No Firebase deployment, EAS build, production-data change, provider-console change, OAuth-client change, merge, or major dependency upgrade was performed as part of this work. Repository commit and push are handled separately as an owner-authorized handoff step.

## Advisory 1: checked-in native project and app configuration

### Root cause

The repository uses a mixed native-project strategy:

- **Android:** `android/` contains 48 tracked files and is the authoritative, hand-maintained Android implementation. EAS uses this checked-in project and does not run Prebuild for Android.
- **iOS:** no `ios/` directory exists or is tracked. EAS generates iOS from `app.config.js` through Continuous Native Generation/Prebuild.

Expo Doctor detects the tracked Android directory and the native fields in `app.config.js`, but its generic check cannot verify the project's explicit variant logic, Firebase-resource injection, backup rules, or platform-specific strategy. The advisory was therefore a real architecture/maintenance notice. The audit also found real Android drift that justified correction before excluding the generic check.

Expo's documentation confirms that EAS Build does not run Prebuild when native directories are present, that existing React Native projects may keep native projects authoritative, and that `expo.doctor.appConfigFieldsNotSyncedCheck.enabled` is the supported narrow control for this check.

### Native mismatches corrected

1. `app.config.js` declares `userInterfaceStyle: "light"`, while the tracked Android resource still declared `automatic`. The native value now declares `light`.
2. The tracked Android splash resources were stale placeholder artwork, while `app.config.js` configures `assets/branding/sideline-social-logo.png`. All five Android density resources now contain the reviewed configured logo output.
3. The tracked Android resources lacked the current Expo splash resize-mode value. `expo_splash_screen_resize_mode` now explicitly declares `contain`, matching the splash plugin configuration.

No other proven native-config mismatch was found. In particular:

- Android release package: `com.sidelinesquad.app`; development package: `com.sidelinesquad.app.dev`.
- iOS bundle identifier: `com.sidelinesocial.app` for both profiles.
- Production/development labels and schemes match the app config and Gradle manifest placeholders.
- Android is portrait, light-only, uses `adjustResize`, API 36, Hermes, and the New Architecture.
- The configured launcher and adaptive-icon source assets match the reviewed tracked launcher set semantically; no launcher artwork was changed in this task.
- The splash background remains white and resize mode remains `contain`.
- Location and microphone permissions are granted as required. Camera, broad media, and calendar permissions are absent or explicitly removed. Notification and vibration support remain present through the configured native module/merged manifest.
- English and Spanish iOS location, microphone, motion, photo-library, save-photo, and write-only calendar descriptions remain configured.
- Google Maps remains a Gradle manifest placeholder sourced at build time; no API key was embedded or printed.
- The production Android Firebase resource matches the release package. The development Firebase resource remains injected from the existing EAS file variable into its ignored debug-only target.
- Android backup and data-extraction rules remain deny-all and regeneration-safe through `withAndroidBackupProtection`.
- Apple authentication remains configured for CNG iOS and resolves the Sign in with Apple entitlement.
- Android intent filters and iOS Google URL-scheme plugin configuration remain variant/config driven.
- Expo plugins and native autolinking remain intact.

### Automated parity protection

`scripts/test-native-config-parity.cjs` now validates:

- the authoritative tracked-Android/CNG-iOS strategy;
- exact Expo Doctor configuration, preventing a blanket Directory exclusion;
- raw and fully introspected development/production Expo configuration;
- package IDs, bundle ID, labels, schemes, orientation, UI style, keyboard mode, and versioning;
- Android manifest permissions, Maps placeholder, deep-link intent filters, Firebase package selection, backup controls, and Gradle variant behavior;
- localized iOS permission descriptions and Apple entitlement resolution;
- reviewed launcher, adaptive-icon, and splash asset/resource integrity;
- the installed Nitro Google Sign-In version and representative Android, iOS, C++, CMake, podspec, and generated Nitro files.

`package.json` exposes this as `npm run test:native-config-parity`. Only after this gate passed was the officially supported `appConfigFieldsNotSyncedCheck.enabled: false` setting added.

Migrating Android to CNG may be reasonable in a separate project after its Gradle variant handling, development Firebase-file injection, Maps placeholder, API/ABI settings, backup rules, and any template deviations are moved into config plugins and proven equivalent. That migration was not safe or necessary in this task.

## Advisory 2: Google Sign-In and New Architecture

### Root cause and classification

Installed versions:

- `react-native-nitro-google-signin` `1.3.0`
- `react-native-nitro-modules` `0.36.5`
- React Native `0.86.2`

The finding is missing React Native Directory metadata, not a demonstrated incompatibility. The current React Native Directory record lists iOS, Android, examples, and a config plugin, but does not include its `newArchitecture` field. Expo Doctor consequently classifies the package as untested.

Compatibility evidence is stronger than that incomplete directory record:

- The package's official documentation says it is built for the New Architecture on React Native 0.76+ using Nitro Modules and works in Expo development builds.
- Expo's current Google authentication guide explicitly lists `react-native-nitro-google-signin` as the modern-native-API option and notes its Android Credential Manager support.
- The installed package contains generated Nitro HybridObject/HybridView C++, Kotlin, Swift, CMake, podspec, and platform autolinking sources.
- The project has `newArchEnabled=true` and React Native 0.86.2, above the package's documented minimum.
- Android release configuration completed successfully with Nitro Google Sign-In/New Architecture codegen and autolinking tasks.
- Production Android and iOS JavaScript exports completed successfully.

Version `1.3.0` is the newest release in the installed major line. The current latest release is `2.0.0`, which is a prohibited major upgrade for this task and is not required to establish New Architecture compatibility. No patch release exists that merely fixes the Directory metadata.

The narrow supported configuration therefore excludes exactly `react-native-nitro-google-signin` from `expo.doctor.reactNativeDirectoryCheck.exclude`. The Directory check remains enabled, unknown packages remain listed, and the parity regression test rejects any broader exclusion.

### Authentication behavior audit

Sideline Social's implementation matches the package's documented One Tap flow and preserves existing Firebase identity behavior:

- `configure()` disables automatic selection, additional scopes, and offline/server-token access.
- The flow checks Play Services, attempts saved-account sign-in, then account creation, then explicit sign-in if required.
- Cancellation, missing-credential, configuration, network, and interrupted states are normalized without changing user-visible account behavior.
- Only the Google ID token is exchanged for a Firebase credential; OAuth access/refresh tokens are not persisted.
- Existing-account conflicts remain protected through pending-credential handling and `linkWithCredential`.
- Reauthentication, provider unlink protection, best-effort Google access revocation, and Apple authorization-code revocation remain covered.
- Android development/production packages, Firebase client selection, iOS config/plugin paths, and URL schemes remain variant-correct.

No authentication source, OAuth identifier, Firebase provider setting, EAS secret, certificate, fingerprint, or console setting changed.

## Official sources reviewed

- [Expo package.json Doctor configuration](https://docs.expo.dev/versions/latest/config/package-json/)
- [Expo Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)
- [Expo New Architecture guide](https://docs.expo.dev/guides/new-architecture/)
- [Expo Google authentication guide](https://docs.expo.dev/guides/google-authentication/)
- [React Native Nitro Google Sign-In documentation](https://react-native-nitro-google-sign-in.github.io/)
- [React Native Nitro Google Sign-In repository and usage](https://github.com/react-native-nitro-google-sign-in/google-signin)
- [React Native Nitro Google Sign-In releases](https://github.com/react-native-nitro-google-sign-in/google-signin/releases)
- [React Native Directory source record](https://raw.githubusercontent.com/react-native-community/directory/main/react-native-libraries.json)
- [React Native New Architecture overview](https://reactnative.dev/blog/2024/10/23/the-new-architecture-is-here)
- [React Native 0.86 release](https://reactnative.dev/blog/2026/06/11/react-native-0.86)

## Verification

| Check | Result |
| --- | --- |
| Baseline Expo Doctor | 19/21; both expected advisories reproduced |
| Final Expo Doctor | 20/20; native-sync check explicitly disabled, Directory check still enabled |
| `npx expo install --check` | Passed; dependencies are up to date |
| Native-config parity | Passed, including production and development Expo introspection |
| TypeScript | Passed |
| ESLint | Passed; existing legacy-config notice only |
| Federated authentication | Passed |
| Authentication navigation | Passed |
| Authentication identity/permanent boundary | Passed |
| Android variants | Passed |
| iOS release regression | Passed |
| iOS production validation | Passed with the expected local `GOOGLE_SERVICES_INFO_PLIST` warning |
| Apple authorization revocation | Passed under the pinned Functions Node 22 toolchain |
| Functions TypeScript build | Passed under Node 22 |
| Android release manifest/backup validation | Passed; Gradle build successful |
| Android production export | Passed: 3,881 modules, 79 assets, 10,262,269-byte Hermes bundle, 21,758,758 bytes total |
| iOS production export | Passed: 3,791 modules, 75 assets, 10,063,919-byte Hermes bundle, 20,598,518 bytes total |
| `git diff --check` | Passed; Windows line-ending notices only |

Initial sandbox-only failures were rerun successfully with the required permissions: Expo dependency checking could not reach the sandbox proxy, iOS validators could not spawn their Expo-config child process, and Functions TypeScript could not write ignored compiled output. None reached or failed product assertions.

## Changed files

- `package.json`
- `scripts/test-native-config-parity.cjs`
- `android/app/src/main/res/values/strings.xml`
- `android/app/src/main/res/drawable-mdpi/splashscreen_logo.png`
- `android/app/src/main/res/drawable-hdpi/splashscreen_logo.png`
- `android/app/src/main/res/drawable-xhdpi/splashscreen_logo.png`
- `android/app/src/main/res/drawable-xxhdpi/splashscreen_logo.png`
- `android/app/src/main/res/drawable-xxxhdpi/splashscreen_logo.png`
- `docs/expo-doctor-advisory-resolution.md`

The dependency lockfiles, authentication source, Functions source/manifests, iOS native files, Firebase rules/indexes, and provider configuration are unchanged.

## Native rebuild and remaining risk

Fresh **Android and iOS development builds are required** before device acceptance testing because tracked Android native resources changed and this task's acceptance requirement treats native changes as a two-platform rebuild boundary. No build was started.

The main remaining external limitation is that the local environment does not contain `GOOGLE_SERVICES_INFO_PLIST`; the iOS CNG structure passed, but the actual remotely supplied plist and resulting URL scheme must be confirmed in the approved development build without printing its contents.

Physical-device checks should confirm:

1. The corrected branded Android splash, white background, contain scaling, and light-only system UI.
2. Google sign-in on Android development and production-signed variants, including cancellation, no-saved-account fallback, explicit sign-in, account linking, reauthentication, and revocation.
3. Google sign-in and callback URL handling on iOS using the remotely supplied Firebase resource.
4. Apple sign-in, linking, reauthentication, and deletion-time authorization revocation on iOS.
5. App deep links, Maps, location, microphone, photo selection/save, calendar export, and notification permission behavior.

## Recommended next action

Review the native resource and parity-test diff, then create fresh Android and iOS development builds. Complete the physical-device matrix above before merging. Separately, consider contributing `newArchitecture` metadata to the React Native Directory record so the package-specific exclusion can eventually be removed. Do not migrate Android to CNG or upgrade Google Sign-In to 2.x without a dedicated migration plan and equivalent native-variant coverage.
