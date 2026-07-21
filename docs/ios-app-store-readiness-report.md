# Sideline Social iOS App Store Readiness Report

Audit date: 2026-07-20  
Original readiness baseline: `main` at `7e48b423de241319461d5c0a456daa0caec696fe`; privacy re-verification baseline: `8d784e96d966d5df97f71c733b0be32f9800ecbc`
Overall status: **PARTIAL — repository work is substantially complete, but submission is blocked by owner credentials, public legal/support endpoints, deployment, and physical-device validation.**

## Release identity

| Item | Audited value | Status |
|---|---|---|
| Display name | Sideline Social | PASS |
| Marketing version | 1.0.0 | PASS |
| Initial iOS build | 1 | PASS |
| iOS bundle ID | `com.sidelinesocial.app` | PASS in config and Firebase; Apple registration pending |
| EAS project | existing `sideline-squad` / project ID preserved | PASS |
| Firebase project | `sideline-squad` | PASS for JS services |
| Android package | `com.sidelinesquad.app` | Preserved |
| Device family | iPhone only (`supportsTablet: false`) | Intentional; iPad was not validated |
| Orientation | Portrait | PASS |
| URL scheme | `sidelinesquad` | Preserved |
| Associated domains | None | Correct: no working universal-link domain was identified |

## Platform and toolchain

- Expo SDK 57.0.7, React Native 0.86.0, React 19.2.3, Expo Router 57.0.7.
- Node is pinned to 24.16.0 in `.node-version`, `.nvmrc`, and all EAS profiles. SDK 57 requires Node 22.13 or later. The Windows validation shell was still running Node 20.19.4, so local results passed on the older host runtime but a fresh terminal must activate the repository pin before release work.
- New Architecture is enabled. Hermes is enabled by the Android native configuration and is the Expo iOS default.
- iOS uses Expo continuous native generation; Android remains committed native code. This intentional hybrid layout causes the sole `expo-doctor` warning because app config fields are not synchronized automatically into the committed Android project.
- iOS minimum deployment target resolves to 16.4 through Expo SDK 57.
- Production EAS profile is store distribution, non-development-client, Node 24.16.0, production environment, and remote auto-increment. The EAS build image is intentionally automatic so Expo selects the SDK-compatible image.
- Expo Updates is not enabled; no update channel/runtime policy is required for this release.

## Android production/development separation

- Production remains `Sideline Social` with package `com.sidelinesquad.app`, the existing release build type, Google Play signing path, versionCode strategy, and an App Bundle from the EAS production profile.
- Development is `Sideline Social Dev` with package `com.sidelinesquad.app.dev`, a distinct deep-link scheme, debug signing, and an installable APK from the EAS development profile. The development profile does not auto-increment the production versionCode.
- Firebase Android app `Sideline Social Dev` was registered for `com.sidelinesquad.app.dev`. Its generated config is stored only in the ignored debug source set locally and as the secret EAS development file variable `GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT`.
- Both merged Android manifests were validated: release resolves to `com.sidelinesquad.app`; debug resolves to `com.sidelinesquad.app.dev`. No APK was installed and the existing Play test app was not touched.
- Start Metro for the development client with `npm run start:dev-client`, equivalent to `npx expo start --dev-client --scheme sidelinesquad-dev`.

## Repository changes made

- Configured iPhone-only iOS identity, build number, icon, localized permission strings, encryption declaration, and optional Firebase plist injection.
- Firebase lists an iOS app for `com.sidelinesocial.app`, but the 2026-07-20 local resolved config did not include `GOOGLE_SERVICES_INFO_PLIST`. Confirm the exact EAS file variable and final archive; a second older iOS Firebase registration also exists.
- Replaced the placeholder iOS icon with an opaque 1024×1024 Sideline Social brand icon and changed the splash image to the existing brand mark.
- Retained the installed Firebase JS SDK 10.14.1 after `expo install --check` confirmed the dependency set is aligned; no unsupported dependency upgrade was introduced.
- Added contextual notification opt-in. The root coordinator no longer prompts immediately after sign-in.
- Added iOS Expo push token registration, privacy-safe lock-screen text, Expo ticket storage, receipt checks, and invalid-token cleanup while preserving Android FCM delivery.
- Added Profile → Settings with privacy/terms/community content, support configuration, blocked-user management, and permanent account deletion.
- Added password reauthentication, two-step destructive confirmation, ownership-transfer preflight, idempotent server deletion/anonymization, push-token removal, and Authentication deletion last.
- Added iOS production configuration and release-behavior tests.

## Permissions

| Permission | Trigger | Denied path | Localization |
|---|---|---|---|
| Microphone | User taps record in a team voice composer | Text messaging remains available; Settings recovery shown after denial | English/Spanish |
| When-in-use location | User chooses nearby discovery and confirms the disclosure | Manual venue search remains available; no background location | English/Spanish |
| Notifications | User taps Enable Notifications in Settings | App remains usable; device Settings recovery after denial | In-app English/Spanish; iOS system prompt provided by Apple |

No camera, photo-library, contacts, Bluetooth, local-network, motion, HealthKit, background-location, ATT, or tracking permission is configured.

## Authentication and account deletion

- User-facing authentication is Firebase email/password only. Placeholder Google/Apple context methods are not exposed in the sign-in UI. Sign in with Apple is therefore not required solely for the current authentication offering.
- Password reset, secure password visibility, sign-in, sign-up, sign-out, and auth persistence exist.
- Account deletion removes or anonymizes Auth, private/public profiles, child profiles, memberships, notifications/tokens, friendships/requests/blocks, chats and voice files, squad administration requests, gameplay participation, rewards, activity, and historical AI request records. The 2026-07-20 audit added missing Squad-season and denormalized conversation UID cleanup locally; deploy and verify it before relying on this statement for production.
- Active sole team owners or Squad administrators must transfer responsibility or add another administrator first. Moderation reports are retained in anonymized form pending final legal retention approval.
- A disposable Auth/Firestore/Realtime Database/Functions emulator test covers cleanup, moderation/notification anonymization, season and conversation references, Auth deletion last, game-session cleanup, and the sole-owner block.
- **Deployment of the new callable and its rules/index prerequisites remains an owner-controlled production action.** Test deletion with a disposable production-like account before review.

## User-generated content and safety

- Friend chat supports message/user reporting, blocking, block enforcement, own-message removal, and now unblocking.
- Team announcements, announcement replies, and private team messages now expose authenticated reporting. Reports preserve an immutable content snapshot, reject unauthorized reporters, and de-duplicate repeat reports without exposing the moderation collection to clients.
- New team announcements, announcement replies, friend-chat messages, and private-team text/voice captions are server-screened for a narrow set of severe safety patterns before storage.
- Bundled Community Guidelines prohibit harassment, hate, threats, sexual/illegal content, spam, and privacy violations.
- Remaining operational gap: moderation staffing, response SLAs, sanctions, escalation, and support contacts need owner approval. Team-level blocking is intentionally not enabled because it could interfere with safety-critical coach/parent communication; reported content instead enters the moderation queue. Do not submit until the owner accepts the UGC plan or narrows those features.

## Privacy and security

- No ads, ATT prompt, IDFA use, third-party analytics initialization, payments, subscriptions, or in-app purchases were found.
- Firebase Auth, Firestore, Realtime Database, Storage, Functions, Expo push, location, microphone, AsyncStorage, and native maps are in scope for App Privacy.
- Existing dependency privacy manifests cover AsyncStorage, Expo application/constants/file-system/notifications/system UI, React Native, Lottie, and Maps required-reason APIs. Final merged archive inspection is still required.
- Standard TLS is the only cryptography found; `ITSAppUsesNonExemptEncryption=false` is configured.
- No service-account key, private key, provisioning profile, or Apple signing asset was found in tracked files. Existing Firebase client files contain public client configuration. A local ignored environment file exists; its values were not recorded in this report.

## Branding and content rights

- The generated iOS icon is technically valid: PNG, 1024×1024, opaque, no baked rounded corners.
- The current logo source and 42 Spot the Differences images require documented ownership/license provenance.
- Google fonts and Lucide are package-managed open-source assets; retain their license notices in the product compliance file.
- Trivia copy and animation JSON provenance must be confirmed by the owner.

## Automated validation

- `tsc --noEmit`: PASS.
- Firebase Functions TypeScript build: PASS.
- iOS release/config test: PASS.
- Local core and Firebase-emulator regression suites: PASS, including authentication/onboarding, Parent/Coach teams, child privacy, notifications, friend requests/chat, Squads, rewards/leaderboards, Weekly Challenge, Icebreakers, games, authenticated team announcements, content screening/reporting, private-team messaging, voice flows, account deletion, authorization, and rules enforcement.
- ESLint: PASS from the active checkout (with Expo's legacy-config advisory only).
- `expo install --fix`: PASS; dependencies are aligned and no package changes were required.
- `expo-doctor@latest`: 19/20. The remaining warning is the truthful hybrid-native warning caused by the committed Android project; it was not suppressed. Release and debug Android manifests were processed directly instead.
- Public Expo config expansion: PASS for iOS identity and both Android variants.
- Production JavaScript exports: PASS for iOS and Android.
- Android debug APK assembly and metadata inspection: PASS; package `com.sidelinesquad.app.dev`, label `Sideline Social Dev`. It was not installed.
- No iOS Simulator, physical iPhone, VoiceOver session, APNs credential, App Store-signed build, or network-conditioning session was available. Those areas are **not validated**.

## Production iOS build status

No EAS iOS production build was started. The matching Firebase app registration exists, but the exact production plist/EAS file variable and final archive still require confirmation. The submission gate also correctly fails while owner-approved public legal/support endpoints are absent. Apple App ID/signing access and physical-device validation remain. No build ID, URL, `.ipa`, archive checksum, Xcode version, or iOS SDK build-log evidence exists yet.

## Submission blockers

1. Register `com.sidelinesocial.app` in Apple Developer. Firebase registration and the secret EAS plist variable are complete.
2. Configure APNs credentials in EAS/Firebase/Expo and validate remote pushes on a physical iPhone.
3. Publish legally approved HTTPS Privacy Policy, Terms, and Support pages; set the four documented production variables.
4. Approve privacy retention, child-data language, UGC moderation operations, and content rights.
5. Deploy Cloud Functions and required Firestore indexes/rules; run the disposable-account deletion test.
6. Create privacy-safe reviewer accounts/data, App Store screenshots, App Privacy answers, and age rating.
7. Complete iPhone/VoiceOver/device testing and generate/inspect the signed `.ipa`.
8. Enter agreements, tax/banking, app record, credentials, and metadata in App Store Connect.

## Release decision

The codebase should not be described as App Store ready yet. It is ready for final integration, signed-build, and device-validation work once the owner-supplied items above are available.
