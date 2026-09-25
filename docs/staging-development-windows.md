# Phone development testing on Windows

Status: local workflow prepared; private configuration is NOT ready yet.
No new build, cloud configuration change, installation, or app-data clearing
was performed during this preparation.

This is a LOCAL Android build using the installed Android SDK and JDK, not an
EAS cloud build or a Google Play submission. Existing release profiles in
eas.json are unchanged. Do not use `eas build --profile staging-development`;
that is not an EAS build profile.

## What this gives you

After the one-time development APK is built, verified, and installed, you can
load current local JavaScript changes on your phone through Metro over USB.
Keep the VS Code terminal running while testing. Native dependencies or native
configuration changes still require another development APK. Development-mode
testing does not replace final testing of the Play-distributed release.

- Development package: com.sidelinesquad.app.dev
- Backend: sideline-social-staging-2026
- App label: Sideline Social Staging Dev
- Play package com.sidelinesquad.app is not installed, modified, or removed.
- The development APK is intended to update the existing staging version 8,
  not uninstall it. The original staging signer is required.
- AI Coach still requires the existing server-side adult/tester entitlement.
- Existing local photo, Teams, Coach visibility, and onboarding edits are preserved.
- Test actions use real staging data; messages and notifications may reach
  other staging users. Use approved test accounts and recipients.

## Remaining private setup (before building)

Have the assistant prepare these privately. Do not paste keys/passwords in chat.
Do not generate a replacement signing key or uninstall staging to bypass a mismatch.

1. Obtain the existing staging Android Firebase SDK file for
   com.sidelinesquad.app.dev. The external-testing .app identity is not interchangeable.
2. Retrieve the EXISTING staging signing credentials, not a new keystore.
   Required signer SHA-256:
   dcaeb844f874b548fe0f49eadc07438ff9d58ffb3a4ed3b475f955817dc89116
3. Verify a staging Maps SDK for Android key restricted to:
   - com.sidelinesquad.app.dev
   - SHA-1 81:EA:B5:7C:24:35:63:85:D1:56:55:75:C9:04:EC:40:3B:70:23:CE
   The existing Play Maps key is restricted to a different package/signer.
   Creating or changing a key needs separate approval; none was done here.
4. Store configuration with owner-only permissions outside the repository:
   %LOCALAPPDATA%\SidelineSocial\staging-development\config.json
   The helper expects absolute firebaseFile and signingCredentialsFile paths,
   mapsKey, mapsProject, mapsPackage, mapsSha1, and mapsRestrictionsVerified.
   The last field records an actual prior restriction review; never set it
   merely to bypass a failed check. Signing credentials use the existing EAS
   credentials.json shape (android.keystore). Relative keystore paths resolve
   relative to that credentials file.

## VS Code: safe check available now

Open Terminal -> New Terminal, choose PowerShell, then run:

```powershell
Set-Location '<path-to-your-mobile-checkout>'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\scripts\staging-development.ps1' -Mode Check
```

Until private setup is complete, NOT READY is the expected result. This check
does not make network requests, build, install, or write to the phone.
The execution-policy override applies to this one PowerShell process only.

## One-time local build — only AFTER private setup and Check pass

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\scripts\staging-development.ps1' -Mode Build
```

Build mode temporarily maps the repository's parent to the first available drive
letter from `S:` through `Z:`, then uses the repository subdirectory (normally
`S:\mobile\android`). This keeps native-code paths short without placing
`package.json` at a drive root, which Expo's package search skips.
It validates and removes only the generated
`android\app\.cxx` cache before compiling, then removes the temporary drive
mapping. It does not clean source, dependencies, application data, or credentials.

For this local development context only, Android library CMake/Prefab build
directories are redirected to short, per-module directories under
`S:\mobile\android\.cxx-staging-libs` (or the selected drive). This also
shortens generated dependency paths when node_modules points to a shared physical
folder. Shared library sources and their old caches are not deleted or patched.
The generated directories are ignored by Git. Other build profiles retain their
original native build paths.

`verifyStagingDebugNativePaths` checks the configured directories before app
compilation. An offline Android Gradle Plugin fixture verified native-library
redirection, unique module directories, non-native-library preservation,
unchanged non-development paths, and rejection of a conflicting profile.
Full app compilation remains a separate user-run step.

The corrected mapping passed 44 local configuration/path assertions and the
actual Expo Android dependency-discovery command (14 dependencies, exit 0).
The temporary test mapping was removed. No APK build or installation was run
to validate this correction. Rerun your existing Build command with the same
`-PrivateConfig` path after applying this helper update.

This downloads any missing Gradle dependencies and compiles an APK locally.
It does not submit to EAS/Play or install on the phone. It uses the current
working tree, including the pending cumulative repairs; it does not commit
or discard anything. Gradle verifies the existing signing certificate and
builds only stagingDebug, currently version code 9.

Expected output: android\app\build\outputs\apk\staging\debug\app-staging-debug.apk

Before installation, independently verify the actual APK: package, SDK/native
compatibility, debuggable flag, development launcher, staging Firebase/OAuth,
signer fingerprint, and version code at least the phone's current staging
version. Then authorize an in-place update. Neither uninstall nor clearing
data is part of this workflow. No installation command is included here.

## Daily phone testing — only AFTER verified development-client installation

Connect and unlock the authorized phone, then run from the same directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\scripts\staging-development.ps1' -Mode Start
```

The helper checks for a debuggable staging app, prepares USB port 8081, and
starts the installed Expo CLI in development-client mode on IPv4 localhost.
The phone connects through the USB-only localhost tunnel.
Open Sideline Social Staging Dev, then connect to http://127.0.0.1:8081.
Keep the terminal open. Press Ctrl+C when finished.

The helper uses `deviceSerial` from the private configuration or
`ANDROID_SERIAL` when provided. Otherwise, it requires exactly one authorized
Android device to be connected. It never opens the
Play app. If the device changes, update that binding deliberately.

## Validation and limits

- 32 synthetic configuration assertions passed.
- Existing staging-acceptance configuration tests passed.
- Existing external-testing configuration and offline Gradle Google Services
  regression passed (no APK compilation or remote build).
- Targeted ESLint and JavaScript syntax checks passed.
- Real helper Check confirmed a clear stop with missing private configuration.
- Real staging signing, Maps restrictions, native APK build, and phone
  execution remain unverified. Preparation is not an install-ready artifact.
