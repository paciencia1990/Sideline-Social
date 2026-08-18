# Sideline Social Performance and Refactor Report

Date: 2026-08-18
Repository: `C:\Dev\Sideline_Social_Code`
Branch: `main`
Baseline commit: `81fd72a32a9dc412576dd14fbe06069509b457c4` (matched `origin/main`)

## 1. Executive summary

This pass found several concrete sources of avoidable latency: overlapping membership loads, duplicate account-standing requests during startup, repeated reads of the same user team index, serial work in parent team summaries, an authenticated-startup storage read that was only needed for signed-out users, and unstable provider values that could rerender broad parts of the app.

The implemented changes are deliberately narrow. They coalesce only overlapping, same-user requests, run independent work concurrently, stabilize two high-level context values, remove one provably unused startup font, and add development-only timing diagnostics with fixed labels and durations. They do not change Firebase Rules, data shapes, authorization, moderation, account-standing behavior, game content, media behavior, or production logging.

Correctness evidence is strong: 69 registered non-emulator regression scripts passed, five focused Firebase emulator suites passed, TypeScript and ESLint passed, both platform exports succeeded, and Android release backup validation succeeded. Full authenticated flow timing on the new JavaScript remains outstanding because the attached production app was built before these changes. The report therefore describes request reductions as structural improvements and does not convert them into invented milliseconds.

Store-release readiness is separate from the performance verdict. The local production legal gate still lacks the three required public legal URL environment variables, and the local iOS environment does not contain the native Google services plist. Those values may exist remotely, but that was not assumed or exposed.

## 2. Baseline measurements

### Environment

| Area | Version/configuration |
| --- | --- |
| Local Node/npm | Node 22.23.1, npm 10.9.8 |
| EAS profile Node | 24.16.0 |
| Expo | SDK 57.0.14; CLI 57.0.16 |
| React Native / React | 0.86.2 / 19.2.3 |
| Firebase JavaScript | declared `^10.12.5`; installed 10.14.1 |
| Functions runtime | Node 22 |
| Functions packages | firebase-admin 12.7.0; firebase-functions 5.1.1 |
| TypeScript | 5.9.3 |
| Firebase Functions region | `us-central1` |
| Architecture | React Native New Architecture enabled |

No `AGENTS.md` was present in the repository or its inspected parent directories. The worktree was clean before this task.

### Attached Android device

Device: Samsung SM-S931U1, Android 16. The installed production package was `com.sidelinesquad.app`, version 1.0.0 build 14, release/non-debuggable. The development package was also present.

Five force-stop production Activity launches reported total first-frame times of 625, 364, 437, 352, and 367 ms: median 367 ms, slowest 625 ms. Five warm Activity re-entries reported wait times of 4, 3, 4, 2, and 2 ms: median 3 ms, slowest 4 ms.

These Android framework timings end at Activity display. They do not prove time to usable authenticated Home or network-dependent screen readiness. The installed app predates this change, and release logging cannot safely provide the new per-flow diagnostics. All other flows in the requested matrix remain device-measurement items in section 16.

### Baseline exports

| Export | Modules | Hermes bundle | Total export files |
| --- | ---: | ---: | ---: |
| Android | 3,876 | 10,156,015 bytes | 21,745,820 bytes |
| iOS | 3,787 | 9,957,491 bytes | 20,585,406 bytes |

Clean-cache Metro times were 43,665 ms on Android and 37,278 ms on iOS. These are development-machine bundling measurements, not app runtime measurements.

## 3. Root causes of observed slowness

1. The global Squad provider loads memberships when the authenticated user changes, while focused screens can request the same data before that load completes. The old code allowed both full request chains to run.
2. Startup could request account standing from both the initial refresh and the first listener-driven refresh. The old service had no in-flight request coalescing.
3. Team list screens request active memberships and archived counts together. Both paths independently read the same `users/{uid}` team index.
4. Parent team summary construction queried announcements, then serially resolved author profiles, read documents, and coach identity. The phases were independent after the announcement query.
5. Authenticated root routing read the signed-out onboarding storage key before checking whether a user existed.
6. App and Squad context provider values were new objects on every provider render, making unrelated consumers eligible to rerender.
7. The root font gate loaded Space Mono even though no application source referenced it.
8. Parent team announcement history and read-state resolution are unbounded and N+1. Team/private-message and schedule listeners also contain unbounded paths. These are likely long-term latency and memory contributors but require pagination or summary-schema design, so they were not changed here.
9. Friends has three listeners that can each trigger a full multi-request refresh after initial hydration. Existing stale-response protection helps correctness but does not provide trailing refresh coalescing.
10. Functions has large, eagerly imported modules. `functions/src/index.ts`, game join-code logic, and friend-chat logic are large enough to be plausible cold-start contributors. No paid `minInstances` or risky export reorganization was introduced.

## 4. Before-and-after results

| Flow/change | Before | After | Evidence and limitation |
| --- | --- | --- | --- |
| Authenticated root route | One unnecessary `AsyncStorage` onboarding read | No onboarding read for authenticated users | Static control-flow test; timing pending device trace |
| Overlapping Squad hydration | Two complete loads possible | One same-user in-flight load | Avoids one user document plus N squad documents for each overlap |
| Squad state hydration | Firestore user read, then local selected-squad read | Independent reads run concurrently | Same reads and output; shorter critical path structurally |
| Account-standing overlap | Two callable invocations possible | One same-user in-flight callable | Promise clears on completion/error; timing pending device trace |
| Active/archived team index | Two user-index reads possible | One same-user in-flight user-index read | Avoids one Firestore user-document read during overlap |
| Parent team post-query phases | Three serial phases | Author profiles, read states, and coach identity run together | Same request count and data; reduced network critical path structurally |
| Context propagation | New App/Squad provider value each render | Memoized values tied to actual dependencies | Fewer avoidable broad consumer rerenders; render profiling pending |
| Root fonts | Space Mono loaded before splash completion | Unused Space Mono no longer loaded | Removes a 93,252-byte exported asset and one font registration |
| Android total export | 21,745,820 bytes | 21,656,258 bytes | Down 89,562 bytes (0.41%) |
| iOS total export | 20,585,406 bytes | 20,496,918 bytes | Down 88,488 bytes (0.43%) |
| Android Hermes bundle | 10,156,015 bytes | 10,159,769 bytes | Up 3,754 bytes (0.04%) from diagnostics/refactor code |
| iOS Hermes bundle | 9,957,491 bytes | 9,962,319 bytes | Up 4,828 bytes (0.05%) from diagnostics/refactor code |

Post-change clean-cache Metro times were 43,999 ms on Android and 45,191 ms on iOS. The iOS variation demonstrates why clean-cache bundling time should not be presented as user-facing startup performance. Module counts remained unchanged.

## 5. Firebase read/listener/callable analysis

- Firebase is initialized once through `config/firebase.ts`; no duplicate app initialization was found.
- Client Functions and deployed Functions consistently use `us-central1` in the audited paths.
- Squad overlap coalescing is keyed to the authenticated user and lasts only for the active promise. It does not cache stale data.
- Account-standing coalescing uses the same constraints. Requests without a known UID are deliberately not shared.
- Team-index coalescing removes only overlapping duplicate reads and clears after success or failure.
- Parent summary parallelism changes latency, not request count or authorization. Announcement read-state documents are still loaded individually.
- Friend chat uses bounded initial/message-page queries in the inspected paths. Secure image grants and media caching were not weakened or bypassed.
- Parent announcement history, team message listeners, and schedule listeners need explicit limits/pagination. Adding limits without matching UX and server summaries could hide data, so that work is deferred.
- No listener unsubscribe defect was proven in the changed flows. Existing subscriptions use returned cleanup functions, and related regression suites passed.
- No account-standing, Rules, Storage, RTDB, or Functions code was modified.

## 6. Rendering and navigation findings

- `AppContext` and `SquadContext` previously published unstable value objects. Both now memoize only the provider value, where the dependency surface is clear.
- The Home and Friends instrumentation wraps existing asynchronous loads rather than adding state or rerender triggers.
- Several large screens remain: friend chat, Friends, Home, and lobby/game screens. Splitting them is a maintainability opportunity but not automatically a runtime win.
- Many screens use `ScrollView`. Static/small forms are appropriate; growing team, message, and schedule histories should move to virtualized/paginated designs only with keyboard and scroll-position regression coverage.
- Root navigation has multiple legitimate hydration gates for authentication, mode, image-picker recovery, notification routing, and system return routes. The signed-out storage read was moved without changing those priorities.
- No navigation loop was introduced; authentication/navigation, image-picker resume, notification, and keyboard tests all passed.

## 7. Startup analysis

The root layout blocks splash dismissal until essential fonts and provider hydration complete. Authentication profile loading, mode hydration, account standing, and route resolution now expose development-only duration traces. The traces log only a fixed operation name and rounded duration. They do not include UIDs, names, email addresses, messages, coordinates, tokens, routes containing IDs, or document data.

Trace labels cover startup auth profile, mode hydration, account standing, route resolution, membership hydration, Home parent teams, Home weekly challenge, Friends overview, games lobby directory, and related startup paths.

Space Mono was the only font proven unused by application source and was removed from the root loader. Caveat and Playfair italic remain public theme options and were retained to avoid silently breaking future or conditionally rendered branding.

## 8. Bundle and asset analysis

- Repository assets: 75 files, 10,224,864 bytes (9.75 MiB).
- Spot the Differences: 42 WebP files/21 pairs, 8,557,026 bytes (8.16 MiB).
- Spot manifest remained unchanged with combined SHA-256 `db426ddb1f36584fab613c6f964fdbff13f3aeda52b7b3fd96bc701aa1889be4`.
- Largest repository assets include the iOS icon (941,689 bytes), brand logo (522,793 bytes), and Spot scene files (roughly 125-259 KiB each).
- One duplicate pair was found: `assets/images/adaptive-icon.png` and `assets/images/splash-icon.png`, each 17,547 bytes and byte-identical. They are separate configured roles and were retained pending visual/config verification.
- Android exports include a roughly 962 KiB Material Symbols font through Expo Router/Expo Symbols. There is no direct application import proving it can be removed safely.
- Hermes `.hbc` output and production minification are active. No source map was included in the Expo export directories.
- The existing audited AAB is 149.24 MiB, but it is an older artifact (`code5`) and is not a measurement of this working tree.
- Asset/download size, Hermes startup cost, image decode memory, Firebase latency, and React render latency are different concerns. The export reduction does not prove faster Firebase screens.

## 9. Memory/subscription leak findings

No definite listener, timer, keyboard-listener, or AppState-listener leak was found in the modified paths. Existing chat and keyboard lifecycle regression tests passed. The main memory risks are data-volume risks: unbounded team message, announcement, and schedule subscriptions can retain progressively larger snapshots. Those require query and UX changes rather than cleanup-only edits.

The new coalescing state stores only the current promise and user key, and clears in `finally`. It is not a permanent cache and does not retain snapshots.

## 10. Dependency review

- `npx expo install --check`: all Expo-aligned dependencies are current.
- Root `npm ci`: succeeded from the lockfile.
- Functions `npm ci`: succeeded from the lockfile.
- Root production audit: 32 advisories (12 high, 20 moderate, 0 critical).
- Functions production audit: 9 moderate advisories, 0 high/critical.
- No audit finding was ignored silently and no automatic fix was run.
- Root findings include Expo/Metro/config-tooling transitives (`brace-expansion`, `image-size`, `js-yaml`) and Firebase transitives (`protobufjs`, `undici`). Suggested automatic resolutions include breaking Expo/Firebase changes and are not safe in this pass.
- Functions advisories are `uuid` transitives; npm's proposed full resolution requires a major firebase-admin migration.
- Available major updates include Firebase 12, React Native 0.87, firebase-admin 14, firebase-functions 7, TypeScript 7, and ESLint 10. Each needs a separate compatibility/migration task.
- Expo Doctor passed 19 of 21 checks. It warns that checked-in native folders prevent some app-config fields from being automatically synchronized, and React Native Directory has not marked `react-native-nitro-google-signin` as tested on the New Architecture. The project's focused federated-auth and Android release checks pass, so the warning was documented rather than suppressed.
- No dependency, lockfile, SDK, or native module was changed.

## 11. Dead-code and legacy-code inventory

| Candidate | Classification | Reason |
| --- | --- | --- |
| Space Mono root registration | Safe to remove now | No source reference; removed from loader, asset retained |
| Home `i18n` binding used only by a development mount log | Safe to remove now | Removed with the user-identifying log |
| `services/homeFeedService.ts` / `fetchConnectionPrompt` | Safe after focused verification | No runtime import found; tests still reference the service |
| `functions/src/disabled/coachResourceHelp.ts` | Must remain for backward compatibility | Exported compatibility callable despite folder name |
| Duplicate `(games)` and `/games` route families | Must remain for backward compatibility | Current lobby/play and compatibility routing use both patterns |
| Local Perk architecture | Requires product confirmation | Feature flag is off, but tests intentionally preserve future architecture |
| Adaptive/splash duplicate image bytes | Requires visual/config confirmation | Different native roles may intentionally share artwork |
| Large Functions modules | Requires coordinated client/backend release | Export/cold-start refactor could affect deployed callable inventory |
| Unbounded team histories | Requires coordinated client/backend release | Needs pagination/summaries and migration-compatible UI |

No runtime circular dependency was proven in the audited startup/service paths. Generic unused-dependency output was not used as deletion authority because Expo plugins, Babel integration, Firebase tools, and native autolinking frequently appear static-unused.

## 12. Changes implemented

1. Added privacy-safe, development-only timing utilities.
2. Instrumented key startup, Home, Friends, Squad, and lobby-directory operations.
3. Coalesced overlapping same-user Squad membership loads.
4. Coalesced overlapping same-user account-standing callables.
5. Coalesced overlapping same-user team-index document reads.
6. Parallelized Firestore and local selected-Squad hydration.
7. Parallelized independent parent team profile/read/coach phases.
8. Avoided signed-out onboarding storage work for authenticated users.
9. Memoized App and Squad provider values.
10. Removed the unused Space Mono registration from the startup font gate.
11. Removed a development Home log that included a user identifier.
12. Added a focused performance regression script.
13. Corrected three stale auth test assertions after independently confirming that `email-login.tsx` intentionally aliases `sign-in.tsx` and that the real screen uses the shared keyboard/password/button components.

## 13. Deferred architectural recommendations

1. Add paginated/materialized parent team announcement summaries and per-user unread aggregates. This is the highest likely Firebase-read improvement but needs a coordinated schema, Rules, Functions, and client rollout.
2. Add bounded date windows/pagination to team messages and schedules, preserving archived-team access and offline behavior.
3. Coalesce listener-triggered Friends refreshes with a trailing refresh so changes during an active load are not lost and full request groups do not overlap.
4. Capture Hermes/React DevTools traces for Home, Friends, Teams, Chat, Games, and Notifications on a development client and a release-like internal build.
5. Split large Functions exports into lazy, domain-focused modules while preserving names, regions, runtime, and deployed inventory. Do not add `minInstances` without cost approval.
6. Evaluate on-demand scene delivery only as a separate product/offline/cost project. Spot assets dominate install size but were intentionally protected here.
7. Migrate dependency majors in staged SDK/backend tasks, beginning with Firebase/Functions security advisories and a New Architecture validation of Google sign-in.

## 14. Risks and rollback guidance

- Coalescing shares an in-flight result only for the same UID and clears after settlement. If an edge case appears, revert the relevant service/context coalescing independently; no data migration is needed.
- Parent requests now start concurrently, which can create a short burst equal to the same pre-existing request count. Revert only the `Promise.all` grouping if a backend quota pattern appears.
- Context memoization relies on complete dependency lists. TypeScript, ESLint, and the full regression suite passed.
- The removed font registration is low risk because source search found no use. Restore its `useFonts` entry if a conditional screen later proves otherwise.
- Diagnostics are `__DEV__`-guarded. Remove the call sites and utility without affecting product state if logging interferes with profiling.
- No rollback requires Firebase deployment, Rules changes, data repair, or native dependency changes.

## 15. Complete verification results

| Verification | Result |
| --- | --- |
| Registered non-emulator unit/regression scripts | 69 passed, 0 failed |
| Focused Firebase emulators | 5 passed: account standing, parent team Rules, Squad Rules, game lobby Functions, team-message Functions |
| App TypeScript | Passed |
| ESLint | Passed; existing legacy-config advisory only |
| Functions TypeScript build | Passed |
| Root clean install | Passed |
| Functions clean install | Passed |
| Expo dependency alignment | Passed |
| Android Expo export | Passed, 3,876 modules |
| iOS Expo export | Passed, 3,787 modules |
| Android release backup validation | Passed; Gradle build successful |
| Functions packaging/reproducibility | Passed within the 69-script suite |
| Android variants/federated auth | Passed within the 69-script suite |
| iOS release configuration | Passed with local plist/legal warnings |
| App size audit | Passed |
| Spot asset integrity | Passed; manifest unchanged |
| Secret scan | No tracked private-key block, service-account private key, OAuth client secret, or GitHub token pattern found |
| `git diff --check` | Passed; line-ending notices only |
| Expo Doctor | 19/21; two documented advisories |
| Local legal URL validation | Failed: privacy, terms, and support URLs absent from local environment |

Authentication-enabled behavior is covered by the federated-auth, Android variants, iOS release, and auth-navigation suites. Production provider credentials were not printed. Before a store build, confirm the production EAS environment supplies the legal URLs, Google/Apple enablement values, and iOS Google services resource.

## 16. Physical-device test plan

Use a development client for detailed traces and a release-like internal build for representative timing. Keep the same authenticated test account and network for comparisons. Capture at least five cold and five warm samples per flow; report median and slowest, not only the best sample.

1. Force-stop, launch, and wait for usable authenticated Home. Record Android first frame and each `[Performance]` startup label.
2. Repeat warm launch/navigation without force-stop.
3. Open Home, pull/revisit it, and compare parent-team and weekly-challenge traces.
4. Open Squad discovery and Find Nearby with permission already decided; separately measure first permission use.
5. Open Parent Teams, Coach Teams, a team detail, and Schedule with small and large histories.
6. Open Friends, requests, and search; trigger one incoming change while the screen is active.
7. Open direct/group chat, load older pages, open an image, and replay voice media.
8. Open Games and Active Now; enter the lobby directory and join each game type.
9. Open Notifications, Profile, and Settings, including mode switching.
10. Repeat on Android gesture and three-button navigation and on an iOS device with the home indicator.
11. Watch memory/snapshot growth for unbounded team screens and confirm subscriptions disappear after navigation/sign-out.
12. Confirm no trace contains user identifiers, message content, email, coordinates, document data, tokens, or credentials.

The current installed production build can continue to provide native launch baselines, but a new JavaScript-bearing build or development session is needed to measure the implemented optimizations.

## 17. Firebase deployment requirements

None. No Functions, Firestore Rules/indexes, RTDB Rules, Storage Rules, Firebase configuration, or production data changed. The emulator runs were verification only.

## 18. Native-build requirements

No native dependency or native configuration change was made. The current development client can exercise these JavaScript changes through Metro without rebuilding. Shipping the changes to store users still requires the normal future Android/iOS release build because the installed production binaries do not contain this JavaScript and asset manifest. No EAS build was started in this task.

## 19. Complete changed-file inventory

- `app/(tabs)/friends.tsx`
- `app/(tabs)/index.tsx`
- `app/_layout.tsx`
- `app/index.tsx`
- `context/AppContext.tsx`
- `context/AuthContext.tsx`
- `context/SquadContext.tsx`
- `hooks/useSquadGameLobbies.ts`
- `package.json`
- `scripts/test-auth-profile-ui-core.cjs`
- `scripts/test-message-keyboard-layout.cjs`
- `scripts/test-performance-core.cjs` (new)
- `scripts/test-post-sdk57-regressions.cjs`
- `services/accountStandingService.ts`
- `services/parentTeamService.ts`
- `services/squadService.ts`
- `services/teamService.ts`
- `utils/performanceDiagnostics.ts` (new)
- `docs/app-performance-and-refactor-report.md` (new)

No lockfile, dependency version, native module, Firebase backend file, released game content, or Spot asset changed.

## 20. Recommended next phases

| Rank | Phase | Expected impact | Risk | Effort | Expected cost effect |
| ---: | --- | --- | --- | --- | --- |
| 1 | Device profiling with the new fixed-label traces | High; identifies real user critical paths | Low | Low-medium | None |
| 2 | Parent team summaries, unread aggregates, and pagination | High Firebase/network reduction | Medium-high | High | Likely fewer reads; additional summary writes |
| 3 | Bound/paginate team messages and schedules | High for long-lived teams | Medium | Medium-high | Fewer reads/listener bytes |
| 4 | Friends listener refresh coalescing | Medium-high | Low-medium | Medium | Fewer duplicate callable/read groups |
| 5 | Functions cold-start modularization | Medium-high | Medium | High | No added recurring cost if `minInstances` remains off |
| 6 | Staged Firebase/Functions dependency migration | Security/maintainability | Medium-high | High | No expected runtime cost; test/deployment effort |
| 7 | Asset-delivery strategy for game scenes | High install-size potential | High product/offline risk | High | May add Storage/CDN egress cost |
| 8 | Large-screen decomposition and selective virtualization | Medium rendering/maintenance | Medium | Medium-high | None |

`READY FOR DEVICE PERFORMANCE VALIDATION`
