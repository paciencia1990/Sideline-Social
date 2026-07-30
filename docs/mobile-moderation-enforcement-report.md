# Sideline Social mobile moderation enforcement report

Date: 2026-07-30
Mobile repository: `C:\Dev\Sideline_Social_Code`
Mobile baseline: `e764f92e07c923a8ad8de649af7b119a57676144`
Moderation repository: `C:\Users\joann\.codex\.chatgpt-projects\g-p-6a610d7964dc81918f737bb6e430b5b2\sideline-social-website`
Moderation baseline: `067bd82bd987cd82e84c6b1e11be7de0ba1af967`

## Executive result

**The mobile enforcement implementation is technically complete in the local
working trees. The production moderation launch and App Store release are not
ready.**

The local implementation now gives moderation actions immediate,
server-authoritative effect across callable Functions, Firestore, Realtime
Database, Storage, notification fan-out, media playback, and the mobile
navigation boundary. It also connects the website writer to the same canonical
standing contract and makes moderator content removal durable across clients.

Production remains blocked until the coordinated backend/Rules/client rollout
is performed, the moderation console is deployed behind verified moderator
roles and MFA, production alert delivery and staffing response targets are
proved, owner policy decisions are approved, and end-to-end production-like
and physical-device tests pass. App Check enforcement was intentionally not
enabled.

Apple's current Guideline 1.2 requires filtering, reporting, timely responses,
blocking, and published contact information for user-generated-content apps:
<https://developer.apple.com/app-store/review/guidelines/>.

## Canonical account-standing contract

The authoritative document is:

`/accountStanding/{uid}`

It is server-written. Ordinary clients have no direct read or write access.
The mobile app receives only a safe self projection through
`getMyAccountStanding` and `/accountStandingPublic/{uid}`.

| Canonical field | Meaning |
|---|---|
| `status` | `active`, `suspended`, or `banned` |
| `messagingRestricted` | communication restriction while `status == active` |
| `effectiveAt` | server timestamp at which the action takes effect |
| `expiresAt` | optional server timestamp for temporary action expiry |
| `reasonCode` | allowlisted public policy reason |
| `actionReference` | opaque moderation-action reference |
| `caseId` | associated moderation case |
| `revision` | monotonic concurrency version |
| `updatedAt` | server timestamp |
| `updatedBy` | moderator UID, retained only in the private canonical record |

The effective mobile states are:

1. `active`
2. `messagingRestricted`: canonical `status == active` with
   `messagingRestricted == true`
3. `suspended`
4. `banned`

Names, emails, client role fields, and custom claims do not determine account
standing. Missing or expired standing records remain compatible with existing
active accounts. Sensitive operations read current Firestore standing on every
request; they do not trust a stale ID-token claim.

The website moderation writer now updates the canonical document
transactionally, supplies every field above, increments `revision`, and writes
the compatible RTDB and user projections. Serious actions revoke Firebase
refresh tokens. Firebase documents that already exist are not modified by this
local work.

## Enforcement matrix

| Surface | Active | Messaging restricted | Suspended | Banned |
|---|---:|---:|---:|---:|
| Sign in and standing refresh | allow | allow | restricted shell | restricted shell |
| Permitted team information/official announcements | allow | read only | deny | deny |
| Direct/group/private/team text | allow | deny | deny | deny |
| Voice upload/finalization/playback grants | allow | deny new contact | deny | deny |
| Friend requests/search/suggestions | allow | deny | deny | deny |
| Profiles/social/team mutations | allow by role | deny contact mutations | deny | deny |
| Multiplayer host/join/answer/rematch | allow | deny | deny | deny |
| Push-token registration and user-triggered fan-out | allow | deny triggering | deny | deny |
| Blocking and reporting | allow | allow | allow through safety APIs | allow through safety APIs |
| Appeal/support/legal/sign-out/deletion | allow | allow | allow | allow |

Messaging restriction is enforced by backend capability checks and Rules, not
by hiding controls. Suspended and banned users do not mount the normal app,
Squad, or notification providers.

## Backend inventory and enforcement

The audit covered all exported callable, HTTP, scheduled, Firestore-triggered,
RTDB, and Storage paths in the mobile Functions codebase.

### Central authorization

- `functions/src/permanentAuth.ts` resolves current server standing and exposes
  application, communication, and safety capabilities.
- Existing permanent-account authentication remains mandatory. Anonymous
  Firebase users remain denied.
- Ordinary application callables require application capability.
- Communication, discovery, social mutation, team mutation, and game callables
  require communication capability.
- Reporting, blocking, appeal, support-adjacent operations, and account
  deletion use safety-capable boundaries so a restriction cannot remove a
  user's safety remedies.

### Surfaces audited

- Direct and group conversation creation, invitations, membership/admin
  changes, text sending, read markers, mute, removal, reporting, blocking, and
  unblocking.
- Friend-request send/respond/cancel/remove, active request loading,
  expiration, public-profile lookup, parent search, suggestions, and profile
  mutation.
- Team announcements, replies, private coach-parent conversations, recipient
  counts, roster/staff/team membership changes, child links, archive/leave, and
  content reporting.
- Voice reservation, upload authorization, announcement/private-message
  finalization, playback grant, HTTP streaming, deletion, and abandoned-upload
  cleanup.
- Squad discovery, join/admin changes, presence, seasonal/reward activity, and
  coach-resource generation.
- JOIN-code creation/resolution/release/cleanup, Trivia lifecycle and answers,
  Spot progress, Bomb steps, ready state, game rewards, and weekly challenges.
- Notification token registration, notification acknowledgement/clearing,
  friend/team triggers, announcement fan-out, receipt cleanup, and direct push
  delivery.
- Account deletion and the new standing/appeal lifecycle.

### Standing lifecycle

`functions/src/accountStanding.ts` adds:

- `getMyAccountStanding`
- `submitMyModerationAppeal`
- `onAccountStandingChanged`

The Firestore trigger publishes a safe self projection, updates the private
RTDB standing mirror used by game Rules, cancels pending voice reservations
and outgoing friend requests, dismisses notification inbox state, removes push
tokens for serious actions, and revokes refresh tokens for suspension or ban.

Firebase documents and ID tokens can outlive a UI state. For that reason,
callables and notification/media paths re-read standing. Firebase documents
are authoritative even while a previously issued ID token remains valid for
its short lifetime. This follows Firebase's session guidance:
<https://firebase.google.com/docs/auth/admin/manage-sessions>.

### Notifications

- Push delivery rechecks recipient standing immediately before token lookup.
- User-triggered fan-out rejects restricted actors.
- Personal, group-invite, and friend-message notification paths recheck both
  actor and recipient immediately before push delivery; if standing changes
  after inbox creation, the new inbox item is removed instead of delivered.
- Announcement fan-out skips moderated/deleted content and ineligible
  recipients.
- Serious-standing changes remove registered tokens and dismiss inbox state.
- Moderation notices and appeal responses contain no reporter, evidence,
  moderator, private-note, message, or child information.
- Existing moderation alert payloads remain limited to case ID, severity,
  report type, submission time, assignment state, and a secure dashboard path.

## Firebase Rules

### Firestore

Central `permanentSignedIn`, `signedIn`, and `canCommunicate` helpers now read
the canonical standing record. Suspended/banned users cannot read or write
ordinary application data. Messaging-restricted users cannot write
user-generated communication.

`accountStanding`, moderation cases, evidence, internal notes, and audit data
remain server-only. `/accountStandingPublic/{uid}` is self-get only.
User/profile standing fields and child/profile mutations cannot be used to
forge authority. Reports remain available through validated server APIs.

Rules retain default deny. Firestore document lookups are deliberately
centralized and remain inside documented access-call limits:
<https://firebase.google.com/docs/firestore/security/rules-conditions>.

### Realtime Database

RTDB game reads now require a permanent authenticated participant plus an
active, unexpired standing mirror. All client game writes and all
`accountStanding` reads/writes remain denied. Anonymous users retain no game
or social access.

### Storage

Direct reads remain denied. A voice upload can be created only when:

- the caller can currently communicate;
- the server reservation is pending, unexpired, owned by the caller, and
  matches the canonical target path;
- size, MIME type, duration, and target identifiers match.

This prevents a reserved upload from completing after restriction. Playback is
through a short server grant/stream that rechecks standing, participation,
content moderation state, and the canonical path. Existing download URLs do
not become public evidence links. Storage Rules use supported Firestore
document checks:
<https://firebase.google.com/docs/storage/security/rules-conditions>.

## Content removal and restoration

The website moderation Function now:

1. copies original content fields into server-only moderation evidence;
2. scrubs user-facing `text`, `body`, `caption`, `title`, and `voiceMemo`;
3. writes `moderationState` (`hidden` or `removed`), server time, action
   reference, and case reference;
4. reconciles conversation previews;
5. dismisses matching announcement notifications;
6. restores from restricted evidence only for an authorized reversal.

Mobile decoders treat `hidden` and `removed` as moderated, ignore any stale
content fields, remove voice playback data, and render a neutral localized
English/Spanish tombstone. Pagination and live listeners normalize every
record, so cached or legacy fields cannot revive the text. Playback-grant and
HTTP-stream checks reject moderated content.

No composite Firestore index is required for this implementation.

## Client session and user experience

- `AccountStandingContext` loads standing before normal providers, listens to
  the safe projection, refreshes on foreground, and refreshes when temporary
  expiration is reached. It reads safe standing before forcing a token refresh
  for active/limited accounts. It intentionally does not force-refresh a
  serious restriction first, because revoked refresh credentials must not hide
  the suspension/ban and appeal shell behind a generic authentication error.
- `AccountStandingBoundary` provides localized English/Spanish messaging
  restriction, suspension, ban, expiration/refresh, and failed-refresh states.
- Serious restrictions clear user-scoped private caches while preserving the
  Firebase authentication record needed for appeal, legal links, support, and
  deletion.
- Serious restrictions unmount normal listeners and prevent reconnect or
  background restoration.
- A failed standing refresh fails closed to a retry/sign-out screen.
- Messaging-restricted users may acknowledge the notice and enter permitted
  read-only areas; backend/Rules enforcement remains authoritative.
- The restricted shell exposes the public reason only, applicable dates,
  community guidelines/support, Privacy, Terms, appeal, sign-out, and account
  deletion. It does not expose reporter identity, moderator identity, evidence,
  child information, internal severity, or private notes.
- Accessibility uses semantic buttons/links, accessible labels, scalable text,
  existing high-contrast design tokens, and keyboard-safe appeal input.

## Appeals

An affected signed-in user can submit one appeal for the current standing
revision with a 20-1,500 character explanation. The callable:

- verifies current standing and self identity;
- rate-limits attempts;
- prevents duplicate appeals for the same revision;
- stores the appeal under server authority;
- returns a safe confirmation and pending/resolved state;
- exposes no other user's appeal.

Support remains available at `joann@joinsidelinesocial.com`.

## Blocking

Backend and Rules verification proves that blocking is bidirectional for
direct messages, friend requests, discovery/suggestions, personal
notifications, and new private coach-parent conversation creation. Staff or
coach roles do not override a direct safety block.

Essential official team announcements are preserved because team membership is
an organizational channel rather than a private friendship. The remaining
owner decision is shared friend-group behavior after two existing members
block one another: automatic removal, mutual message suppression while both
remain, or group exit/transfer. The implementation does not silently invent
that product policy. Existing direct/private contact remains blocked.

## Verification completed

Final local verification passed:

- Root TypeScript.
- Functions TypeScript build.
- ESLint with zero findings; only the existing legacy-config notice.
- All 81 registered root test commands passed sequentially. This includes every
  unit, source/configuration, Firestore Rules, RTDB Rules, Storage Rules, and
  multi-service Firebase emulator command currently registered in `package.json`.
- The new account-standing Auth/Firestore/RTDB/Storage/Functions suite,
  including active parent, coach, staff, messaging restriction, suspension,
  ban, blocked user, ordinary standing forgery, emulator-only moderator/admin
  identities, stale authentication, refresh-token revocation, artifact
  cancellation, direct-SDK denial, appeal deduplication, safety reporting and
  blocking, expiration, authorized restoration plus reauthentication, and
  anonymous denial. The test loads the production RTDB Rules into the exact
  namespace used by the Functions emulator before evaluating reads.
- Existing friend, team/private/voice, report/block, notification, game,
  Squad, rule, and account-deletion regressions.
- Website moderation Functions TypeScript build and two unit tests.
- Website moderation Auth/Firestore/RTDB/Storage/Functions emulator suite.
- English/Spanish game and moderation resources through TypeScript, lint, and
  production exports.
- Fresh production-mode iOS and Android JavaScript exports. The registered
  legal-release checks separately validated the exact Privacy, Terms, Support,
  and `mailto:` destinations.
- Secret-pattern scans in both repositories: no private-key/token pattern and
  no tracked non-example `.env` file.
- `git diff --check` in both repositories.

Expected `PERMISSION_DENIED` emulator messages correspond to negative Rules
assertions. An interrupted first mobile emulator attempt left two verified
Java emulator processes on ports 8080 and 9000; only those exact processes were
stopped, the ports were verified clear, and the clean reruns passed.

Not performed:

- Firebase deployment or production-data testing.
- Moderator-role or custom-claim creation.
- App Check enforcement.
- EAS/native build, TestFlight, App Store upload, or submission.
- Physical iOS/Android assistive-technology testing.
- Production moderator workflow smoke test.

## Older installed-client compatibility

- Backend capability checks and Rules protect older clients immediately.
- Scrubbed moderated records and playback denial prevent old clients from
  recovering removed content.
- Older clients do not have the calm restricted-account/appeal UI; they may
  display permission errors until a compatible binary is installed.
- `expo-updates` is not configured, so this client UI cannot be delivered by
  OTA update. A new native iOS and Android build is required to ship it.
- Deploy backend enforcement before enabling real moderator actions. Do not
  make the moderation console operational while production users can receive
  sanctions but lack the compatible restricted shell.

## Required deployment order and exact later commands

These commands are documentation only. They were not run.

### 1. Review and deploy the mobile Functions reader/enforcer

```powershell
Set-Location C:\Dev\Sideline_Social_Code
npm.cmd --prefix functions run build
npx.cmd firebase-tools@latest deploy --project sideline-squad --only functions
```

### 2. Deploy the coordinated Firestore, RTDB, and Storage Rules

```powershell
Set-Location C:\Dev\Sideline_Social_Code
npx.cmd firebase-tools@latest deploy --project sideline-squad --only "firestore:rules,database,storage"
```

No index deployment is required.

### 3. Deploy the moderation writer only after the reader/trigger and Rules

```powershell
Set-Location C:\Users\joann\.codex\.chatgpt-projects\g-p-6a610d7964dc81918f737bb6e430b5b2\sideline-social-website
npm.cmd run moderation:functions:build
npx.cmd firebase-tools@latest deploy --config firebase.json --project sideline-squad --only functions:moderation
```

### 4. Build and install compatible clients

After review, commit, production environment validation, and owner approval:

```powershell
Set-Location C:\Dev\Sideline_Social_Code
npx.cmd eas-cli@latest whoami
npx.cmd eas-cli@latest env:list --environment production
npx.cmd eas-cli@latest build --platform ios --profile production
npx.cmd eas-cli@latest build --platform android --profile production
```

Because Expo Updates is not configured, there is no valid OTA release command
for these client changes.

### 5. Provision operations, then deploy the console

Only after approved moderator roles, MFA, alert delivery, response coverage,
and production smoke-test accounts exist:

```powershell
Set-Location C:\Users\joann\.codex\.chatgpt-projects\g-p-6a610d7964dc81918f737bb6e430b5b2\sideline-social-website
npm.cmd run admin:build
npx.cmd firebase-tools@latest deploy --config firebase.json --project sideline-squad --only hosting:moderation-admin
```

App Check should be observed and staged separately; enforcement must not be
enabled as an incidental part of this rollout.

## Rollback

1. Disable operator moderation actions and alert-triggered handling first.
2. Keep canonical standing records intact; do not bulk-delete safety history.
3. Redeploy the prior moderation writer if writer behavior caused the incident.
4. Redeploy the prior mobile Functions revision, then the prior coordinated
   Firestore/RTDB/Storage Rules revision.
5. Restore a prior client build through normal store release controls if the
   restricted shell caused a client defect.
6. Confirm active accounts, restricted accounts, appeals, reports, blocking,
   playback denial, and notification suppression after each rollback stage.
7. Preserve audit/evidence data according to the approved retention/legal-hold
   policy.

Do not use destructive Git resets or remove standing/audit data as a rollback
shortcut.

## Remaining owner decisions and App Store blockers

1. Approve response-time targets, on-call coverage, escalation, and handoff for
   Joann (`joann@joinsidelinesocial.com`) and J. Garcia
   (`info@joinsidelinesocial.com`).
2. Approve and provision the two moderator identities, least-privilege roles,
   MFA/Identity Platform configuration, and recovery process.
3. Select and verify production alert delivery.
4. Approve report/evidence/appeal/audit retention, legal holds, and minimum ban
   marker duration.
5. Approve permanent-ban criteria, appeal finality, and restoration.
6. Decide shared friend-group blocking semantics and confirm the separate
   official-team-announcement policy.
7. Complete physical iOS/Android accessibility and stale/offline-session
   testing.
8. Perform a benign production-like report-to-removal-to-appeal smoke test
   before App Review.
9. Produce, inspect, and install signed native client builds. No OTA path is
   configured.
10. Complete the other P1/App Store Connect, privacy, age, reviewer-account,
    invite-code, deletion-retention, dependency, and archive checks in the main
    readiness report.

## Changed files

Mobile working tree:

- `app/(social)/chat/[chatId].tsx`
- `app/_layout.tsx`
- `components/AccountStandingBoundary.tsx`
- `components/PrivateTeamMessageThread.tsx`
- `context/AccountStandingContext.tsx`
- `database.rules.json`
- `firestore.rules`
- `functions/src/accountDeletion.ts`
- `functions/src/accountStanding.ts`
- `functions/src/contentModeration.ts`
- `functions/src/friendChat.ts`
- `functions/src/gameJoinCodes.ts`
- `functions/src/index.ts`
- `functions/src/permanentAuth.ts`
- `functions/src/pushNotificationDelivery.ts`
- `functions/src/squadAdmin.ts`
- `functions/src/squadSeason.ts`
- `functions/src/triviaGame.ts`
- `i18n/index.ts`
- `package.json`
- `scripts/test-account-standing-emulator.cjs`
- `scripts/test-game-join-code-rtdb-rules.cjs`
- `scripts/test-start-mode-onboarding-core.cjs`
- `services/accountStandingService.ts`
- `services/chatService.ts`
- `services/localUserStateService.ts`
- `services/parentTeamService.ts`
- `services/teamMessageService.ts`
- `services/teamPrivateMessageService.ts`
- `storage.rules`
- `types/accountStanding.ts`
- `types/teamVoiceMessaging.ts`
- `docs/ios-app-store-readiness-report.md`
- `docs/mobile-moderation-enforcement-report.md`

Moderation website working tree:

- `moderation-functions/src/index.ts`

## Final Git and external-state record

At report creation:

- Mobile branch: `main`
- Mobile `HEAD` / `origin/main`:
  `e764f92e07c923a8ad8de649af7b119a57676144`
- Moderation branch: `main`
- Moderation `HEAD` / `origin/main`:
  `067bd82bd987cd82e84c6b1e11be7de0ba1af967`
- Both working trees are intentionally dirty with the files listed above.
- No unrelated uncommitted work was reverted.
- Temporary export output was removed after verification.
- No Firebase deployment occurred.
- No production data changed.
- No production moderator role or custom claim changed. Moderator/admin claims
  were created only inside isolated Auth emulator data and were discarded when
  the suite shut down.
- No App Check enforcement changed.
- No EAS build or App Store action occurred.
- No commit or push occurred.
