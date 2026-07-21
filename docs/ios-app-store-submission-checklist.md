# iOS App Store Submission Checklist

Legend: `[x]` repository-verified, `[ ]` required external/manual action, `[~]` implemented but awaiting deployment/device verification.

## Apple and Firebase identity

- [ ] Create/verify the App Store Connect app record for Sideline Social.
- [ ] Register App ID `com.sidelinesocial.app` in the correct Apple Developer team.
- [ ] Confirm no pre-existing App Store record requires iPad support.
- [x] Add an iOS app with bundle ID `com.sidelinesocial.app` to Firebase project `sideline-squad`.
- [~] Firebase iOS registration exists; re-download/verify the exact `GoogleService-Info.plist` because the project contains two iOS registrations.
- [ ] Confirm it is stored as the EAS **file** environment variable `GOOGLE_SERVICES_INFO_PLIST` and embedded in the final archive; do not commit it.
- [x] Existing Android package and Google services file remain unchanged.

## Build configuration

- [x] Name Sideline Social, version 1.0.0, initial build 1.
- [x] iPhone only, portrait, bundle ID and scheme configured.
- [x] Node 24.16.0 configured; EAS build image left automatic so Expo selects the SDK-compatible image.
- [x] Production profile uses store distribution and no development client.
- [x] Export compliance flag configured for standard exempt encryption.
- [x] 1024×1024 opaque iOS icon and branded splash configured.
- [ ] Confirm final EAS log used Xcode 26.4+ and iOS 26 SDK+.
- [ ] Inspect final archive/IPA entitlements, deployment target, privacy manifests, URL schemes, icons, permission strings, and device family.

## Services and credentials

- [ ] Configure Apple distribution certificate and App Store provisioning profile in EAS.
- [ ] Configure APNs key/certificate for the project.
- [~] iOS push token/ticket/receipt implementation compiled and deployed endpoint names exist; confirm exact deployed revision.
- [ ] Send production-like remote pushes to a physical iPhone; validate foreground/background/terminated open routes.
- [ ] Verify invalid token and Expo receipt cleanup in production logs without logging raw tokens.
- [ ] Compare deployed revisions for `deleteOwnAccount`, `unblockFriendChatUser`, `reportTeamContent`, `createTeamAnnouncement`, and `cleanupExpoPushReceipts`; deploy reviewed differences only.
- [ ] Deploy any changed rules/indexes needed by the release and confirm no missing-index errors.

## Privacy, legal, and safety

- [ ] Publish legally approved public HTTPS Privacy Policy.
- [ ] Publish public HTTPS Terms of Use.
- [ ] Publish public HTTPS Support page and a monitored support email.
- [ ] Set `EXPO_PUBLIC_PRIVACY_POLICY_URL`, `EXPO_PUBLIC_TERMS_OF_USE_URL`, `EXPO_PUBLIC_SUPPORT_URL`, and `EXPO_PUBLIC_SUPPORT_EMAIL` in EAS production.
- [ ] Run `APP_STORE_SUBMISSION_READY=true npm run validate:ios` with the production values.
- [ ] Approve App Privacy answers against the data inventory.
- [ ] Approve child-data, retention/deletion, moderation, and law-enforcement escalation language.
- [ ] Establish moderation staffing, response targets, sanctions, and appeals.
- [ ] Confirm rights/licenses for logo, game imagery, trivia, fonts, icons, and animations.

## Functional tests

- [x] Static TypeScript and Cloud Functions build.
- [x] Local config, auth, game, team, chat, notification, Squad, and privacy regression tests.
- [~] Disposable emulator deletion test exists; rerun it for the 2026-07-20 season/conversation cleanup before release.
- [ ] Fresh install → sign up → onboarding → parent/coach mode switching.
- [ ] Email verification behavior decision and test; it is not currently enforced.
- [ ] Password reset, sign-in/out, and denied permission paths.
- [ ] Account deletion with a normal account and a sole-owner blocked account.
- [ ] Reinstall after deletion and verify no recoverable account data remains.
- [ ] Test small and large supported iPhones, keyboard, dark/light mode, Dynamic Type, reduced motion, and VoiceOver.
- [ ] Test offline/slow network/background/termination and memory-pressure recovery.
- [ ] Test Bomb Defusal, Trivia randomization, multiplayer join, and every Spot the Differences scene on device.
- [ ] Verify maps, manual fallback, voice record/playback, and push routing on physical hardware.

## App Store Connect

- [ ] Complete agreements, tax, banking, users/roles, and Paid Apps agreement if applicable.
- [ ] Enter English and Spanish metadata; replace every bracketed placeholder.
- [ ] Upload privacy-safe iPhone screenshot set; no iPad set for this configuration.
- [ ] Complete current age-rating questionnaire and select not Made for Kids.
- [ ] Complete App Privacy questionnaire and publish Privacy Policy URL.
- [ ] Provide review contact, demo account(s), exact navigation notes, and any test team codes.
- [ ] Confirm content-rights declaration.
- [ ] Upload the build to App Store Connect only after this checklist is closed.
- [ ] Use TestFlight internal testing, then external testing if desired.
- [ ] Select the final build and submit manually; no automated submission is authorized.
