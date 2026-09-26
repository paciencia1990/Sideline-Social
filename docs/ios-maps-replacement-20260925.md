# iOS Maps replacement build — 2026-09-25

## Confirmed failure and correction

Failed EAS build: https://expo.dev/accounts/paciencia1990/projects/sideline-squad/builds/ba230f53-74e6-4a9a-94f7-7d2c1ec6aa91

The failed external-testing iOS build (version 1.0.0, build 14) used commit
`d203196879811b8dc92a6934caee828a888e7ba6`. Install pods stopped because
`react-native-google-maps` has no podspec in the installed Maps 1.27.2 package.
The legacy Expo `ios.config.googleMapsApiKey` path emitted that obsolete pod.

`app.config.js` now registers the installed `react-native-maps` Expo plugin with
`iosGoogleMapsApiKey` and the same existing Android key selection. The generated
Podfile includes `react-native-maps/Google`, which exists in the installed
`react-native-maps.podspec`. No dependency or lockfile change was needed.

Version-matched reference:
https://github.com/react-native-maps/react-native-maps/blob/v1.27.2/docs/installation.md

## Validation boundary

`npm run test:ios-maps-prebuild` copies configuration, plugins, assets, and package
inputs to a fresh temporary directory and uses only synthetic Firebase/Maps values.
The working Android project is never prebuilt. Its tracked files are hashed before
and after the check.

On Windows the top-level Expo prebuild CLI skips iOS. The regression therefore
calls the installed CLI's real `updateFromTemplateAsync` and `configureProjectAsync`
stages with the installed Expo template. It does not patch node_modules or fake
the operating system. It checks:

- One current Google Maps subspec, before native autolinking, and no obsolete pod.
- Exactly one Swift `GMSServices.provideAPIKey` with the selected synthetic key.
- Repeat generation does not duplicate Maps pods or initialization.
- Real legacy-plugin generation reproduces the failure and is rejected.
- Maps and Nitro Google Sign-In autolink to their installed iOS podspecs.
- Bundle `com.sidelinesocial.app`, Google URL scheme, Apple sign-in entitlement,
  location usage text, and Firebase plist in Xcode resources remain intact.
- iOS 16.4 template target exceeds Maps 1.27.2's iOS 15.1 minimum; its Google
  subspec pins GoogleMaps 9.4.0 and Google-Maps-iOS-Utils 6.1.0.
- Android introspection retains exactly one Maps entry with its existing selected
  key. EAS project attribution and dependency lockfile remain unchanged.
- A missing builder-provided staging plist fails closed.

**Not run on Windows:** CocoaPods dependency resolution/installation, Swift/ObjC
compilation, Xcode archive/signing, or device Maps/sign-in behavior. These remain
checks for the manually requested EAS/macOS build and subsequent device testing.

## Failed-build warnings

| Finding | Classification | Evidence / disposition |
| --- | --- | --- |
| Obsolete Maps podspec | Confirmed build blocker | Install pods failure; fixed and reproduced by negative regression. |
| Expo Doctor: 19/20 passed; SDK package-version check failed | Relevant compatibility risk | 26 patch-version mismatches, including Expo 57.0.15 vs ~57.0.25 and RN 0.86.2 vs 0.86.3. Build continued to pods. Preserve pinned dependencies; this correction does not claim the Doctor check is now green. |
| Doctor native-config sync check disabled | Non-blocking, deliberate mixed-native strategy | Android is tracked; iOS is generated. Existing native parity test passed. No Doctor exclusions were broadened. |
| Firebase plist not checked in / not uploaded | Non-blocking with verified file-variable mechanism | Installed EAS CLI checks `GOOGLE_SERVICES_INFO_PLIST`, but this configuration intentionally uses `GOOGLE_SERVICES_INFO_PLIST_STAGING`. Failed-builder logs confirm the staging variable points to its builder secret-file directory; prebuild completed. Synthetic generation independently proves copying and resources wiring. Keep the preview EAS file variable provisioned. |
| Outdated EAS CLI notice | Non-blocking | Informational; not the Install pods failure. No CLI upgrade performed. |
| 475 MB source upload | Build efficiency risk | Current pre-fix EAS ignore behavior includes ~1.66 GB uncompressed files, dominated by ignored Android C/C++ caches on Windows. The original uploaded archive is not retained here, so this is a local reconstruction, not a byte-identical historical measurement. |

## Archive correction

`.easignore` preserves the root `.gitignore` rules and explicitly carries forward
nested Android cache exclusions, since EAS replaces nested ignore files when an
`.easignore` exists. It also excludes Git metadata. No local files were deleted.
All application source, assets (including every Spot the Differences puzzle),
plugins, scripts, Android native sources, Gradle wrapper, and required configuration
remain. The locally generated EAS archive measured about 12.3 MB compressed;
every required tracked input was checked against its file listing.

## Manual build handoff

The release-directory `moderation-beta-client-build.ps1` is separately pinned to
the reviewed successor commit and source manifest. It verifies the source and
generated iOS regression before privately retrieving existing staging inputs.
Its default mode validates only. The `-Submit` switch invokes **EAS Build**;
it does not run EAS Submit, upload to TestFlight, or change backend gates.

Use the exact command in the successor local build handoff. No EAS build,
installation, store submission, Apple-credential change, backend deployment,
or moderation activation was performed during this repair.
