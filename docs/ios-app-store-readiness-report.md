# Sideline Social iOS App Store Readiness Report

Audit date: 2026-07-29
Repository: `C:\Dev\Sideline_Social_Code`
Baseline: `main` at `1d181c7` (`Migrate Cloud Functions to Node.js 22`)
Audited product: Sideline Social 1.0.0, iPhone
Audited EAS project: `@paciencia1990/sideline-squad` (`7ea7aaf2-355d-4aec-a175-82898c8cc0c7`)
Audited Firebase project: `sideline-squad`

## 1. Executive verdict

**NOT READY**

Do not start the production iOS App Store build yet.

The Expo/iOS toolchain is capable of producing an Apple-acceptable iOS 26 SDK binary, the production legal URLs are live, and the automated source/export checks are strong. The original anonymous-game privacy blocker has been resolved in the working tree: released game routes now require a permanent Sideline Social account, anonymous Firebase identities are rejected at every client/rules/callable boundary, and Squad discovery no longer returns raw identity-bearing documents.

The next stage remains blocked by one separate P0 issue:

1. The app accepts user reports but the repository contains no actual operator workflow that reads, triages, resolves, removes, or escalates reported content. Apple Guideline 1.2 requires reporting **and timely responses**, blocking, filtering, published contact information, and actual removal of violating content.

Additional P1 issues include incomplete server-side block enforcement in existing group chats, brute-forceable/non-expiring team invite codes, incomplete server-side deletion assurance, unresolved adult/minor and Terms-assent decisions, absent reviewer credentials/sample data, and required archive/device/App Store Connect work.

This verdict is not a prediction or guarantee about Apple review. It is an evidence-based release gate.

### What is already release-capable

- Expo SDK 57.0.7 and React Native 0.86 target iOS 16.4+ and use the SDK 57 EAS image with Xcode 26.6/iOS 26 SDK.
- Apple requires iOS uploads to use the iOS 26 SDK or later beginning April 2026. The automatic SDK 57 EAS image meets that build-tool requirement.
- Production EAS environment selection is explicit.
- The production bundle ID, EAS project, Firebase project, and verified Firebase iOS registration align.
- The iOS icon is an opaque 1024×1024 PNG.
- Privacy, Terms, Support, and support email are public, mobile-usable, and present in the app.
- Email/password is the only primary user-facing login, so Guideline 4.8 does not independently require Sign in with Apple.
- No payments, subscriptions, donation links, external digital unlocks, advertising, analytics SDK, IDFA use, or cross-app tracking implementation was found.
- Narrow test/placeholder, localization, light-appearance, recovery, accessibility, and Firebase-ID fixes made during this audit pass TypeScript and ESLint.

## 2. Authoritative requirements consulted

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple App Store Connect Help](https://developer.apple.com/help/app-store-connect/)
- [Apple iOS 26 SDK upload requirement](https://developer.apple.com/news/?id=6lxhtioi)
- [Apple privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
- [Apple required-reason APIs](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)
- [Apple third-party SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/)
- [Apple App Privacy management](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
- [Apple age-rating configuration](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating)
- [Apple in-app account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance)
- [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Expo SDK compatibility table](https://docs.expo.dev/versions/latest/)
- [Expo EAS build infrastructure](https://docs.expo.dev/build-reference/infrastructure/)
- [Expo iOS build process](https://docs.expo.dev/build-reference/ios-builds/)
- [Expo production iOS build guide](https://docs.expo.dev/tutorial/eas/ios-production-build/)
- [Expo submission guide](https://docs.expo.dev/deploy/submit-to-app-stores/)
- [Firebase Apple-platform privacy disclosures](https://firebase.google.com/docs/ios/app-store-data-collection)
- [Firebase Authentication user lifecycle](https://firebase.google.com/docs/auth/web/manage-users)
- [Firebase callable Functions](https://firebase.google.com/docs/functions/callable)
- [Firebase App Check for Functions](https://firebase.google.com/docs/app-check/cloud-functions)
- [Firestore Security Rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions)
- [Realtime Database Security Rules](https://firebase.google.com/docs/database/security)
- [Cloud Storage Security Rules](https://firebase.google.com/docs/storage/security)

## 3. Release identity and build configuration

| Item | Verified value | Evidence/status |
|---|---|---|
| App name | Sideline Social | `app.config.js`; verified |
| Marketing version | 1.0.0 | `app.config.js`; verified |
| Local iOS build seed | 1 | `app.config.js`; verified |
| EAS version source | Remote | `eas.json`; no remote iOS version has been initialized yet |
| Auto increment | Enabled | `eas.json` production profile |
| Bundle ID | `com.sidelinesocial.app` | Expo config and Firebase iOS app agree |
| EAS owner/project | `paciencia1990` / `sideline-squad` | Read-only EAS identity/project check |
| Firebase project | `sideline-squad` | `.firebaserc`, runtime config, live project check |
| Functions region/runtime | `us-central1`, Node.js 22 | client config, `firebase.json`, and read-only deployed-function listing |
| Expo / RN | Expo 57.0.7 / React Native 0.86.0 | `package.json`, lockfile |
| Minimum iOS | 16.4 | Expo SDK 57 compatibility |
| Build image | automatic SDK 57 image | currently resolves to `macos-tahoe-26.5-xcode-26.6` |
| Xcode / SDK | Xcode 26.6 / iOS 26 SDK | Expo infrastructure documentation |
| CocoaPods | 1.16.2 | Expo SDK 57 build image |
| Production Node | 24.16.0 | `eas.json`; within repository engine range |
| Device family | iPhone only | `supportsTablet: false` |
| Orientation | Portrait | `orientation: "portrait"` |
| Appearance | Light | made explicit during audit; fixed light palette/status bar |
| URL scheme | `sidelinesquad` | production Expo config |
| Universal links | None | no associated domains configured |
| OTA updates | Not configured | `expo-updates` is not a dependency/configured channel |

Apple’s April 2026 rule requires iOS uploads to use the iOS 26 SDK or later. Expo lists SDK 57 as iOS 16.4+/Xcode 26.4+, and the current `sdk-57` EAS image uses Xcode 26.6. The current build-image choice is therefore technically appropriate.

`eas build:version:get` reports that no remote iOS version is configured. The first production build should seed remote versioning from the local build value and auto-increment thereafter, but verify the resulting `CFBundleVersion` in the first archive before upload.

The EAS production environment contains project-scoped public/plaintext values for:

- `EXPO_PUBLIC_PRIVACY_POLICY_URL=https://www.joinsidelinesocial.com/privacy`
- `EXPO_PUBLIC_TERMS_OF_USE_URL=https://www.joinsidelinesocial.com/terms`
- `EXPO_PUBLIC_SUPPORT_URL=https://www.joinsidelinesocial.com/support`

It also lists project-scoped file secret `GOOGLE_SERVICES_INFO_PLIST`. No duplicate account-scoped legal variables were found. Secret contents were not printed or retrieved.

## 4. Findings

### P0-1 — Anonymous-auth privacy bypass exposed raw Squad/member/location data

- **Requirement:** Apple Guidelines 1.6 and 5.1 require appropriate security and prevention of unauthorized access to personal data. Firebase rules must enforce least privilege.
- **Original attack path:** `getCurrentPlayer()` called `signInAnonymously()` when no account was present. The resulting Firebase token satisfied the old `signedIn() == request.auth != null` helper. That identity could list every raw `/squads/{squadId}` document, read `memberIds`, creator identifiers, venue geohashes and coordinates, then pass the harvested UIDs to the Admin-backed public-profile callable (or read individual public-profile projections) to resolve real names.
- **Selected model:** Permanent-account-only gameplay. This is not a product-level removal of a released guest flow: both game route groups were already behind `AuthenticatedRouteGate`, the Games tab is account-gated, and JOIN-code players are existing Sideline Social users. The anonymous Trivia sign-in was orphaned legacy fallback code, not an intentional accountless participation experience.
- **Remediation:**
  - `utils/authIdentity.ts` centralizes unauthenticated, anonymous, and permanent client identity plus host/participant authority.
  - `AuthenticatedRouteGate` requires a permanent Firebase user, while `AuthContext` signs out stale anonymous state before any profile hydration.
  - `functions/src/permanentAuth.ts` checks the verified callable token provider and wraps every callable module. Anonymous callers receive `permission-denied`; signed-out callers receive `unauthenticated`.
  - Firestore and Storage `signedIn()` helpers exclude `firebase.sign_in_provider == "anonymous"`. RTDB additionally excludes anonymous provider tokens and permits reads only to active, unexpired permanent participants; all game writes remain server-only.
  - Raw Squad collection listing is denied. Direct raw Squad reads require durable active membership. Search/nearby/detail callables return explicit projections, never spread full documents, and nonmember detail returns no member identities. Member roster previews are name-only and are returned only after canonical membership authorization.
  - Trivia creation, join, ready, start, answer, advance, reset, end, scoring, timing, answer reveal and rematch are server-authoritative. Question answers live only in `triviaGameSecrets`; idempotent submissions and per-account create/answer throttles are server-side.
  - JOIN-code lookup, participation, ready state, lifecycle, Spot difference recording and Bomb steps are server-controlled. Future Bomb steps live in RTDB `gameSessionSecrets`, which has no client read path.
- **After boundary:** Anonymous identities can access no game, Squad, membership, profile, user, friend, block, report, conversation, notification, child, team, location, search, Storage, or cross-session data. They cannot join a JOIN-code game. A second permanent account can join only through a valid active code and then read only its active session. General Squad search exposes venue/sport/count/activity fields; precise venue coordinates appear only in the separately authorized nearby-discovery response, never to anonymous callers.
- **Cleanup:** No anonymous-to-permanent conversion is supported. Any stale local anonymous session is signed out and local signed-in state is cleared. Trivia and RTDB sessions enforce two-hour hard expiries; terminal result reads are limited to five minutes, after which rules deny access and scheduled cleanup removes expired sessions, private question/step secrets, idempotency records and stale rate limits. Account deletion removes or transfers the caller's game participation and deletes hosted secrets.
- **Verification:** Provider-aware client and source-boundary tests, Firestore/RTDB/Storage rules suites, real Auth/Firestore/RTDB/Functions emulator identities, full Trivia lifecycle, JOIN-code/Bomb/Spot suites, account deletion, and safe Squad projection tests exercise the new boundary. Fresh local JavaScript exports generated with the EAS production environment contain no private Trivia-answer markers.
- **Status:** **RESOLVED IN WORKING TREE.** Deployment and physical-device/TestFlight verification are still required before release.

### P0-2 — Reports have no implemented operational moderation workflow

- **Requirement:** Apple Guideline 1.2 requires filtering, reporting, timely responses, blocking, published contact information, and removal of violating content.
- **Evidence:**
  - Team/content reports are written as open records: `functions/src/contentModeration.ts:15-107`.
  - Friend message/user reports are accepted: `functions/src/friendChat.ts:670-702`.
  - Client rules correctly deny access to moderation reports: `firestore.rules:439-445`.
  - Repository-wide collection/reference review found creators but no privileged queue reader, triage/resolution callable, moderation console, removal workflow, sanction workflow, escalation, or appeal workflow.
  - `docs/ugc-moderation-and-support-plan.md:18-37` and `docs/cross-platform-privacy-data-inventory.md:96-102` identify staffing, SLA, sanctions, appeals, CSAM escalation, and deployed parity as unverified.
- **User impact:** A user can submit a report but there is no demonstrated mechanism for anyone to respond or remove harmful content.
- **App Review risk:** Direct Guideline 1.2 failure.
- **Required fix/decision:** The owner must establish a real workflow. It may be an external secured operator process, but it must demonstrably ingest reports, preserve minimum evidence, authorize staff, resolve reports, remove content, restrict accounts, handle urgent safety escalation, and meet a documented response target. Do not expose the moderation collection to clients.
- **Verification required:** Use a benign test report from parent and coach/staff experiences; show it arriving in the secured queue; resolve it; remove content/restrict the actor; verify audit history and user-facing follow-up.
- **Verification performed:** Static repository-wide workflow/reference audit.
- **Status:** **OPEN — release blocker.** No operational or legal policy was invented during this audit.

### P1-1 — Blocks are not enforced server-side in existing group conversations

- **Requirement:** Guideline 1.2 requires the ability to block abusive users from the service; backend authorization must not rely on stale client filtering.
- **Evidence:**
  - `sendFriendChatMessage` checks block documents only for direct conversations: `functions/src/friendChat.ts:532-590`, especially `:565-578`.
  - Group messages remain visible to all active participant IDs: `functions/src/friendChat.ts:579-584`.
  - `blockFriendChatUser` cancels friendship/requests but does not resolve shared group membership: `functions/src/friendChat.ts:617-652`.
  - Invitation acceptance does not re-check blocks: `functions/src/friendChat.ts:296-328`.
  - Client filtering uses a loaded snapshot of blocked IDs: `services/chatService.ts:277-297,318-356`.
- **User impact:** Blocked people may continue exchanging content through a shared group, and a stale invite can be accepted after blocking.
- **App Review risk:** Likely Guideline 1.2 failure if exercised by the reviewer.
- **Required fix/decision:** Define owner-approved shared-group semantics, then enforce them transactionally on invitation acceptance, message writes, push fanout, and reads. Safety-critical team communications may need a separate, clearly documented policy from optional friend groups.
- **Verification required:** Emulator tests for block-before-invite-acceptance, block-after-group-creation, group send/read/push after block, unblock, and membership changes.
- **Verification performed:** Static callable/rules/client trace; existing emulator coverage reviewed.
- **Status:** **OPEN.**

### P1-2 — Team invitation codes and broad account creation are abuse-prone

- **Requirement:** Apple 1.6/5.1 security; Firebase least privilege and abuse prevention.
- **Evidence:**
  - Initial six-character invite generation uses client `Math.random()` and has no demonstrated uniqueness or expiry: `services/teamService.ts:228-253,429-434`.
  - Join validation now rejects anonymous callers at the shared callable boundary, but still has no invite expiry, App Check, verified-email gate or durable attempt limit: `functions/src/index.ts`.
  - Profile/child/team rules now require a permanent account, but account creation is broad and team creation remains client-side for any permanent account.
  - App Check is neither initialized in `config/firebase.ts` nor enforced by callable options.
- **User impact:** Code guessing and account churn can expose/join team contexts or create spam.
- **App Review risk:** Serious production safety defect in a youth-sports product.
- **Required fix/decision:** Move team creation/invite issuance to a callable; use cryptographic unique, expiring, revocable codes; rate-limit by durable account/device/network signals; preserve the new anonymous denial; decide verified-email/adult gates; stage App Check metrics before enforcement.
- **Verification required:** Emulator concurrency, collision, expiry, revocation, throttling, anonymous/unverified denial, and valid role tests.
- **Verification performed:** Static generation/callable/rules trace.
- **Status:** **OPEN.**

### P1-3 — Account deletion lacks server-side recent-auth assurance and leaves identifier-bearing records

- **Requirement:** Apple requires accessible in-app account deletion and deletion of the account and associated personal data unless retention is legitimately required and disclosed.
- **Evidence:**
  - Client password reauthentication exists: `services/accountService.ts:13-20`.
  - The server trusts any valid callable Auth token and does not enforce token `auth_time`: `functions/src/accountDeletion.ts:29-43`.
  - Auth deletion occurs last, which is a positive retry property: `functions/src/accountDeletion.ts:112-116`.
  - Cleanup omits `publicUserSearchRateLimits`, `teamMessageRateLimits`, and short-lived `teamVoicePlaybackGrants`, whose document IDs/fields contain user identifiers: `functions/src/index.ts:3400-3422,3696-3743,2902-2911`.
  - Inactive archived owner records can retain `createdBy` when no successor exists because blocker checks skip inactive records and reassignment occurs only when a successor is found: `functions/src/accountDeletion.ts:119-145,223-283`.
  - Retained moderation records have no owner-approved retention period: `functions/src/accountDeletion.ts:21-27`.
- **User impact:** A stolen but still-valid token could trigger irreversible deletion, and deleted-user identifiers may survive.
- **App Review risk:** Privacy disclosure/deletion failure.
- **Required fix/decision:** Enforce recent auth server-side; inventory and remove/anonymize all UID-bearing residuals; define retention periods and legal basis; specify archived-owner anonymization; keep Auth deletion last and operations idempotent.
- **Verification required:** Emulator tests for stale/recent `auth_time`, residual collections, inactive owner without successor, partial retry, Auth deletion last, Storage/RTDB cleanup, local cache/token removal.
- **Verification performed:** Client/callable/data-set trace and existing emulator-test review.
- **Status:** **OPEN.**

### P1-4 — Intended audience, youth-data boundaries, and binding assent are unresolved

- **Requirement:** Accurate age rating/metadata, children’s privacy handling, Guideline 5.1, and owner/legal approval.
- **Evidence:**
  - Draft metadata positions the product for adult parents/coaches and outside Kids Category: `docs/app-store-connect-metadata.md:21-27`; `docs/apple-age-rating-guidance.md:5-19`.
  - Signup has no age/adult attestation, email verification, Terms acceptance, or Community Guidelines assent: `app/(auth)/sign-up.tsx:17-79`; `context/AuthContext.tsx:184-221`.
  - Adults can create child display-name profiles: `components/ChildProfilePicker.tsx:60-76,158-183`.
  - Child names, team participation, schedules, venue context, messages, and voice content exist in data flows.
- **User impact:** Eligibility and consent boundaries are ambiguous; a minor can create a full social account.
- **App Review risk:** Incorrect age rating, metadata, or privacy presentation; legal exposure.
- **Required decision:** Owner and qualified counsel must confirm adult-only eligibility wording, minimum age, attestation/verification, parent authorization for child data, Terms/Guidelines assent capture, retention, and “not Made for Kids.” Do not select Kids Category casually; that choice carries ongoing requirements.
- **Verification required:** Fresh-account tests for the approved eligibility/assent flow and App Store metadata review.
- **Verification performed:** Signup, profile, metadata, legal, and data-flow review.
- **Status:** **OPEN — owner/legal decision required.**

### P1-5 — App Review access and stable sample data are not prepared

- **Requirement:** Guideline 2.1 and Apple’s submission checklist require full reviewer access, demo credentials/resources, and live backend availability.
- **Evidence:**
  - Protected routes require authentication: `components/AuthenticatedRouteGate.tsx:9-28`.
  - Review-account/team/code fields remain placeholders: `docs/apple-app-review-notes.md:3-12`; `docs/app-store-connect-metadata.md:52-58`.
  - No production iOS EAS build exists.
- **User impact:** Apple cannot reliably test parent, coach/staff, multiplayer, reporting, blocking, and deletion.
- **App Review risk:** Likely completeness rejection.
- **Required action:** Create stable fictional parent and coach/staff accounts, a second game player, active fictional team/Squad, valid JOIN code, prepared chat/friend/report data, and a separate disposable deletion account. Store credentials only in App Store Connect.
- **Verification required:** Dry-run the review notes with a person who did not build the app, from a clean TestFlight install.
- **Verification performed:** Route and submission-document audit; no production data was created.
- **Status:** **OPEN — manual.**

### P1-6 — Spanish gameplay was incomplete

- **Requirement:** Metadata and localized experiences must be accurate and complete.
- **Remediation:** Games-tab selection/JOIN flow, shared lobby/countdown, Trivia, Bomb Defusal, Spot the Difference, Icebreaker prompts, timers, scores, results, rematch/leave controls, loading/empty/error/retry states, and game accessibility labels now use matching English and neutral-Spanish resources. Trivia's 60-question server bank contains parallel English/Spanish questions and answer options; player names and JOIN codes remain untranslated.
- **Automated coverage:** `scripts/test-game-localization.cjs` validates seven game namespaces, all 60 Trivia records, all 80 Icebreaker prompts, interpolation/plural variables, and 13 released game UI files for avoidable hard-coded English. Existing translation-tree parity tests remain green.
- **Remaining verification:** A Spanish physical iPhone must still be used for text growth, VoiceOver, error paths and full two-player play; this environment had no device.
- **Status:** **RESOLVED IN WORKING TREE / DEVICE CHECK PENDING.**

### P1-7 — Signed archive, privacy report, entitlements, and device behavior are unverified

- **Requirement:** Privacy manifests/signatures, required-reason declarations, correct entitlements, device stability, and upload processing must be verified on the actual archive.
- **Evidence:**
  - This audit intentionally did not consume an EAS build allowance and the repository has no tracked `ios/` directory.
  - Read-only Expo introspection resolved the production bundle/config, secure ATS settings, foreground-location/microphone strings, and expected notification entitlement input.
  - Introspection also contains development-time APNs/local-network values. `expo-dev-launcher` includes a non-Debug build phase that removes its Bonjour/local-network keys, and the EAS production profile has `developmentClient: false`, but only the built archive can prove the final result.
  - A temporary `expo prebuild --platform ios --no-install` attempt was non-destructive but could not generate iOS on Windows; Expo reported that iOS generation must run on macOS or Linux.
  - No local inspection can prove signing, final pod selection, merged privacy report, APNs production entitlement, dSYM, or App Store processing.
- **User impact:** Native-only failures may remain invisible to JS/source tests.
- **App Review risk:** Upload rejection or runtime failure.
- **Required action:** After P0/P1 design fixes, create one production TestFlight build; download/inspect the archive or build artifact; validate `PrivacyInfo.xcprivacy`, required-reason categories, SDK signatures, entitlements, Info.plist, architectures, icon, dSYM, bundle/version, and launch on real iPhones.
- **Verification performed:** EAS profile/config resolution, read-only Expo introspection, non-destructive prebuild attempt, dependency-manifest parsing, and production iOS JS export; no signed archive.
- **Status:** **OPEN — required before submission, but not itself a reason to redesign source.**

### P1-8 — Accessibility cannot yet be claimed across common tasks

- **Requirement:** Apple accessibility labels must be accurate if selected; important common tasks should support VoiceOver, Larger Text, contrast, and Reduced Motion.
- **Evidence:**
  - Spot the Difference depends on visual pinch/pan/tap coordinates without a VoiceOver-equivalent interaction: `src/game/spotDifference/SpotDifferenceScreen.tsx:613-765,815-823`.
  - No Reduce Motion preference is read for splash/countdown/game animations: `app/splash.tsx:10-32`; `components/CountdownOverlay.tsx:56-91`; `src/game/BombDefusalScreen.tsx:123,344-348`.
  - Static contrast calculations: primary red on cream 4.21:1, accent gold on cream 1.81:1, accent green on cream 2.61:1. Meaningful accent text appears in `app/leaderboard.tsx:460,487`, `components/GameRewardSummary.tsx:75`, and `components/ChildProfilePicker.tsx:213`.
- **User impact:** VoiceOver, low-vision, and motion-sensitive users may be unable to complete key tasks.
- **App Review risk:** Accessibility-quality risk and inaccurate Accessibility Nutrition Labels if claimed.
- **Fix/decision:** Provide a non-coordinate VoiceOver alternative for the visual game or document that common tasks exclude it; darken semantic text colors; honor Reduce Motion; run manual accessibility evaluation before selecting any App Store labels.
- **Verification performed:** Static roles/labels/contrast/motion audit. Shared buttons, auth back controls, and settings navigation were improved during this audit.
- **Status:** **OPEN.**

### P1-9 — App Store assets and console declarations are incomplete

- **Requirement:** Complete, accurate metadata, screenshots, privacy answers, age rating, review info, and legal/export declarations.
- **Evidence:** A screenshot plan exists, but no final screenshot set was found. App Store Connect cannot be inspected from the repository. Metadata/review docs retain placeholders.
- **User impact:** No runtime impact; submission cannot be completed accurately.
- **App Review risk:** Submission block or inaccurate metadata rejection.
- **Required action:** Complete the manual checklist in section 14 after P0/P1 fixes and TestFlight validation.
- **Verification performed:** Repository metadata/assets inventory.
- **Status:** **OPEN — manual.**

### P1-10 — Report evidence and voice-content handling are incomplete

- **Requirement:** Practical moderation and data minimization under Guidelines 1.2/5.1.
- **Evidence:**
  - Team text reports preserve bounded snapshots, but voice report snapshots include caption/title/body and not the actual audio: `functions/src/contentModeration.ts:37-69`.
  - Friend message/user reports use random IDs with no demonstrated deduplication or rate limit and no immutable content snapshot: `functions/src/friendChat.ts:670-702`.
  - Removing a friend message blanks its text: `functions/src/friendChat.ts:595-614`, which can destroy evidence after a report.
- **User impact:** Moderators may be unable to review the reported behavior; reporting itself can be abused.
- **App Review risk:** Weakens the already-missing moderation workflow.
- **Required decision/fix:** With counsel-approved retention, preserve the minimum immutable evidence required to investigate, deduplicate/rate-limit reports, reject self-report abuse, and handle voice evidence securely.
- **Verification performed:** Static report/removal flow audit.
- **Status:** **OPEN.**

### P2-1 — App Check and durable abuse limits are absent or incomplete

- **Requirement:** Apple 1.6/5.1 security and Firebase abuse-defense guidance.
- **Evidence:** No `initializeAppCheck`, App Attest/DeviceCheck provider, `enforceAppCheck`, or token consumption was found. Game creation, JOIN-code lookup and Trivia answers now have durable permanent-account limits, and anonymous UID churn is excluded from every callable. Friend requests, profile batch lookup, suggested connections, group actions, reports, and team joins still have incomplete abuse controls.
- **User impact:** Automated spam, enumeration, and cost amplification.
- **App Review risk:** Important defense-in-depth gap; not automatically a rejection by itself. The P0-1 data-access path is closed independently and does not rely on App Check.
- **Fix:** Roll out App Check metrics, fix legitimate clients, then enforce; add durable per-account/device/network throttles. Do not switch enforcement on blindly.
- **Verification performed:** Client/callable configuration and rate-limit inventory.
- **Status:** **OPEN.**

### P2-2 — Arbitrary profile photo URLs and narrow content filtering create content/privacy risk

- **Requirement:** Apple 1.2 filtering/moderation and 5.1 data minimization/security.
- **Evidence:** Authenticated users can store an arbitrary HTTPS `photoURL` up to 2048 characters: `functions/src/index.ts:3562-3607`; screens load it directly. The severe-content filter is four regular-expression groups and does not cover group/profile/team/Squad names or audio: `functions/src/contentSafety.ts:3-24`.
- **User impact:** Mutable/offensive remote content and third-party request metadata leakage.
- **App Review risk:** Objectionable content can bypass the current filter and profile-image hosting is not controlled.
- **Fix:** Restrict images to controlled Storage/domain and moderation, or disable profile photos until supported; apply safety policy consistently without presenting the filter as complete moderation.
- **Verification performed:** Profile update, rendering, and content-safety coverage trace.
- **Status:** **OPEN.**

### P2-3 — Production logging remains broader than documented

- **Requirement:** Apple 5.1 privacy disclosure/minimization and secure operational logging.
- **Evidence:** Approximately 125 console calls remain in production source. Several log raw errors/stacks, including `components/ErrorBoundary.tsx:25-28`, `services/gameService.ts:69-224`, `services/teamService.ts:365-379`, and several screen load failures. Functions friend wrappers log raw UID/message/stack at `functions/src/index.ts:991-1015`.
- **User impact:** Paths, UIDs, or provider context can enter device or Cloud logs. This conflicts with the documented hashed/minimal logging posture.
- **App Review risk:** Privacy-policy/App Privacy answers may be inaccurate and sensitive data may be retained unexpectedly.
- **Fix:** Centralize a production-safe logger, emit operation plus normalized code, gate raw errors/stacks behind `__DEV__`, pseudonymize server UIDs, and approve Cloud Logging access/retention.
- **Verification performed:** Repository-wide console call scan and representative error-object review.
- **Status:** **PARTIALLY FIXED.** Raw auth-screen error logging was gated during this audit; broader cleanup remains.

### P2-4 — Privacy/retention documentation is stale or contradictory

- **Requirement:** Apple 2.3 accurate metadata and 5.1.1 accurate privacy/retention disclosure.
- **Evidence:** `docs/cross-platform-privacy-data-inventory.md` describes first-name/last-initial discovery while code returns full surnames. Older release docs still call configured legal URLs and Node 22 migration blockers.
- **User impact:** Users may receive an inaccurate description of what is discoverable or retained.
- **App Review risk:** Incorrect privacy labels, policy, or review notes.
- **Fix:** Reconcile the public privacy policy, data inventory, live implementation, Cloud/vendor retention, deletion residuals, and App Store Privacy answers with owner/counsel.
- **Verification performed:** Code-to-document comparison and live legal-page review.
- **Status:** **OPEN.**

### P2-5 — Firebase iOS config delivery needs final archive confirmation

- **Requirement:** Correct bundle/service configuration and production-only credentials.
- **Evidence:**
  - Verified Firebase iOS app: `com.sidelinesocial.app`, app ID `1:903830626771:ios:548f99d119be8948dfcf26`.
  - The ignored local `GoogleService-Info.ios.plist` matches that registration.
  - EAS lists a project-scoped production file secret named `GOOGLE_SERVICES_INFO_PLIST`, but secret contents cannot be read through `env:exec`.
  - A tracked legacy `GoogleService-Info.plist` targets `com.sidelinesquad.app` and is not referenced by current iOS config.
- **User impact:** A wrong EAS file could misconfigure native services or push/attribution to the wrong registration.
- **App Review risk:** Runtime service failure or inconsistent bundle identity.
- **Fix:** Inspect the materialized file during the first EAS build and archive. Remove or clearly archive the tracked legacy file in a separate cleanup once Android/old-iOS history is confirmed.
- **Verification performed:** Firebase app listing, local ignored plist check, EAS variable-name/scope check, and source config review. Secret value was not exposed.
- **Status:** **PARTIALLY VERIFIED.** The JS Firebase iOS `appId` was corrected during this audit.

### P2-6 — EAS remote version is not initialized

- **Requirement:** Unique monotonically valid `CFBundleVersion` and accurate App Store version selection.
- **Evidence:** Read-only `build:version:get` returned “No remote versions are configured for this project.”
- **User impact:** None until release.
- **App Review risk:** Upload/selection conflict if an external build already exists.
- **Fix:** Confirm no App Store Connect build exists, then allow the first production build to seed from local build 1. Verify the processed build number.
- **Verification performed:** Read-only EAS remote-version query.
- **Status:** **MANUAL CONFIRMATION REQUIRED.**

### P2-7 — Public legal links now recover from failures, but policy accuracy still needs owner/legal confirmation

- **Requirement:** Apple 1.5 contact, 5.1.1 accessible privacy policy, and accurate disclosure.
- **Evidence:** Privacy, Terms, and Support pages are HTTPS, public, mobile-responsive, and linked in `app/settings/legal.tsx`. In-app account deletion and support email are discoverable.
- **User impact:** Links work; substantive accuracy is still tied to unresolved data flows/retention.
- **App Review risk:** Technical link risk is resolved; disclosure risk remains.
- **Fix/decision:** Reconcile policy substance after the owner/legal decisions in P0/P1; retain the current URL/error handling.
- **Verification performed:** Browser/mobile viewport review, EAS production legal validation, and source tests.
- **Status:** **TECHNICALLY VERIFIED / LEGAL CONFIRMATION REQUIRED.**

### P2-8 — Expo dependency alignment and transitive advisories need a reviewed update

- **Requirement:** Use a supported, reproducible SDK dependency set and review known dependency vulnerabilities before release.
- **Evidence:**
  - Clean root and Functions `npm ci` installs pass with the committed lockfiles and root `.npmrc`.
  - Current `expo install --check` recommends 11 Expo patch releases and `react-native-screens` 4.26.0 instead of 4.25.2.
  - Expo Doctor passes 18 of 20 checks. Its other warning is the mixed native/CNG layout: tracked `android/` with generated iOS configuration. iOS remains generated because no `ios/` directory exists, but the first EAS job must prove the result.
  - Root production-dependency audit reports 13 transitive advisories (one high in Expo CLI/config build tooling and 12 moderate, including `protobufjs` and `uuid`). Functions reports nine moderate transitive `uuid` advisories through Firebase/Google packages.
  - npm’s force suggestions include breaking or inappropriate version changes; no automatic fix was applied.
- **User impact:** Patch-level SDK drift can hide fixed native defects; the reported advisory paths are primarily build tooling or code paths not shown to be reachable with attacker-controlled inputs, but they still require triage.
- **App Review risk:** Not a certain rejection by itself, but shipping an avoidably stale native dependency set increases reliability and supply-chain risk.
- **Fix:** Review the Expo SDK 57 patch changelogs, update the recommended packages together in a dedicated branch, update Firebase/Functions dependencies only to compatible supported versions, and rerun every check in section 17. Do not use `npm audit fix --force`.
- **Verification performed:** Online Expo compatibility/Doctor checks, two isolated clean installs, and online root/Functions npm audits.
- **Status:** **OPEN — scheduled dependency-maintenance work.**

### P3-1 — Repository hygiene

- **Requirement:** Release maintainability and prevention of future configuration mistakes.
- The tracked Android `debug.keystore` is a standard development credential but should remain clearly limited to debug use.
- The tracked legacy `GoogleService-Info.plist` is unused and mismatched with the production iOS bundle.
- ESLint passes but warns that the project uses legacy config; schedule flat-config migration separately.
- Unused “Coming Soon” translation keys and disabled AI routes can be removed later; they are no longer visible in production navigation.
- **User impact:** None in the currently resolved production config.
- **App Review risk:** Low; mostly future-maintenance/configuration risk.
- **Fix:** Clean up in an isolated follow-up after confirming historical Android/iOS needs.
- **Verification performed:** Tracked-file, reference, and lint-output review.
- **Status:** **OPTIONAL POLISH.**

## 5. Requirement matrix

Legend:

- **CODE** — verified in repository/config
- **TEST** — verified by automated test/export
- **DEVICE** — requires physical/TestFlight testing
- **ASC** — App Store Connect confirmation
- **OWNER/LEGAL** — explicit decision/confirmation
- **N/A** — not applicable
- **BLOCKED** — unresolved release blocker

| Requirement | CODE | TEST | DEVICE | ASC | OWNER/LEGAL | Status/notes |
|---|---:|---:|---:|---:|---:|---|
| iOS 26 SDK-capable toolchain | ✓ | config | archive |  |  | Ready to build |
| Bundle ID consistency | ✓ | ✓ | archive | ✓ |  | JS/EAS/Firebase align |
| App name/version/icon/splash | ✓ | ✓ | ✓ | ✓ |  | Icon passes source validation |
| iPhone-only support | ✓ | ✓ | ✓ | ✓ | ✓ | `supportsTablet: false` |
| Portrait/light appearance | ✓ | ✓ | ✓ |  |  | light mode made explicit |
| Production EAS environment | ✓ | ✓ |  |  |  | explicit `environment: production` |
| Remote build number | ✓ | query | archive | ✓ |  | uninitialized |
| Legal URLs/support email | ✓ | ✓ | ✓ | ✓ | policy accuracy | reachable/public |
| ATS / HTTPS only | ✓ | source scan | archive |  |  | no ATS exceptions found |
| Export compliance | config |  | archive | ✓ | ✓ | non-exempt encryption set false; confirm |
| Privacy manifests | deps | partial | archive |  |  | final aggregate/signatures pending |
| Required-reason APIs | deps | partial | archive |  |  | dependency reasons found; final archive pending |
| ATT/tracking | ✓ | source scan | ✓ | ✓ |  | no tracking; ATT not required on current evidence |
| Contextual microphone | ✓ | ✓ | ✓ |  |  | record UI/denial device test pending |
| Contextual location | ✓ | ✓ | ✓ |  |  | foreground only/manual venue fallback |
| Contextual notifications | ✓ | ✓ | ✓ |  |  | explicit Settings action; no root prompt |
| Email/password login | ✓ | ✓ | ✓ |  |  | Sign in with Apple not required by current flow |
| Password reset/sign-out | ✓ | ✓ | ✓ |  |  | device/network cases pending |
| Email verification |  |  |  |  | ✓ | not implemented; strategy decision |
| In-app account deletion | ✓ | emulator | ✓ |  | retention | server gaps remain |
| Anonymous social-data denial | ✓ | emulator |  |  |  | resolved; deployment pending |
| UGC filtering | partial | partial | ✓ |  | policy | narrow filter only |
| UGC report intake | ✓ | emulator | ✓ |  |  | present |
| Timely moderation response |  |  |  |  | ✓ | **BLOCKED** |
| Blocking/unblocking | partial | partial | ✓ |  | semantics | group enforcement gap |
| Published contact | ✓ | ✓ | ✓ | ✓ |  | verified |
| Youth/minor boundaries | partial |  | ✓ | ✓ | ✓ | unresolved |
| Reviewer credentials/data |  |  | ✓ | ✓ | ✓ | not created |
| English | ✓ | partial | ✓ | ✓ |  | device review pending |
| Spanish | ✓ | ✓ | ✓ | ✓ |  | game coverage complete; device review pending |
| VoiceOver common tasks | partial | source | ✓ | ✓ |  | do not claim yet |
| Larger Text/contrast | partial | static | ✓ | ✓ |  | manual |
| Reduced Motion |  | source | ✓ | ✓ |  | missing |
| Keyboard/safe areas | ✓ | source tests | ✓ |  |  | device matrix pending |
| Payments/IAP | N/A | source scan |  | ✓ | ✓ | no paid features found |
| Screenshots/metadata | plan |  | ✓ | ✓ | ✓ | final assets absent |
| Production backend parity | local | emulator |  |  | ✓ | remediation is not deployed; coordinated rollout required |
| Secret hygiene | ✓ | scan |  |  |  | no high-risk tracked secret pattern |
| TestFlight validation |  |  | ✓ | ✓ |  | not performed |

## 6. Changes made during this audit

These changes do not alter production data, legal wording, retention policy, permanent-account eligibility, paid features, Kids Category, or moderation policy. They remove an orphaned anonymous Trivia fallback and enforce the permanent-account boundary that the released route structure already required.

### Game privacy, integrity, and localization remediation

#### Architecture mapped

- **Released games:** Bomb Defusal, Spot the Difference and Trivia Blitz are selected from `app/(tabs)/games.tsx`. Lobby routes live under `app/(games)`; play routes live under `app/games`. Both route groups use `AuthenticatedRouteGate`. Icebreaker is a localized local prompt card on the parent home tab and has no backend session.
- **Trivia lifecycle:** The Games tab/lobby creates or resolves the four-character routing code. `TriviaBlitzScreen` uses callable-only create/resume/ready/start/submit/advance/reset/end operations and subscribes read-only to safe session/player projections. Trivia start updates the parent session, public game state, session link and JOIN-code mapping in one Firestore transaction. An authorized rematch renews and reopens those records together. Questions and answers remain in `triviaGameSecrets`; the server owns deadlines, turns, scoring, streaks, results and rematch transitions.
- **Bomb/Spot lifecycle:** The host creates a server-owned RTDB session and Firestore JOIN-code mapping through `gameJoinCodes.ts`; another permanent user joins through the validated code. Start validates hard expiry, player minimum and every participant's ready state inside the RTDB transaction. If the following Firestore routing transition fails and did not commit, the callable compensates by returning the RTDB session to lobby, avoiding an orphan active session. RTDB client access is participant read-only; future Bomb steps remain Admin-only.
- **Rewards:** local/developer play cannot mint Sideline Stars. Reward session/result/finalization callables require canonical multiplayer participation and derive outcomes from the trusted Firestore/RTDB session.
- **Squad discovery used around games:** nearby/search/detail use permanent-account callables. Search returns venue name, sport, counts, activity and active state. Nearby additionally returns the venue coordinate needed for distance display. Detail returns no roster to a nonmember; an active member receives at most eight name-only roster previews. Raw Squad listing is disabled.
- **Firebase surfaces:** Firestore stores JOIN-code routing records, safe Trivia session/player data, Trivia secrets/submissions/rate limits, rewards and Squad projections. RTDB stores Bomb/Spot sessions plus inaccessible Bomb secrets. Storage contains no game images; all Spot scenes are bundled WebPs and default Storage access remains denied. Cloud Functions is the only game writer.

#### Before and after trust boundary

| Boundary | Before | After |
|---|---|---|
| Firebase identity | Trivia created an anonymous Auth user | no production `signInAnonymously`; stale anonymous state is signed out |
| Social authorization | any non-null Auth token passed `signedIn()` | provider-aware permanent account required in Firestore, RTDB, Storage and callables |
| Squad discovery | client could list/get raw documents | raw list denied; raw get is active-member-only; nonmember discovery is field-allowlisted |
| Identity resolution | raw `memberIds` could be sent to public-profile lookup | anonymous callable denied; nonmember detail has no IDs/names; member roster is explicit name-only projection |
| Trivia questions/scores | answer bank and scoring logic were client-accessible/client-driven | private server bank, safe current question, server deadlines/scoring/turns, idempotent submissions |
| Bomb sequence | future steps could be participant-readable | only current step public; future sequence in denied RTDB secret path |
| Spot progress | optimistic client state could record before trusted success | server authorizes the session/participant and allowlists/deduplicates difference IDs; UI commits only after callable success |
| Game writes | clients mutated game records directly | all Firestore/RTDB game writes denied; callable reauthorizes every mutation |
| Abuse/expiry | incomplete create/answer/code controls and cleanup | permanent-account rate limits, two-hour hard expiry, five-minute terminal-read grace, scheduled cleanup and account-deletion cleanup |

There is no guest-game exception after this remediation. An unauthenticated or anonymous caller receives no game-session data. The term “joining player” now means a second signed-in Sideline Social account using a valid JOIN code.

#### Integrity controls

- Host-only start, advance, reset, end and lifecycle changes are checked against stored host authority; the client cannot supply host status.
- Participant membership is written only by the validated JOIN-code callable. Reconnect returns the existing participant instead of creating a duplicate.
- Start is race-safe and server-authorized. Trivia requires at least two players, Bomb Defusal at least two, and Spot the Difference exactly four; every joined player must be ready in the same trusted start path.
- Trivia accepts one answer only from the active player for the current question before the server deadline. Submission IDs are hashed, bound to the private server `roundId` and replay-safe; reuse with different content or across rematches is rejected.
- Trivia answer indexes are checked against the private stored question, scores/streaks are calculated in the transaction, and answer keys are revealed only in the post-answer result.
- Trivia start commits gameplay and routing state atomically. Its host-authorized rematch reset is the only supported terminal-to-lobby transition and renews expiry; completed RTDB sessions cannot reopen.
- RTDB starts validate expiry, player count and readiness transactionally. A failed uncommitted Firestore mapping transition triggers a compensating RTDB rollback.
- RTDB hard expiry remains effective during active play. Terminal participant reads are allowed for only five minutes.
- Legacy Bomb sessions containing client-readable `gameState.bombSteps` fail closed. Stored Bomb submissions cannot be replayed after completion or expiry.
- JOIN-code registry/link/request collections have no client access. Invalid, full, started and expired sessions fail with bounded safe reasons, and repeated lookups are throttled.
- RTDB reads require permanent provider, current participant/host membership and an unexpired session. Writes, cross-session reads and Bomb secret reads are denied.
- Spot accepts only `difference_01` through `difference_10`, authorizes the caller's active session and deduplicates discoveries; client gesture geometry determines which candidate ID was tapped. Bomb validates the submitted action against the server-only sequence, stores an idempotent processed result and prevents a caller from selecting a future step.
- Unexpected Trivia logs contain operation/error name/code/stack only. They do not log UID, exact location, token, JOIN code, session identifier, question or answer.

#### Spanish and Spot regression protection

- English/Spanish resources cover game selection, JOIN codes, lobbies, waiting/ready/start states, instructions, questions/options, timers, turns, answer feedback, scores, results, rewards, rematch/leave, errors/retries and accessibility labels. The bilingual server question bank has 60 validated question records; Icebreaker has 80 paired prompts.
- The 42 existing Spot WebPs were not renamed, resized, recompressed or replaced. The registry still resolves 21 A/B scene pairs at 1024×1024, and the production export contains WebPs rather than restored scene PNGs.
- Spot continues to use the existing React Native image/contain layout and worklet gesture geometry. Geometry/gesture contract tests verify focal pinch, bounded pan, hotspot mapping, tap-versus-transform behavior and reset/scene transition state. Localization and callable progress changes do not alter image geometry.
- Fresh EAS-production-environment exports were generated locally from the final source state for iOS and Android (not EAS builds). Both passed exact source/export asset hashes and a private-question-marker scan. A stale local generated Android release bundle dated July 27 still contains the former client question bank; if any binary built from that artifact was distributed, rotate the Trivia bank before release. The fresh audited exports do not contain it.

#### Deployment and migration

- No production resource was deployed and no production record was changed.
- Deploy new Functions first, then deploy Firestore/RTDB/Storage rules in coordination with the new client release. The tightened rules intentionally disable legacy direct game writes, so old clients' multiplayer games will stop working once the rules are live.
- No new Firestore composite index is required; the required Squad membership/search indexes already exist.
- No mandatory data rewrite is required to close anonymous access. Canonical Squad membership documents take precedence; the temporary legacy `memberIds` fallback applies only when no canonical membership exists. Backfill remaining legacy memberships, then remove that fallback in a later controlled migration.
- Existing anonymous Auth identities are inert after deployment because all rules/callables reject them. Confirm the Firebase project's anonymous-account cleanup policy and remove legacy anonymous identities only through an owner-approved maintenance procedure.

1. **Production completeness**
   - Removed Trivia's obsolete `supportsLocalTest` card opt-in, so no released game exposes the solo Local Test entry. The dormant generic `__DEV__ && local=1` harness remains development-only and is absent from production exports.
   - Replaced the unfinished generic game-lobby placeholder with a redirect to Games.
   - Removed the now-unused `GamePlaceholder`.
   - Hid the disabled “AI Coach — Coming Soon” entry point until its feature flag is enabled.
   - Replaced Spot-the-Difference developer failure text with localized recovery and a Games action.

2. **iOS native configuration**
   - Forced light appearance and a dark status bar to match the actual fixed light theme.
   - Denied arbitrary and local-network loads in production ATS configuration.
   - Removed unused always-location and motion purpose keys while retaining contextual foreground location.
   - Corrected the microphone purpose string to cover user-initiated voice messages in chat and team conversations.

3. **Localization**
   - Localized first-launch, sign-in, sign-up, and password-reset success surfaces.
   - Selected Spanish on first launch when the system locale begins with `es`.
   - Persisted the resolved English/Spanish preference at account creation instead of hardcoding English.

4. **Accessibility/navigation**
   - Added roles and disabled/busy states to shared primary/outline buttons.
   - Replaced fixed button heights with minimum heights/padding for text growth.
   - Added localized 44-point auth back controls.
   - Added a shared visible/localized Settings back control to Settings, Legal, Blocked Users, and Delete Account.

5. **Recovery**
   - Legal/support/mail links now show a localized failure alert if the OS cannot open them.
   - Squad detail now distinguishes a missing record from a transient backend failure and provides retry/back recovery.

6. **Firebase identity**
   - Selected the verified iOS Firebase app ID on iOS while preserving the Android Firebase app ID on Android.

7. **Regression coverage**
   - Updated game, Coach Resources, Support, iOS release, and Squad UI tests for the corrected contracts.

### Files changed by the audit

This is the complete current audit working-tree inventory. It includes the preserved iOS-readiness work that predated the game-remediation pass and the game changes made in this pass:

- `app.config.js`
- `app/(auth)/email-login.tsx`
- `app/(auth)/forgot-password-success.tsx`
- `app/(auth)/forgot-password.tsx`
- `app/(auth)/onboarding.tsx`
- `app/(auth)/sign-in.tsx`
- `app/(auth)/sign-up.tsx`
- `app/(games)/bomb-defusal/Lobby.tsx`
- `app/(games)/lobby.tsx`
- `app/(games)/spot-the-difference/Lobby.tsx`
- `app/(games)/trivia-blitz/Lobby.tsx`
- `app/(social)/squad-detail.tsx`
- `app/(tabs)/games.tsx`
- `app/(tabs)/index.tsx`
- `app/_layout.tsx`
- `app/coach/resources/index.tsx`
- `app/settings/blocked-users.tsx`
- `app/settings/delete-account.tsx`
- `app/settings/index.tsx`
- `app/settings/legal.tsx`
- `components/AuthenticatedRouteGate.tsx`
- `components/CountdownOverlay.tsx`
- `components/GamePlaceholder.tsx` (removed)
- `components/LobbyBase.tsx`
- `components/OutlineButton.tsx`
- `components/PrimaryButton.tsx`
- `components/SettingsBackButton.tsx` (added)
- `config/firebase.ts`
- `config/locales/en.json`
- `config/locales/es.json`
- `context/AuthContext.tsx`
- `database.rules.json`
- `docs/ios-app-store-readiness-report.md`
- `firestore.rules`
- `functions/src/accountDeletion.ts`
- `functions/src/coachResourceHelp.ts`
- `functions/src/contentModeration.ts`
- `functions/src/disabled/coachResourceHelp.ts`
- `functions/src/friendChat.ts`
- `functions/src/gameJoinCodes.ts`
- `functions/src/index.ts`
- `functions/src/permanentAuth.ts` (added)
- `functions/src/squadAdmin.ts`
- `functions/src/squadSeason.ts`
- `functions/src/triviaGame.ts` (added)
- `functions/src/triviaQuestions.json` (added)
- `functions/src/userNotificationDismissal.ts`
- `hooks/useGameLobby.ts`
- `i18n/index.ts`
- `package.json`
- `scripts/test-account-deletion-functions-emulator.cjs`
- `scripts/test-active-game-lifecycle.cjs`
- `scripts/test-auth-identity.ts` (added)
- `scripts/test-coach-resources-core.cjs`
- `scripts/test-game-join-code-core.cjs`
- `scripts/test-game-join-code-functions-emulator.cjs`
- `scripts/test-game-join-code-rtdb-rules.cjs`
- `scripts/test-game-localization.cjs` (added)
- `scripts/test-game-security-functions-emulator.cjs` (added)
- `scripts/test-ios-release-core.cjs`
- `scripts/test-permanent-auth-boundary.cjs` (added)
- `scripts/test-post-sdk57-regressions.cjs`
- `scripts/test-sideline-stars-core.cjs`
- `scripts/test-sideline-stars-functions-emulator.cjs`
- `scripts/test-spot-difference-webp-assets.cjs`
- `scripts/test-squad-firestore-rules.cjs`
- `scripts/test-squad-ui-core.cjs`
- `scripts/test-support-contact.cjs`
- `scripts/test-trivia-answer-feedback.cjs`
- `scripts/test-trivia-callable-client-contract.cjs` (added)
- `scripts/test-trivia-firestore-rules.cjs`
- `services/gameJoinCodeService.ts`
- `services/gameService.ts`
- `services/squadService.ts`
- `src/game/BombDefusalScreen.tsx`
- `src/game/spotDifference/SpotDifferenceScreen.tsx`
- `src/game/triviaBlitz/TriviaBlitzScreen.tsx`
- `src/game/triviaBlitz/firebaseUtils.ts`
- `src/game/triviaBlitz/gameState.ts`
- `src/game/triviaBlitz/questionSelection.ts`
- `src/game/triviaBlitz/scoring.ts`
- `src/game/triviaBlitz/turnManager.ts`
- `src/game/triviaBlitz/types.ts`
- `storage.rules`
- `utils/authIdentity.ts` (added)

## 7. Proposed App Privacy Nutrition Label data map

This is a code-evidence proposal, not a legal filing. App Store Connect answers must include vendor/backend behavior and owner-approved retention. “Tracking” is **No** on current evidence; no ATT prompt should be added without actual tracking.

| Apple data type | Collected? | Source/feature | Linked to identity? | Tracking? | Purpose | Storage/transmission | Retention/deletion | Policy fit |
|---|---|---|---:|---:|---|---|---|---|
| Name | Yes | account/public profile; child display names; message author names | Yes | No | account, discovery, team/chat | Firebase Auth/Firestore/Functions | account deletion attempts removal/anonymization; child/legacy retention needs confirmation | Generally disclosed; full-surname behavior must be reconciled |
| Email address | Yes | Firebase email/password Auth; profile | Yes | No | authentication, support/account | Firebase Auth/Firestore | Auth/profile deletion intended | Disclosed |
| Phone number | Optional field in model | profile | Yes | No | team/account functionality | Firestore; Auth only if used as Auth method (not currently) | deletion intended | Confirm whether UI currently collects it and label accordingly |
| Precise location | Yes, contextual | foreground current coordinates for nearby discovery; venue coordinates | Yes during authenticated request; venue location linked to Squad | No | app functionality | sent to Functions; Squad venue GeoPoint stored | current parent coordinates are not intentionally persisted; venue retention tied to Squad | Disclosed; anonymous/raw-Squad exposure is closed in the working tree |
| Coarse location | Yes | ZIP code/profile and venue search context | Yes | No | profile/discovery | Firestore | deletion intended | Confirm ZIP treatment in label |
| User ID | Yes | Firebase UID throughout | Yes | No | authentication/security/app functionality | Auth, Firestore, RTDB, Functions, logs | deletion has residual gaps | Disclosed generally; retention detail incomplete |
| Device ID | Yes | Expo/APNs push token | Yes | No | notifications | Firestore/Expo/Apple | unregister/delete intended; invalid-token cleanup | Disclosed |
| Emails or text messages | Yes | friend chat, team/private messages, announcements/replies | Yes | No | app functionality/safety | Firestore/Functions/push summaries | author deletion/removal/report retention varies | Disclosed generally; retention specifics incomplete |
| Audio data | Yes | voice messages in friend chats and team conversations | Yes | No | app functionality/safety | Firebase Storage plus metadata/grants | deletion and expiry jobs intended; report-evidence policy unresolved | Disclosed |
| Photos | Possibly | remote profile `photoURL` can reference an image; no photo-library picker/upload found | Yes | No | profile | third-party HTTPS origin / URL in Firestore | arbitrary remote retention unknown | Needs confirmation/restriction |
| Other user content | Yes | team/Squad names, sports, child names, schedules, captions, reports, group names | Yes | No | app functionality/safety | Firestore/Storage/Functions | mixed retention; report policy unresolved | Needs detailed retention mapping |
| Product interaction | Yes | game sessions/results, stars, friend/team actions, presence/activity | Yes | No | app functionality | Firestore/RTDB/Functions | deletion intended with residual audit required | Disclosed broadly |
| Search history | Likely ephemeral, not intentionally retained | parent/venue searches | Request linked while processed | No | app functionality | callable/Firestore query; provider logs may retain request metadata | provider/log confirmation required | Owner/vendor confirmation |
| Crash data | No dedicated SDK found | raw console/Cloud logs may contain error diagnostics | Possibly | No | diagnostics/security | device logs/Cloud Logging | access/retention manual | Do not claim “not collected” until logging policy confirmed |
| Performance data | No dedicated collection found | Firebase/service infrastructure may collect operational metadata | Possibly | No | app operation | vendor logs | manual confirmation | Confirm against Firebase/Expo |
| Advertising data | No | no ads SDK/UI | No | No | N/A | N/A | N/A | Consistent |
| Purchases | No | no purchase implementation | No | No | N/A | N/A | N/A | Consistent |
| Sensitive info / health / contacts | No direct collection found | N/A | N/A | No | N/A | N/A | N/A | Confirm no owner-side integrations |

### ATT conclusion

No advertising SDK, attribution SDK, IDFA request, data broker sharing, or cross-company tracking use was found. ATT is therefore not required on current evidence and should not be added “just in case.” Reassess if analytics/ads/attribution or cross-app data sharing is later introduced.

### Required owner/vendor confirmations

- Firebase/Google, Expo push/build, Apple APNs, hosting, Cloud Logging, and backup retention/access.
- Whether any server-side analytics, monitoring, support, or moderation tool exists outside this repository.
- Exact report/audio/message retention periods and deletion exceptions.
- Whether remote profile photos are currently available to users.
- Whether ZIP is declared as coarse location.
- Whether operational logs meet Apple’s “collected” definition for the final implementation.

## 8. Youth/minor data-flow summary

The repository describes an adult-facing parent/coach community, not a child-directed app, but it processes youth-related data.

### Data and flows

| Data | Created by | Visible to | Stored in | Main risk |
|---|---|---|---|---|
| Adult name/email/profile | account holder | search/discovery, friends, shared Squads/teams | Auth/Firestore | full-surname discovery; cross-context identity visibility |
| Child display name | parent/guardian account | team staff/parents depending team context | Firestore child/team records | no explicit authorization/retention policy |
| Child team participation | parent/coach/staff | team role holders | Firestore | role/authorization drift |
| Venue and schedules | adults | field-limited permanent-account discovery; full Squad/team context only for authorized members | Firestore | physical-location inference |
| Messages/voice/captions | adults in team/friend contexts | conversation participants | Firestore/Storage | child/family details may be shared in UGC |
| Push notifications | backend | device lock screen | Apple/Expo/device | current payloads are generic, which is positive |
| Reports | users | intended moderators only | Firestore | no operational moderator workflow or retention decision |

### Positive controls

- Push text is generic and avoids message bodies/child names.
- Storage voice rules bind upload reservation, team/path, MIME, duration, and size; direct reads are denied.
- Private child/profile/team collections are mostly default-denied by rules.
- Location is foreground/contextual and manual venue search exists.
- The current store draft does not say “For Kids” or “For Children.”

### Owner/legal questions

1. Are accounts strictly limited to adults? If so, what eligibility and attestation are required?
2. Is email verification required before discovery/messaging/team access?
3. What authority must a parent or coach have to enter a child’s name?
4. What child fields are strictly necessary, and when are they deleted?
5. Is the app definitely not in Kids Category, and do age-rating answers reflect messaging/UGC?
6. How do a parent and affected child exercise access/deletion rights?
7. What Terms/Guidelines assent and version history must be stored?

No COPPA or other legal conclusion is made here.

## 9. UGC moderation, report, and block verification

| Control | Parent/friend | Coach/team | Backend enforced? | Result |
|---|---|---|---|---|
| Severe text filter | friend messages | announcements/replies/private text/captions | callable | Partial; narrow regex set |
| Report message | yes | yes | callable validates reporter/context | Intake passes |
| Report user | yes | limited by surfaces | callable | Intake passes |
| Report voice | metadata/caption only | metadata/caption only | callable | Evidence insufficient |
| Block | yes | team semantics separate | direct conversation checks | Group gap |
| Unblock | Settings | N/A | callable | Present |
| Search/suggestion suppression | partial | role-based | mixed | Needs block matrix |
| Push suppression | direct/new invite paths check | team policy | mixed | Existing group path needs proof |
| Moderator queue | no client access (correct) | no client access | no consumer found | **Missing** |
| Content removal/sanction | own-message removal only | author/admin paths | no moderator operation found | **Missing** |
| Appeal/escalation/SLA | no | no | external process unverified | **Missing** |
| Support contact | yes | yes | N/A | Verified |
| Terms/Guidelines | Settings/legal | Settings/legal | N/A | Verified links/copy |

The report collection must remain privileged. The fix is not to weaken rules; it is to add an authorized operational consumer and tested enforcement workflow.

## 10. Account-deletion verification

### Present

- Settings → Delete Account is discoverable.
- Current password reauthentication occurs before the callable.
- Typed `DELETE`, password, and destructive confirmation are required.
- Callable operations are designed to be idempotent.
- Auth deletion is last.
- Auth/profile, child subcollections, many memberships, friends/requests/blocks, notifications/tokens, messages/audio, game/reward participation, RTDB participation, and public profile are addressed.
- Sign-out clears user-scoped local state through `clearSignedInUserLocalState`.

### Open gaps

- Server does not enforce recent `auth_time`.
- UID-bearing rate-limit/grant collections remain.
- Inactive/archived ownership identity may remain.
- Moderation-report retention has no approved duration/basis.
- Provider backups/logs/exports are not documented.
- Production-like disposable-account verification has not occurred.

### Required final test

1. Create a disposable account with child, friend, direct/group chat, team/Squad membership, voice message, notification token, game data, and report.
2. Confirm sole-owner guard.
3. Transfer ownership and delete.
4. Query every Auth/Firestore/Storage/RTDB/index/derived/logical reference as Admin.
5. Confirm allowed anonymized history contains no reversible UID/name/email.
6. Confirm old tokens cannot call/read, push stops, local caches clear, and re-registration works.
7. Repeat with stale auth and a forced mid-operation failure.

## 11. Permission-purpose-string inventory

| Resource | Dependency/path | Purpose string/config | Request timing | Denial/fallback | Status |
|---|---|---|---|---|---|
| Microphone | `expo-audio`; voice composers; `services/voiceMemoPermissionService.ts` | “Sideline Social uses your microphone only when you choose to record a voice message in a chat or team conversation.” | user chooses recording | text remains; denial/settings outcomes | Source/config verified; device test required |
| Foreground location | `expo-location`; `services/squadService.ts:227-255` | nearby sports-community wording; precise location not shown to others | after user chooses nearby and sees disclosure | manual venue search; no background tracking | Source verified; anonymous/raw-Squad exposure closed; device test required |
| Notifications | `expo-notifications`; Settings | Apple system prompt; localized in-app rationale/action | explicit Enable Notifications action; coordinator only registers if already granted | app remains usable; Settings recovery | Source verified; device/APNs test required |
| Camera | none | none | never | N/A | N/A |
| Photo library | none | none | never | N/A | N/A |
| Contacts | none | none | never | N/A | N/A |
| Bluetooth | none | none | never | N/A | N/A |
| Calendars | native date picker only; no EventKit | none | never | N/A | N/A |
| Motion/fitness | none; Expo Location default key explicitly disabled | none | never | N/A | Source/config verified |
| Tracking/IDFA | none | none | never | N/A | N/A |
| Local network | no app feature; Expo Dev Launcher adds development-only keys and a non-Debug strip phase | none in the expected release product | never | N/A | Production ATS denies arbitrary/local networking; verify stripped keys in archive |
| Speech recognition | none | none | never | N/A | N/A |
| Background location/audio | disabled | none | never | N/A | N/A |

Always-location and motion purpose keys are absent from final Expo introspection after the audit fix. Recording must still be visually checked for an obvious active/stop state and VoiceOver announcement. Purpose strings and the absence of development-only local-network keys must be re-read in the generated archive, not only source config.

## 12. Third-party SDK and privacy-manifest inventory

### Major runtime dependencies

| SDK/family | Feature | Privacy/data consideration |
|---|---|---|
| React Native 0.86 / Hermes | app runtime | Apple lists Hermes among SDKs with manifest/signature requirements |
| Expo SDK 57 modules | native shell, assets, file system, notifications, audio, location | permission/data use depends on selected modules |
| Firebase JS SDK 10.x | Auth, Firestore, RTDB, Functions, Storage | identifiers, email/display name, user agent, app data; actual service data must be labeled |
| AsyncStorage 2.2 | local preferences/Auth persistence | its source manifest declares the file-timestamp reason; React Native/Expo modules declare the applicable UserDefaults reasons |
| React Native Maps 1.27.2 | nearby map | iOS uses Apple Maps in source; precise location declaration exists |
| Lottie 7.3.1 | animation | Apple-listed SDK; bundled manifest reports no tracking/data |
| Reanimated/Gesture Handler/Worklets | gestures/animation | required-reason dependencies must be present in final pod aggregate |
| Expo Notifications | push token/response | device token linked to account |
| Expo Audio | voice recording/playback | audio uploaded to Firebase Storage |
| Expo Location | foreground current location | precise coordinates sent to callable |
| Expo Image/SVG/fonts/icons | rendering | remote image requests may expose network metadata |

No native Firebase iOS CocoaPods are expected because the app uses the Firebase JavaScript SDK. The `GoogleService-Info` file is still configured for the Expo/native project and must match the archive, but do not assume native Firebase manifests exist unless `Podfile.lock`/archive proves they are linked.

### Privacy manifests found in installed packages

Fifteen installed dependency manifests parse successfully. They cover AsyncStorage, Expo Application/Constants/FileSystem/Notifications/SystemUI, Lottie, React Native core/third-party dependencies, and React Native Maps. None of those 15 source manifests sets `NSPrivacyTracking` or declares a tracking domain.

Observed required-reason categories include:

- File timestamp APIs: `C617.1`, plus Expo FileSystem reasons `0A2A.1` and `3B52.1`.
- User defaults: `CA92.1`.
- Disk space: `E174.1` and `85F4.1`.
- System boot time: `35F9.1`.

React Native Maps declares precise location for app functionality. Its `AirGoogleMaps` resource manifest has broader non-tracking analytics/device declarations, including linked User ID, but `react-native-maps.podspec` defaults to the Apple `Maps` subspec and source does not opt into the iOS Google subspec. Confirm `AirGoogleMaps` and its privacy bundle are absent from the generated `Podfile.lock` and final archive.

There is no app-owned `PrivacyInfo.xcprivacy` in source. That is not automatically a defect when the app itself does not directly invoke required-reason APIs and included native SDKs supply valid manifests; the final Xcode privacy aggregate remains the authoritative check.

### Final archive procedure

1. Download the EAS build artifact/archive.
2. Inspect `Payload/*.app/PrivacyInfo.xcprivacy` and every embedded framework/resource bundle.
3. Use Xcode Organizer’s privacy report to review the aggregate.
4. Confirm each required-reason category maps to actual SDK use and an approved reason.
5. Confirm Apple-listed binary SDK signatures validate.
6. Confirm no App Distribution, Crashlytics, Analytics, Google Ads, or Google Maps iOS SDK was unexpectedly linked.
7. Reconcile the aggregate data collection with App Store Privacy answers.

## 13. App completeness, payments, and reviewer access

### Completeness

Resolved during audit:

- “Local Test” cannot render or activate in a release bundle.
- Generic unfinished lobby copy was removed.
- Disabled AI “Coming Soon” UI is hidden.
- Developer-only Spot scene failure copy was replaced.
- Fixed light-only appearance is declared.
- Auth/first-launch is localized.
- Squad transient failures no longer masquerade as “not found.”
- Anonymous Firebase identities are excluded from game, social, team, profile, Squad, location, message and Storage access.
- Trivia and JOIN-code game mutations, timing, answers, scoring and rewards are server-authoritative.
- English/Spanish game copy and bilingual Trivia/Icebreaker content have automated parity coverage.
- Fresh iOS/Android exports preserve all 42 Spot WebPs and exclude the private Trivia answer bank.

Still required:

- Offline/slow network, expired token, denied permission, missing profile, and backend failure walkthrough on device.
- Two-device English/Spanish game lifecycle and Spot gesture/layout verification.
- Stable reviewer data/credentials.
- Final scan of the minified production export/archive for test/development copy.

### Payments/business model

No StoreKit, RevenueCat, Stripe, purchase/subscription/donation/paywall UI, external digital purchase link, promotional unlock, or paid coaching content was found. Current conclusion: free app, no in-app purchases, no purchase required for review. Confirm the business model and App Store price (“Free”) in App Store Connect.

## 14. App Store Connect manual checklist

Every item not provable from source is marked **MANUAL CONFIRMATION REQUIRED**.

### Account, agreements, identity

- [ ] **MANUAL CONFIRMATION REQUIRED:** Apple Developer Program membership active.
- [ ] **MANUAL CONFIRMATION REQUIRED:** Agreements accepted; no compliance hold.
- [ ] **MANUAL CONFIRMATION REQUIRED:** Tax/banking complete if required for the selected free distribution agreement.
- [ ] Create/verify app record for `com.sidelinesocial.app`.
- [ ] Confirm display name “Sideline Social” and unique SKU.
- [ ] Confirm primary language.
- [ ] Confirm version 1.0.0 and processed build number.
- [ ] Select the correct processed TestFlight build only after testing.

### Metadata

- [ ] Final app name (≤30 characters), subtitle, promotional text, description, keywords, and copyright.
- [ ] Select appropriate primary/secondary categories; likely Social Networking and/or Sports, owner decision.
- [ ] Remove unverified claims and “for kids/children” phrasing.
- [ ] Confirm content-rights declaration for icons, photos, WebP scenes, fonts, copy, and sample data.
- [ ] Set Support URL to `https://www.joinsidelinesocial.com/support`.
- [ ] Set Privacy Policy URL to `https://www.joinsidelinesocial.com/privacy`.
- [ ] Add Terms URL where appropriate: `https://www.joinsidelinesocial.com/terms`.
- [ ] Decide whether a Privacy Choices URL is appropriate; account deletion is available in app and on Support.

### Privacy/safety/age

- [ ] Enter App Privacy answers only after resolving P0/P1 data flows and reviewing section 7.
- [ ] Confirm “Data Used to Track You” is No on final implementation.
- [ ] Confirm advertising identifier declaration is No.
- [ ] Complete current age-rating questionnaire honestly for messaging, UGC, voice/audio, games, and user interaction.
- [ ] **OWNER/LEGAL:** Confirm adult-only eligibility/minimum age.
- [ ] **OWNER/LEGAL:** Confirm “Made for Kids” is not selected.
- [ ] **OWNER/LEGAL:** Approve child-data, report, message/audio, log, and backup retention.
- [ ] Prove real moderation queue/staffing/escalation before submission.

### Export/capabilities/build

- [ ] Confirm encryption/export answers with qualified owner/legal input. Source uses standard HTTPS/TLS/Firebase and declares `ITSAppUsesNonExemptEncryption=false`; do not rely on this report as legal advice.
- [ ] Verify APNs key/certificate and Push Notifications entitlement.
- [ ] Verify distribution certificate/provisioning.
- [ ] Verify no unexpected associated domains, background modes, keychain groups, ATT, local-network, or location capabilities.
- [ ] Inspect archive privacy report, SDK signatures, dSYM, symbols, architectures, Info.plist, icon, and entitlements.

### Screenshots/accessibility

- [ ] Capture 1–10 current iPhone screenshots. Current accepted 6.9-inch portrait sizes are 1260×2736, 1290×2796, or 1320×2868 pixels; use the exact native size of the capture device.
- [ ] No alpha, status/debug overlays, real personal data, test labels, Android chrome, or placeholder content.
- [ ] Use fictional data.
- [ ] Validate screenshot ordering/copy in English and any submitted Spanish localization.
- [ ] Do not select VoiceOver/Larger Text/Reduced Motion/contrast Accessibility Nutrition Labels until every common task meets Apple’s criteria.

### Review access

- [ ] App Review contact name, phone, and `joann@joinsidelinesocial.com`.
- [ ] Stable parent reviewer credential.
- [ ] Stable coach/staff reviewer credential.
- [ ] Second multiplayer credential/device plan.
- [ ] Disposable deletion credential.
- [ ] Active fictional team/Squad and valid JOIN code.
- [ ] Stable friends/chat/messages/reports/blocked-user sample state.
- [ ] Backend and sample data available for the entire review window.
- [ ] Copy final notes from section 15 into App Review Notes after filling placeholders.

### Release

- [ ] TestFlight internal test.
- [ ] TestFlight external/App Review test if desired.
- [ ] Resolve all crash/feedback findings.
- [ ] Confirm pricing “Free,” territories, availability, and release method.
- [ ] Choose manual release or approved automatic release strategy.
- [ ] Submit the correct processed build, not merely the latest uploaded build.

## 15. Copy-ready App Review Notes draft

Replace every bracketed placeholder. Do not put credentials in source control.

> Sideline Social is an adult-facing community app for parents, coaches, and authorized team staff at youth-sports activities. Adults can discover or join a sports community, manage team participation, communicate in direct/group/team spaces, and play short multiplayer sideline games. No purchase or subscription is required.
>
> **Parent reviewer account**
> Email: `[PARENT_REVIEW_EMAIL]`
> Password: `[PARENT_REVIEW_PASSWORD]`
>
> **Coach/staff reviewer account**
> Email: `[COACH_REVIEW_EMAIL]`
> Password: `[COACH_REVIEW_PASSWORD]`
>
> **Second multiplayer account**
> Email: `[SECOND_PLAYER_EMAIL]`
> Password: `[SECOND_PLAYER_PASSWORD]`
>
> **Disposable account-deletion account**
> Email: `[DELETE_REVIEW_EMAIL]`
> Password: `[DELETE_REVIEW_PASSWORD]`
>
> **Sample team/Squad**
> Team name: `[FICTIONAL_TEAM_NAME]`
> JOIN code: `[VALID_JOIN_CODE]`
>
> To test Parent Mode, sign in with the parent account. Open Friends to search, send/accept a request, open a conversation, report a benign test message, block the prepared fictional user, and manage blocked users from Profile → Settings → Blocked Users.
>
> To test Coach Mode, use Profile to switch to Coach Mode, open the prepared team, review the roster, create a test announcement/private message, and open Coach Resources. Only fictional data is provided.
>
> To test games, use the parent account as host and the second account on another device as a joining player. Enter the displayed four-character code. The production build does not expose developer/local-test mode.
>
> Community Guidelines, Terms, Privacy Policy, Support, and `joann@joinsidelinesocial.com` are available under Profile → Settings → Privacy, terms & community guidelines.
>
> Friend-chat users can report content/users and block/unblock users. Team content can be reported from the message actions. Reports are received by `[MODERATION_SYSTEM/TEAM]` and handled under `[RESPONSE_TARGET]`; violating content/accounts can be removed or restricted through `[OPERATOR_WORKFLOW]`.
>
> To delete an account, open Profile → Settings → Delete Account, enter the current password, type DELETE, and confirm. Use only the disposable deletion account because deletion is permanent.
>
> Location is optional and requested only after choosing nearby discovery; manual venue search remains available. Microphone access is optional and requested only when recording a team voice message. Notifications are optional and enabled from Settings.
>
> The app uses email/password authentication only. It contains no advertising, tracking, in-app purchases, subscriptions, or external digital-purchase flow.
>
> Backend services and all reviewer sample data will remain available throughout review. Contact: joann@joinsidelinesocial.com / `[REVIEW_PHONE]`.

Do not use this draft until the moderation statement is true and the remaining P0 blocker is closed.

## 16. Physical-device and TestFlight test plan

iPad native support is disabled. No iPad screenshots are required for the iPhone app, but smoke-test iPhone compatibility mode on an iPad if available.

### Device/layout matrix

- Compact supported iPhone/iOS 16.4-class layout (for example, 375×667 points).
- Notched compact/standard iPhone.
- Current standard Dynamic Island iPhone.
- Current large 6.7/6.9-inch iPhone.
- At least one device on the minimum supported iOS and one on current iOS 26.
- Light and device dark setting (app should remain coherent light after the audit fix).
- Large Text and largest Accessibility Text Size.
- VoiceOver, Voice Control, Increase Contrast, Differentiate Without Color, Reduce Motion.
- Wi-Fi, cellular, airplane mode, slow/interrupted network.

### Required flows

1. Clean install, splash, onboarding, English and Spanish system locale.
2. Sign up, validation, password reset, sign in/out, expired/disabled credential.
3. Parent/Coach mode switch and missing-profile recovery.
4. Nearby discovery: rationale, Allow, Deny, Don’t Allow Again, services off, manual venue search.
5. Team/Squad create/join/switch/leave/admin/season/date picker.
6. Friend search/request/accept/decline/cancel/expiry/block/unblock.
7. Direct/group/team/private messaging: empty/long threads, text growth, keyboard, attachments/voice, deletion, reporting, block enforcement.
8. Voice recording indicator, interruption, denial, upload, persisted sender/recipient playback, deletion, report.
9. Notifications: denial, Settings enable, foreground/background/terminated, generic lock-screen payload, token cleanup.
10. All games with host/joiner, invalid/expired codes, app background/reconnect, long/Spanish text, large text.
11. Spot the Difference gestures, orientation lock, large screen, and accessibility limitation review.
12. Legal/support URLs and mailto with/without a configured mail client.
13. Account deletion with disposable account, network interruption, recent/stale auth.
14. Cold launch without Metro/development server.
15. Memory/heat/battery smoke test for maps, games, audio, and long chat lists.

### Acceptance

- No crash, blank trap, development UI, untranslated key, personal data in logs/lock screen, or blocked-user bypass.
- All common tasks have visible retry/back paths.
- Keyboard never covers the active composer or send controls.
- VoiceOver order/roles/states are understandable.
- No clipped text or horizontal scrolling at accessibility sizes.
- Backend/security results match emulator expectations.

## 17. Verification record

### Passed

- Clean root install: committed `package-lock.json` plus committed `.npmrc`, 1,005 packages.
- Clean Functions install: committed Functions lockfile, 241 packages.
- Isolated Functions Node 22 reproducibility gate: clean `npm ci` plus TypeScript build under Node 22.23.1.
- Functions TypeScript/build: passed.
- Root TypeScript: `npm.cmd run typecheck`
- ESLint: `npm.cmd run lint` — zero findings (legacy-config informational warning only)
- Current registry: 80 test commands covering 85 `scripts/test-*.cjs` files.
  - All 55 non-emulator commands passed sequentially on the final game implementation.
  - All 25 Firebase emulator-backed commands passed on the final implementation, including permanent/anonymous identity isolation, Squad projections, Trivia lifecycle/rematch/round replay, JOIN-code rules and Functions, Bomb/Spot minimum-player/readiness/expiry behavior, rewards and account deletion.
- EAS production legal validation: passed through `env:exec production`
- EAS production iOS config validation: passed; `env:exec` cannot materialize the secret plist, so it warned that the native file remained unverified
- EAS production profile/config resolution: passed with `environment: production`, store distribution, `developmentClient: false`, Node 24.16.0, and auto-increment.
- Read-only Expo config/introspection: passed; production ATS is restrictive, always-location/motion keys are absent, and the foreground-location/microphone strings match actual features.
- Production iOS JavaScript export through the EAS production environment: passed; a 9,231,442-byte Hermes bundle was generated locally in `dist/game-audit-20260729-ios-final`.
  - Privacy, Terms, and Support destinations are present.
  - The intended iOS Firebase app ID is present.
  - `Local Test`, `Prueba local`, and the removed unfinished-backend copy are absent.
  - All 21 Spot scenes/42 WebPs match exact source hashes, and private Trivia-answer markers are absent.
  - Dependency/dev-support strings include localhost/emulator constants, but app-source scanning found no production emulator endpoint. The production bundle does not activate a development client.
- Production Android JavaScript export through the EAS production environment: passed; a 9,435,682-byte Hermes bundle was generated locally in `dist/game-audit-20260729-android-final`.
  - The same 21 Spot scenes/42 WebPs match exact source hashes, no scene PNG was restored, and private Trivia-answer markers are absent.
- Fifteen installed native privacy manifests parsed successfully; their required-reason/data declarations are inventoried in section 12.
- Public/mobile Privacy, Terms, and Support pages: HTTPS, content present, no authentication, no mobile horizontal overflow
- Secret scan: no high-risk tracked private-key/token pattern; no tracked `.env` file
- `git diff --check`: passed

### Checks completed with findings

- `expo install --check`: not green. It recommends 11 Expo patch updates and `react-native-screens` 4.26.0.
- Expo Doctor: 18/20 checks passed. The dependency-alignment check failed, and Doctor warned about native config/CNG because `android/` is tracked while iOS is generated. The EAS iOS profile still resolves, but the generated iOS project must be inspected on the first macOS/EAS job.
- Root `npm audit --omit=dev`: 13 transitive advisories (one high, 12 moderate).
- Functions `npm audit --omit=dev`: nine moderate transitive advisories.
- A non-destructive temporary iOS prebuild was attempted with the local Expo template; Expo on Windows refused iOS generation and made no repository change. Consequently, generated `Podfile.lock`, final Info.plist, final entitlements, and the merged privacy manifest remain archive checks.

### Not performed by design

- No production EAS build.
- No TestFlight/App Store upload or submission.
- No Firebase deploy.
- No production-data write.
- No real production reviewer account.
- No physical iPhone/iPad test; this Windows workspace has no generated iOS project or iOS simulator.
- No connected Android emulator/physical device was available, so rendered two-device game and Spot gesture checks remain manual.
- No final signed archive/privacy-report/signature inspection.

## 18. Exact later build and submission commands

The game fix changes Functions plus Firestore, RTDB and Storage rules. Use the repository-independent Firebase CLI invocation below because a global `firebase.cmd` is not installed. Do not deploy the rules until the compatible client release is coordinated: legacy clients use direct game writes that the new rules intentionally deny.

```powershell
Set-Location C:\Dev\Sideline_Social_Code
npx.cmd firebase-tools@latest deploy --project sideline-squad --only functions
npx.cmd firebase-tools@latest deploy --project sideline-squad --only "firestore:rules,database,storage"
```

No index deployment is required by this remediation.

Run the production iOS build only after the remaining P0/P1 release gates are closed and changes are reviewed/committed:

```powershell
Set-Location C:\Dev\Sideline_Social_Code
npx.cmd eas-cli@latest whoami
npx.cmd eas-cli@latest env:list --environment production
npx.cmd eas-cli@latest build --platform ios --profile production
```

After the build succeeds:

1. Install through TestFlight and complete section 16.
2. Inspect the processed build, privacy report, entitlements, symbols, and export compliance.
3. Fill App Store Connect metadata/privacy/age/review information.

Upload the selected EAS build to App Store Connect:

```powershell
Set-Location C:\Dev\Sideline_Social_Code
npx.cmd eas-cli@latest submit --platform ios --profile production --latest
```

EAS Submit uploads the binary to App Store Connect/TestFlight; it does not replace the final App Store Connect review submission and manual declarations.

## 19. Rollback guidance

No deployment or irreversible external mutation occurred. All audit edits are uncommitted.

Preferred rollback if an individual fix is rejected:

1. Review the specific file diff.
2. Revert only that logical change in a normal follow-up commit or edit.
3. Re-run TypeScript, lint, the relevant focused test, the complete test matrix, and iOS export.

Do not use `git reset --hard` or a broad checkout because it could destroy unrelated work. The most independent rollback groups are:

- Production test/placeholder gating.
- Light appearance and iOS permission/network hardening.
- Auth localization/system language.
- Accessibility/back navigation.
- Legal-link and Squad error recovery.
- Platform Firebase app ID selection.
- Permanent-account provider boundary across client, rules and callable wrappers.
- Server-authoritative Trivia lifecycle/question bank.
- JOIN-code, Bomb-secret, Spot-progress and canonical reward enforcement.
- Game localization resources/tests.

The report itself can be removed without affecting runtime behavior.

## 20. Final repository and external-state record

- Branch: `main`
- Baseline commit: `1d181c7`
- `HEAD` and `origin/main`: `1d181c79db2ba09dfa3296da297ab17d1fd95973`
- Audit edits: 85 uncommitted paths (74 modified, one deleted, ten untracked)
- Temporary clean-install, test-runner and prebuild-inspection artifacts were removed. Fresh local JS exports remain under ignored `dist/game-audit-20260729-ios-final` and `dist/game-audit-20260729-android-final` for verification, and the pre-existing ignored July 27 generated Android bundle remains for the distribution/rotation decision above.
- Final `git diff --check`: passed
- Deployed during audit: **nothing**
- EAS build created: **no**
- TestFlight/App Store upload: **no**
- Firebase production data changed: **no**
- Commit created: **no**
- Push performed: **no**

Final `git status --short` is intentionally dirty and contains the same 85 paths listed in section 6. No unrelated user change was reverted, overwritten or discarded.

### Owner decisions required before the verdict can change

1. Establish and prove a real staffed moderation/removal/sanction/escalation workflow.
2. Define block semantics for shared friend groups and safety-critical team communication.
3. Approve adult/minimum-age, child-data authorization, Terms/Guidelines assent, and Kids Category posture with qualified legal review.
4. Approve data-retention/deletion periods for reports, messages/audio, logs, backups and residual records.
5. Create reviewer accounts/sample data and complete App Store Connect declarations.
6. Confirm whether any Android artifact generated from the stale July 27 local bundle was distributed; if yes, rotate the Trivia question bank before release.
7. Schedule the canonical Squad-membership backfill and later removal of the narrowly retained legacy `memberIds` fallback.
