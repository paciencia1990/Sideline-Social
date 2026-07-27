# Sideline Social Cloud Functions Node.js 22 migration

Date: 2026-07-27

Repository: `C:\Dev\Sideline_Social_Code`

Firebase project: `sideline-squad`

Primary region: `us-central1`

## Migration status

**Ready for review and ready for an explicitly authorized non-production deployment.**

The code, configuration, dependency tree, clean install, build, trigger discovery, packaging dry run, and complete local emulator matrix pass under Node.js 22.23.1. Production was not deployed and its 106 Functions remain on Node.js 20.

Production deployment remains blocked until all of the following are complete:

1. An operator confirms in the Firebase console that `sideline-squad` is currently on the Blaze plan. The Firebase CLI does not expose the plan label. The 106 active Functions and 11 active scheduled Functions are operational evidence of paid Functions/Cloud Scheduler use, and Firebase requires Blaze for Functions deployment, but the plan must still be checked directly before deployment.
2. This migration is reviewed and committed so there is an immutable rollback point.
3. A monitoring window and responsible operator are selected.
4. Production deployment is explicitly authorized.

No safe non-production Firebase project is configured. The `sideline-*-test` project IDs used by scripts are synthetic emulator namespaces, not deployment targets.

## 1. Previous runtime

Before this task:

- `functions/package.json` declared Node.js 20.
- `functions/package-lock.json` recorded Node.js 20 at the lockfile root.
- `firebase.json` did not explicitly declare a Functions runtime.
- Production contained 106 active first-generation Functions on `nodejs20`, all in `us-central1`.
- The Functions dependency tree had been installed and tested under Node.js 20 during the preceding release-hardening audit.

Initial repository state:

- Branch: `main`
- Commit: `f417d16f40e7b41deab44dec437fd951cd2c0673`
- Commit subject: `Harden release configuration and data protection`
- Working tree: clean
- `AGENTS.md`: not present

## 2. New runtime

The Functions codebase now declares Node.js 22 consistently:

- `functions/package.json`: `"engines": { "node": "22" }`
- `firebase.json`: `"runtime": "nodejs22"`
- `functions/.nvmrc`: `22.23.1`
- `functions/package-lock.json`: root engine metadata is Node.js 22
- Local verification: Node.js 22.23.1 and npm 10.9.8
- Firebase CLI used for verification: 15.24.0

Toolchain audit:

| Context | Node.js | npm | Firebase CLI |
| --- | ---: | ---: | ---: |
| Initial root Expo shell | 24.16.0 | 11.13.0 | Not installed globally for that NVM runtime |
| Functions migration verification | 22.23.1 | 10.9.8 | 15.24.0 |

No `.github` CI workflow directory is present. The existing EAS build profiles were inspected and remain on the separate Expo Node.js 24.16.0 toolchain.

Firebase documents Node.js 22 as a supported Functions runtime and requires Firebase CLI 11.18.0 or later for runtime upgrades:

- <https://firebase.google.com/docs/functions/manage-functions#set_nodejs_version>
- <https://firebase.google.com/docs/functions/get-started>

The root Expo application remains intentionally separate:

- Root `.nvmrc`: `24.16.0`
- Root `.node-version`: `24.16.0`
- Root `package.json`: Node.js `>=22.13 <25`
- Every EAS profile: Node.js `24.16.0`

No root Expo/EAS runtime setting changed.

## 3. Configuration files changed

| File | Change |
| --- | --- |
| `functions/package.json` | Runtime engine changed from 20 to 22; Node type declarations changed from major 20 to 22. |
| `functions/package-lock.json` | Root runtime metadata updated; `@types/node` resolved to 22.20.1; a redundant nested copy was deduplicated. |
| `functions/.nvmrc` | Added an exact local Functions toolchain pin: 22.23.1. |
| `firebase.json` | Added explicit `nodejs22` runtime while preserving source and predeploy build behavior. |
| `package.json` | Added the isolated clean Node 22 install/build regression command. |
| `scripts/test-functions-packaging.cjs` | Added agreement, runtime, lockfile, type, pin, and root-runtime-isolation assertions. |
| `scripts/test-functions-node22-reproducibility.cjs` | Added a safe temporary-copy `npm ci` and TypeScript build test. |

No function source, exported name, trigger, region, generation, schedule, retry policy, memory, timeout, IAM setting, secret binding, callable contract, or business logic changed.

## 4. Dependency changes and compatibility

Runtime dependencies were deliberately not upgraded:

| Package | Locked version | Declared Node engine | Node 22 result |
| --- | ---: | --- | --- |
| `firebase-functions` | 5.1.1 | `>=14.10.0` | Build, discovery, packaging, and all emulator suites pass. |
| `firebase-admin` | 12.7.0 | `>=14` | Firestore, RTDB, Auth, Storage, notification, and deletion tests pass. |
| `geofire-common` | 6.0.0 | Not restricted | Squad location tests pass. |
| TypeScript | 5.9.3 | `>=14.17` | Clean and in-place builds pass. |

The only dependency change is development-only:

- `@types/node`: 20.19.43 -> 22.20.1

The lock contains 241 installed packages. `protobufjs` is the only locked package marked with an install script; it installed successfully. No locked package declares a platform/CPU restriction, no native Node add-on failed, and no root-package junction or `file:..` dependency exists.

Source review found:

- CommonJS output remains unchanged.
- Node crypto APIs use supported `node:crypto` entry points.
- No deprecated `new Buffer`, `process.binding`, legacy cipher, `url.parse`, or `punycode` use.
- Active runtime source has no dynamic provider import.
- The only global `fetch` use is in the disabled Coach AI implementation outside the runtime import graph; Node 22 supports it.
- Firestore `Timestamp`, server timestamp, Date, URL, timer, stream, Buffer, callable-error, and serialization behavior is covered by the regression/emulator matrix.
- Active source has no secret bindings. The disabled Coach AI implementation declares secrets but is not imported by `functions/src/index.ts`; the active compatibility stub is non-secret.

No Node 22 incompatibility required a runtime dependency or business-logic change.

### Audit advisories

`npm audit` reports:

- 0 critical
- 0 high
- 9 moderate
- 0 low

Affected packages:

- Direct: `firebase-admin`, `firebase-functions`
- Transitive: `@google-cloud/firestore`, `@google-cloud/storage`, `gaxios`, `google-gax`, `retry-request`, `teeny-request`, `uuid`

The suggested direct remediation requires `firebase-admin` 14.2.0 and a semver-major Firebase Functions change; the CLI currently suggests a 7.3.2 release candidate for the Functions remediation path. That is a separate breaking dependency migration, not a Node 22 prerequisite. No `npm audit fix` or forced upgrade was run.

## 5. Lockfile and reproducibility

The lockfile update is intentionally small:

- Functions root engine: 20 -> 22
- `@types/node` declaration: `^20.0.0` -> `^22.0.0`
- `@types/node` resolution: 20.19.43 -> 22.20.1
- Redundant `firebase-admin/node_modules/@types/node` entry removed because the top-level Node 22 types now satisfy both consumers

Verified under Node.js 22.23.1:

```powershell
Set-Location C:\Dev\Sideline_Social_Code
nvm use 22.23.1
npm.cmd --prefix functions ci --no-audit --no-fund
npm.cmd run test:functions-packaging
npm.cmd run test:functions-node22-reproducibility
```

Results:

- Clean install: 241 packages
- Root app dependency link: absent
- Absolute/developer-machine paths: absent
- Parent `file:` dependency: absent
- Temporary clean install: passed
- Temporary clean TypeScript build: passed
- In-place TypeScript build: passed
- Recursive junction/packaging issue: absent

## 6. Functions and triggers reviewed

Read-only Firebase CLI inventory before deployment:

| Generation | Runtime | Region | State | Count |
| --- | --- | --- | --- | ---: |
| First generation (`gcfv1`) | `nodejs20` | `us-central1` | Active | 106 |

Trigger counts:

- Callable HTTPS: 87
- Firestore/Auth-style event triggers: 7
- Scheduled Pub/Sub triggers: 11
- Plain HTTPS request trigger: 1

The Node 22 build exports exactly 106 functions. A direct sorted-name comparison found:

- Missing local exports: 0
- Extra local exports: 0
- Region metadata: `us-central1`

All deployed Functions share the generation, runtime, region, and active state shown above:

`acknowledgeNotificationOpened`, `activateWeeklyChallenge`, `blockFriendChatUser`, `cancelFriendRequest`, `cancelSquadAdminInvitation`, `cleanupAbandonedTeamVoiceUploads`, `cleanupExpiredGameJoinCodes`, `cleanupExpiredGameSessions`, `cleanupExpiredUserNotifications`, `cleanupExpoPushReceipts`, `clearUserNotifications`, `completeWeeklyChallenge`, `createFriendGroupConversation`, `createGameJoinCode`, `createGameRewardSession`, `createOrOpenDirectConversation`, `createSquadSeason`, `createTeamAnnouncement`, `createTeamAnnouncementReply`, `createTeamVoiceMemoUpload`, `deactivateInactiveMembers`, `deleteChildProfile`, `deleteOwnAccount`, `deletePrivateTeamMessage`, `deleteTeamAnnouncement`, `deleteTeamAnnouncementReply`, `endSquadSeason`, `expirePendingFriendRequests`, `expireSquadAdminInvitations`, `finalizeGameReward`, `finalizePrivateTeamVoiceMessage`, `finalizeTeamVoiceAnnouncement`, `findNearbyVenueSportSquads`, `findOrCreateVenueSportSquad`, `generateCoachResourceHelp`, `getActiveFriendRequests`, `getActiveSquadGameSession`, `getBlockedFriendChatUserIds`, `getCurrentWeeklyChallenge`, `getEligiblePrivateTeamParents`, `getGameJoinCodeForSession`, `getOrCreatePrivateTeamConversation`, `getPublicUserProfiles`, `getSquadAdministration`, `getSquadLeaderboard`, `getSquadSeasons`, `getSuggestedConnections`, `getTeamAnnouncementRecipientCounts`, `getTeamPrivateMessageInbox`, `getTeamVoiceMemoDownloadUrl`, `hidePrivateTeamMessageForCurrentUser`, `inviteFriendsToGroupConversation`, `inviteSquadAdmin`, `joinParentTeamByInviteCode`, `joinVenueSportSquad`, `leaveFriendConversation`, `leaveParentTeam`, `leaveVenueSportSquad`, `markFriendConversationRead`, `markPrivateTeamConversationRead`, `notifyParentsOfTeamAnnouncement`, `onFriendRequestAccepted`, `onFriendRequestCreated`, `onSquadMemberJoined`, `projectRewardToSquadSeasons`, `recordGameSessionResult`, `recordSpotDifferenceFound`, `refreshSquadPresence`, `registerDeviceNotificationToken`, `releaseGameJoinCode`, `removeFriendConnection`, `removeFriendGroupMember`, `removeOwnFriendChatMessage`, `removeSquadAdmin`, `renameFriendGroupConversation`, `reportFriendChatMessage`, `reportFriendChatUser`, `reportTeamContent`, `requestSquadAdminAccess`, `resolveAndJoinGameByCode`, `respondToFriendGroupInvitation`, `respondToFriendRequest`, `respondToSquadAdminInvitation`, `reviewSquadAdminAccessRequest`, `searchPublicUserProfiles`, `searchVenueSportSquads`, `sendFriendChatMessage`, `sendFriendRequest`, `sendPrivateTeamTextMessage`, `sendWeeklyChallengeNotification`, `setFriendConversationMuted`, `setFriendGroupAdminRole`, `setParentTeamChildLinks`, `setSelectedSquad`, `setTeamArchived`, `setTeamStaffRole`, `streamTeamVoiceMemo`, `syncPublicUserProfile`, `syncSquadSeasonStates`, `transferFriendGroupOwnership`, `unblockFriendChatUser`, `unregisterDeviceNotificationToken`, `updateActiveMemberCount`, `updateGameJoinCodeStatus`, `updatePublicUserProfile`, `updateSquadSeason`.

Explicit runtime options were reviewed and not changed:

- Coach AI compatibility callable: 30 seconds, 256 MB
- Account deletion callable: 540 seconds, 1 GB
- Content reporting callable: 60 seconds, 256 MB
- Team messaging/voice functions: 30 seconds, 256 MB

All other source-defined schedules, regional wrappers, and trigger types remain unchanged.

## 7. Tests and emulators run

Every command in this section ran while `node --version` reported `v22.23.1`.

| Gate | Result |
| --- | --- |
| Functions clean `npm ci` | Passed |
| Functions dependency tree | Passed |
| Functions TypeScript build | Passed |
| Functions static packaging/isolation test | Passed |
| Functions temporary clean-install/build test | Passed |
| Function export discovery | 106 / 106; exact deployed-name match |
| Non-emulator registered test scripts | 52 / 52 passed |
| Functions emulator scripts | 10 / 10 passed |
| Firestore/RTDB/Storage rules scripts | 14 / 14 passed |
| Root TypeScript check | Passed |
| Root ESLint | Passed with zero findings |

Functions emulator suites:

1. Account deletion
2. Coach Resources
3. Friend chat
4. Friend request lifecycle
5. Friend search
6. JOIN code and multiplayer
7. Notifications
8. Sideline Stars, rewards, challenges, and Squad seasons
9. Squad administration
10. Team announcements, private coach-parent messages, and voice messages

Rules emulator suites:

- Global activity
- Announcement deletion
- Coach AI collections
- Friend chat
- Friend requests
- Game JOIN-code Firestore
- Notifications
- Parent Teams
- Squads
- Team messaging
- Trivia
- Weekly Challenge
- JOIN-code Realtime Database
- Team voice Storage

Covered behavior includes authentication, account deletion, callable error codes, response serialization, timestamp/date handling, notification counts, Firestore/RTDB/Storage writes, idempotency, scheduled-function logic, friend search/request lifecycle, Team/Staff announcements, private coach-parent messaging, voice finalization/playback authorization, JOIN codes, multiplayer state, rewards, challenges, and security rules.

The prior release-hardening report recorded the equivalent Node 20 matrix as passing. Node 22 produced the same contract assertions and emulator outcomes. The new 52nd non-emulator test is the Node 22 clean-install/build gate.

## 8. Packaging results

Firebase CLI 15.24.0 deployment dry run:

```powershell
npx.cmd --yes firebase-tools@latest deploy --project sideline-squad --only functions --dry-run --non-interactive
```

Result:

- Predeploy TypeScript build: passed
- Trigger source analysis: passed
- All Functions discovered: passed
- Package size: 409.54 KB
- Historical Node 20 package size: 409.53 KB
- Root application assets included: no
- Upload/deployment: not performed

The 0.01 KB reported difference is immaterial runtime metadata churn. No bundle-size regression was found.

## 9. Non-production deployment

Not performed.

Reasons:

- No safe non-production Firebase project is configured in `.firebaserc`.
- Synthetic emulator project IDs are not deployable environments.
- The task did not authorize a deployment.

When a real isolated project is available, deploy all Functions together there, verify all 106 report `nodejs22`, and run callable/event/schedule smoke tests before production.

## 10. Remaining warnings and risks

### Expected warnings

- Firebase CLI says `firebase-functions` 5.1.1 is outdated and warns that upgrading has breaking changes.
- `npm ci` warns that transitive UUID versions are deprecated.
- Synthetic emulator projects cannot fetch Admin SDK project configuration.
- Emulator runs warn about services intentionally omitted from each suite.
- App Check is `MISSING` in local callable fixtures where enforcement is not enabled.
- Scheduled functions are ignored when a suite does not start Pub/Sub.
- The JOIN-code emulator reports a known synthetic-namespace RTDB index warning.
- Rules negative tests log expected permission-denied messages.
- Root lint reports the existing legacy ESLint configuration warning.

None is a Node 22 runtime, trigger-discovery, module-resolution, serialization, or test failure.

### Deployment risks

- Production still runs Node 20 until all Functions are redeployed.
- Exact Blaze plan status must be confirmed in the Firebase console before deployment.
- There is no non-production Firebase deployment result.
- Deploying 106 first-generation Functions together can encounter deployment quotas; establish a monitoring window and be prepared to retry safely without changing names or regions.
- The nine moderate dependency advisories remain and require a separate major SDK evaluation.
- Deployed-source parity cannot be proven solely from Function names and metadata; the post-deployment smoke plan is required.

## 11. Production deployment command

Do not run without explicit authorization:

```powershell
Set-Location C:\Dev\Sideline_Social_Code
nvm use 22.23.1
node --version
npm.cmd --prefix functions ci --no-audit --no-fund
npm.cmd --prefix functions run build
npm.cmd run test:functions-packaging
npm.cmd run test:functions-node22-reproducibility
firebase.cmd functions:list --project sideline-squad
firebase.cmd deploy --project sideline-squad --only functions
```

Pre-deployment operator checklist:

1. Confirm `node --version` is 22.x.
2. Confirm the reviewed/committed migration is the current clean working tree.
3. Confirm `sideline-squad` and `us-central1`.
4. Confirm the Blaze plan in Firebase console.
5. Confirm active runtime source requires no secrets; do not enable the disabled Coach AI implementation.
6. Confirm the package contains only Functions source/dependencies.
7. Confirm all 106 local exports match the current deployed inventory.
8. Confirm the complete Node 22 matrix is still green.
9. Record the rollback commit.
10. Start the monitoring window.

## 12. Post-deployment smoke tests

Immediately after an authorized deployment:

1. Run `firebase.cmd functions:list --project sideline-squad --json`.
2. Confirm exactly 106 active Functions.
3. Confirm every Function reports `nodejs22`, `gcfv1`, and `us-central1`.
4. Diff names against the baseline in section 6; there must be no addition, deletion, rename, or region move.
5. With disposable test accounts, verify:
   - authentication and expected unauthenticated errors;
   - `searchPublicUserProfiles` and `getActiveFriendRequests`;
   - send/respond/cancel friend request;
   - Coach/Staff recipient counts;
   - private Team text and voice upload/finalization/playback;
   - JOIN-code create/resolve/status/release;
   - reward session/result/finalization;
   - current/complete Weekly Challenge;
   - account deletion retry behavior.
6. Trigger a test Firestore event for public profile synchronization and a permitted announcement event.
7. Verify all schedules remain registered with unchanged schedules.
8. Monitor startup failures, error rate, callable `internal` errors, cold starts, p95 latency, notification recipient counts, and trigger retries.
9. Inspect logs specifically for module resolution, serialization, crypto/URL, stream, timestamp, and authentication-context differences.

Do not use production child data or unrelated production users for smoke tests.

## 13. Rollback procedure

Node 20 is a time-limited rollback target. It reaches decommission on 2026-10-30 and cannot be treated as durable after that date. Prefer correcting a Node 22 problem.

Before deployment, commit this migration so the prior commit and migration commit are immutable.

If rollback is required while Node 20 deployment is still supported:

1. Revert the Node 22 migration commit. This restores:
   - `functions/package.json`
   - `functions/package-lock.json`
   - `firebase.json`
   - Functions runtime/test documentation and pins
2. Activate the previously verified Node 20 toolchain.
3. Run a clean Functions `npm ci`.
4. Run the previous Functions build, packaging, export, and complete emulator matrix.
5. Confirm the local 106 names still match production.
6. Redeploy all Functions:

```powershell
firebase.cmd deploy --project sideline-squad --only functions
```

7. Confirm all 106 functions remain first generation in `us-central1` and report `nodejs20`.
8. Repeat the critical smoke tests and monitoring checks from section 12.

After 2026-10-30, do not attempt Node 20 rollback. Restore the last known Node 22 configuration and correct or revert the incompatible code/dependency change instead.

Runtime lifecycle reference:

- <https://docs.cloud.google.com/functions/docs/runtime-support>

## 14. Exact files changed

1. `firebase.json`
2. `functions/.nvmrc`
3. `functions/package.json`
4. `functions/package-lock.json`
5. `package.json`
6. `scripts/test-functions-packaging.cjs`
7. `scripts/test-functions-node22-reproducibility.cjs`
8. `docs/release-hardening-report.md`
9. `docs/node-22-functions-migration.md`

No production deployment, production data modification, function source change, commit, or push was performed.
