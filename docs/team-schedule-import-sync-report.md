# Team Schedule import, synchronization, and calendar report

Date: 2026-08-20
Branch: `chore/expo-sdk57-patch-alignment`

## Outcome

The Team Schedule now presents one Add Schedule entry point with three provider-neutral choices: connect an authorized iCalendar feed, upload CSV or a one-time `.ics` file, or create an individual event. Active Team members also have a separate complete-season calendar subscription flow. The existing single-event Add to Calendar action remains available.

No production calendar link or token was used, fetched, stored, reproduced, or tested. All calendar fixtures use the reserved `.invalid` domain. No Firebase deployment, EAS build, production-data change, production secret creation, or merge was performed as part of this work. Repository commit and push are handled separately as an owner-authorized handoff step.

## Native calendar crash

### Root cause

- The repository has `expo-calendar@57.0.2`, the `expo-calendar` config plugin, English and Spanish iOS calendar usage descriptions, and Android Expo-module autolinking resolution for `expo.modules.calendar.CalendarModule` / `ExpoCalendar`.
- The currently installed Android development client predates that native module. Its binary therefore has no `ExpoCalendar` implementation even though JavaScript and package metadata are present.
- `expo-calendar/legacy` evaluates `requireNativeModule('ExpoCalendar')` as soon as the JavaScript module loads. The former try/catch happened around `require`, but Expo surfaced the missing-native-module exception as a development red screen before the feature could reliably recover.

### Fix

`teamScheduleCalendarService.ts` now calls `requireOptionalNativeModule('ExpoCalendar')` before it evaluates `expo-calendar/legacy`. When the native module is absent, it never executes the legacy import and returns the existing localized `calendar_build_required` error. The event-detail screen clears its busy state in `finally`, preserves the event and navigation, blocks duplicate taps, and restores screen-reader focus to the button.

When the module exists, dates and IANA time zones are validated before the OS editor opens. Cancellation is silent. Only the explicit reliable `saved` result produces a saved confirmation; Android's `done`/closed result remains indeterminate and is not described as a confirmed save. Development diagnostics contain only fixed stage names, platform, all-day state, normalized result, and error classification—never event details or stack traces.

The resolved iOS configuration retains write-only calendar descriptions. Android retains blocked `READ_CALENDAR` and `WRITE_CALENDAR` permissions because this action uses the system editor rather than reading the user's calendar database.

A fresh Android and iOS development build is required to physically verify `ExpoCalendar`. A JavaScript update alone cannot add the missing native module to an installed client.

## CSV failure

### Root cause

The observed banner could only come from the old screen's outer catch; parser-level missing headers were returned as a preview row and did not throw. The failing path therefore occurred while accessing/decoding the selected document. The prior implementation passed the provider URI directly to the legacy string reader and collapsed every unrecognized file-system or encoding exception into `readFailed`. Android document providers can expose `content://` values, and a provider/cached-copy mismatch is not readable through that direct legacy path. The narrow MIME request also excluded common generic Android document labels.

The old parser then had a second deterministic compatibility problem: it required exact machine headers such as `start_time` and `home_away`, so common Excel/human headers were rejected even when the file was otherwise valid.

### Fix

- The picker accepts Android's generic document result and validates the returned name and MIME after selection.
- `copyToCacheDirectory: true` remains mandatory.
- The SDK 57 `new File(uri).text()` path reads the cached local document, with the supported `expo-file-system/legacy` reader as a compatibility fallback.
- File access, type, encoding, headers, ambiguity, limits, invalid rows, partial rows, authorization changes, and completed duplicates now retain distinct localized messages.
- Preview rows show row number plus field-level problems, and valid rows remain selectable.
- Server-side normalization, stable SHA-256 fingerprints, bounded fingerprint lookups, deterministic event IDs, operation records, and transaction revalidation remain authoritative.

### Accepted CSV format

- UTF-8, with or without UTF-8 BOM. UTF-16/null-byte input is rejected with an encoding correction.
- `.csv` extension is case-insensitive, including `.CSV`.
- MIME: `text/csv`, `text/comma-separated-values`, `application/csv`, `application/vnd.ms-excel`, `application/octet-stream`, `application/x-download`, and `text/plain`.
- Comma or semicolon delimiters; the unquoted header record determines the delimiter.
- LF or CRLF; quoted commas/semicolons, escaped double quotes, quoted multiline notes, and trailing empty rows.
- Dates: `YYYY-MM-DD` or US Excel-style `M/D/YYYY`.
- Times: 24-hour `HH:mm`, or Excel-style `h:mm AM/PM`; optional seconds in imported time strings are discarded.
- Maximum 256 KB and 200 non-header rows.
- Required logical fields: Event Type, Title, Start Date, Start Time, End Time, and Time Zone. An End Date column is recognized; CSV events spanning multiple dates are rejected precisely because the canonical manual/CSV draft currently models a single local date. All-day rows still use the shared required header set.

Recognized header aliases after case, underscore, hyphen, and whitespace normalization:

| Canonical field | Accepted headers |
| --- | --- |
| `type` | `Type`, `Event Type` |
| `title` | `Title`, `Event Name` |
| `date` | `Date`, `Start Date` |
| `start_time` | `Start Time` |
| `end_date` | `End Date` |
| `end_time` | `End Time` |
| `arrival_time` | `Arrival Time` |
| `timezone` | `Timezone`, `Time Zone` |
| `all_day` | `All Day`, `All-Day` |
| `opponent` | `Opponent` |
| `home_away` | `Home Away`, `Home/Away` |
| `venue` | `Venue`, `Location` |
| `field` | `Field` |
| `address` | `Address` |
| `status` | `Status` |
| `team_score` | `Team Score` |
| `opponent_score` | `Opponent Score` |
| `notes` | `Notes`, `Description` |

If two headers map to the same canonical field, import stops with an ambiguous-mapping correction instead of guessing. The shared template is parsed by the same client and server fingerprint contract used for imports.

## iCalendar model

The bounded parser accepts `UID`, `DTSTART`, `DTEND`, `DURATION`, `TZID`, `SUMMARY`, `LOCATION`, `DESCRIPTION`, `STATUS`, `SEQUENCE`, `LAST-MODIFIED`, `RRULE`, `RDATE`, `EXDATE`, and `RECURRENCE-ID`. It unfolds RFC-style continuation lines, supports UTC, local TZID, and date-only values, expands bounded daily/weekly recurrence, applies exception dates and rescheduled overrides, handles DST using IANA time zones, chooses the newest duplicate identity by sequence/last-modified metadata, and rejects malformed or excessive data.

Unknown properties are ignored. `ATTENDEE`, `ORGANIZER`, roster names, and contact fields are never projected. A one-time file and a connected feed both write only to `teams/{teamId}/events/{eventId}`. Identity is deterministic from the private integration plus `UID` and `RECURRENCE-ID`; retries update or retain existing events instead of duplicating them.

Event source metadata includes `sourceType`, private `sourceIntegrationId`, `externalUid`, `externalKey`, `recurrenceId`, `sourceSequence`, `sourceHash`, source last-modified time, and source synchronization time. Raw credential-bearing URLs are never stored on event documents.

For connected-feed events, the source controls type/title, date/time/timezone, location, and cancellation. Source description is stored separately from Sideline notes/local metadata. A coach sees a localized Synced calendar indicator and must detach the event before editing or deleting source-controlled data. Sync never changes manual events. Missing source events are cancelled and marked as removed before any later cleanup. Replacing a link stages encrypted replacement credentials and then reuses the same private integration identity so matching events update and removed events cancel without a duplicate season.

Disconnect supports:

- Keep events: events become detached local/manual events.
- Remove events: events are cancelled and hidden from the active subscription projection, preserving an explanation/audit trail instead of disappearing silently.

Initial CSV, ICS-file, and feed imports default to no notification and offer the coach one explicit notification switch. When selected, the backend sends one existing import-summary notification, not one notification per event. Manual and automatic sync do not generate event-by-event notifications.

## Calendar-feed trust boundary

The client submits a link once and clears it from visible state immediately. The server returns only a private integration ID, credential-free hostname, sanitized preview events, warnings, and counts.

The complete source URL exists only:

1. transiently in the authenticated callable request;
2. transiently during validated retrieval; and
3. encrypted in the default-deny `teamCalendarIntegrations` record.

AES-256-GCM uses a dedicated 32-byte key bound as `TEAM_CALENDAR_FEED_ENCRYPTION_KEY`. Stored credential fields are ciphertext, 96-bit IV, authentication tag, encryption version, hostname, and nonreversible SHA-256 URL fingerprint. Firestore clients—including coaches and parents—cannot read integration, preview, credential, lease, token-hash, rate-limit, or audit collections.

Retrieval protections:

- normalize `webcal://` to HTTPS server-side;
- reject HTTP, embedded username/password, fragments, non-443 ports, malformed or over-2,048-character URLs;
- exact audited hostname allowlist from `TEAM_CALENDAR_FEED_ALLOWED_HOSTS`;
- resolve every destination and reject localhost, unspecified, private, loopback, carrier-grade NAT, link-local, documentation, multicast, and metadata-service address ranges;
- pin the HTTPS request to the validated address while retaining hostname TLS verification;
- allow no more than two redirects and revalidate/re-resolve every destination;
- 10-second connection/response timeout, 512 KB response cap, and calendar-compatible content requirement;
- conditional `ETag` / `Last-Modified` requests;
- hashed rate-limit subjects and privacy-safe failure classifications;
- no URL, query, token, event data, or stack-trace logging in the calendar implementation.

Only permanent, active, nonrestricted authenticated coaches/staff on an active Team can connect, replace, confirm, sync, toggle, disconnect, or detach. The existing permanent-account communication boundary rechecks standing; the calendar callable also rechecks active membership, management role, and archived state. Calendar operations do not create a cross-user interaction, so user-to-user block state is not involved.

Unsupported hosts receive a precise one-time `.ics` upload path; the server does not make an exploratory request.

## Automatic synchronization

Automatic sync is opt-in per connected Team and defaults off. It is additionally disabled unless the server-controlled `TEAM_CALENDAR_AUTOMATIC_SYNC_ENABLED` value is exactly `true`; leave it false until provider terms and legal approval permit polling.

When enabled, the scheduled function runs every four hours, reads at most 10 due integrations ordered by `nextSyncAt`, adds stable per-integration jitter, and fetches once per Team integration—not once per subscribing member. A default-deny lease prevents overlap. Conditional requests reduce transfer and parsing cost. Failures use exponential retry with jitter; after five consecutive failures, polling stops and status becomes Needs attention. Privacy-safe audit summaries expire after 180 days.

One composite index is evidence-supported for `teamCalendarIntegrations(automaticSyncEnabled ASC, nextSyncAt ASC)`. No other composite index was added.

Cost drivers are one scheduled invocation every four hours, up to 10 source fetches per invocation, integration/event reads and changed-event writes, one audit write per attempt, and public-feed reads. Conditional responses and stable hashes avoid unchanged event writes. The bounded batch leaves additional due integrations for the next invocation; operational monitoring should confirm whether 10 per four-hour window is sufficient before broad rollout.

## Sideline Social season subscription

Each member/Team subscription issues 32 random bytes encoded as a bearer token. Only SHA-256 token hashes and an owner pointer are stored. Regeneration revokes the previous hash before issuing a new token; revoke invalidates it immediately.

Every HTTPS `.ics` request rechecks the token status, Team existence, active membership, and account standing. Removed members, suspended/banned accounts, revoked tokens, and missing Teams receive no schedule. Archived Teams follow the existing policy: active members retain read-only schedule access, and the feed remains readable while no new source changes are accepted.

The generated feed has stable event UIDs, sequence, update timestamps, cancellations, CRLF line endings, escaping/folding, `ETag`, `Last-Modified`, safe private caching, a 120-request/hour token-hash rate limit, and schedule-only fields. The client offers Google Calendar, `webcal://` for Apple/other apps, system share/copy, and revoke/regenerate. Copy uses the platform share sheet so the user can choose the OS Copy action without adding another native clipboard dependency. The UI warns that the link is a bearer credential and that provider refresh is not immediate.

## Private collections and Rules

New server-only collections, all default-denied in `firestore.rules`:

- `teamCalendarIntegrations`
- `teamCalendarSyncLeases`
- `teamCalendarSubscriptions`
- `teamCalendarSubscriptionOwners`
- `teamCalendarSyncAudit`
- `teamCalendarImportPreviews`
- `teamCalendarRateLimits`

Existing canonical events and active/archived read behavior remain unchanged. No Firestore, RTDB, Storage, authentication, moderation, or account-standing rule was weakened.

## Files changed for this work

Client/UI:

- `app/teams/[teamId]/schedule/index.tsx`
- `app/teams/[teamId]/schedule/add.tsx`
- `app/teams/[teamId]/schedule/upload.tsx`
- `app/teams/[teamId]/schedule/import.tsx`
- `app/teams/[teamId]/schedule/import-ics.tsx`
- `app/teams/[teamId]/schedule/connect.tsx`
- `app/teams/[teamId]/schedule/subscribe.tsx`
- `app/teams/[teamId]/schedule/[eventId].tsx`
- `components/TeamScheduleEventCard.tsx`
- `constants/teamSchedulePreview.ts`
- `services/teamScheduleCalendarService.ts`
- `services/teamScheduleService.ts`
- `services/teamCalendarIntegrationService.ts`
- `utils/teamScheduleCore.ts`
- `i18n/index.ts`

Backend/security:

- `functions/src/teamCalendarCore.ts`
- `functions/src/teamCalendar.ts`
- `functions/src/teamSchedule.ts`
- `functions/src/index.ts`
- `firestore.rules`
- `firestore.indexes.json`

Tests/fixtures/report:

- `scripts/fixtures/team-calendar-synthetic.ics`
- `scripts/fixtures/team-schedule-excel.csv`
- `scripts/test-team-calendar-core.cjs`
- `scripts/test-team-schedule-core.cjs`
- `scripts/test-team-schedule-firestore-rules.cjs`
- `scripts/test-team-schedule-functions-emulator.cjs`
- `package.json`
- `docs/team-schedule-import-sync-report.md`

The pre-existing Expo Doctor/native-resource changes present before this task were preserved. `package-lock.json`, `functions/package.json`, and `functions/package-lock.json` were not changed. No dependency was added or upgraded.

## Verification

Passed:

- `npm.cmd run typecheck`
- `npm.cmd run lint` (legacy ESLint configuration notice only)
- `npm.cmd --prefix functions run build`
- `npm.cmd run test:team-schedule`
- `npm.cmd run test:team-calendar-security`
- `npm.cmd run test:ios-release`
- `npm.cmd run test:android-variants`
- `npm.cmd run test:parent-teams`
- `npm.cmd run test:archived-team-lifecycle`
- `npm.cmd run test:notifications`
- Firestore Rules emulator: active/archived schedule reads, direct-write denial, standing/isolation, and read/write denial for every new private collection
- Auth/Database/Firestore/Functions emulator: coach/staff/parent/removed/outsider/suspended authorization, manual and CSV idempotency, synthetic ICS preview/import/retry, stable external identities, feed-event edit protection/detach, summary notifications, hashed subscription storage, token revocation, recurrence/DST, notification and audit regressions
- Expo module resolution: `expo-calendar@57.0.2` resolves Android `expo.modules.calendar.CalendarModule`; `expo-document-picker@57.0.1`; installed `expo-file-system@57.0.5` satisfies the SDK-compatible range
- `git diff --check`

The Functions emulator could not read a production secret—which is expected and desirable. File-import and token tests do not need its value and passed. A local feed-fetch test would require a nonproduction `.secret.local` value and an explicitly approved synthetic HTTPS host; neither a production secret nor a real provider link was created for this task.

Synthetic unit coverage includes UTF-8 BOM, CRLF/LF, comma/semicolon, quoted delimiters/newlines/quotes, Excel dates/times, aliases, ambiguous/missing headers, invalid encoding, uppercase extension, recurrence, exception dates, recurrence override, all-day, cancellation, sequence, duplicate identity, DST-aware TZID conversion, contact omission, blocked IP ranges, URL rejection, credential-redaction source checks, stable subscription output, and cancellation propagation.

## Configuration and deployment order

Nothing was deployed or configured in production. Before physical end-to-end testing, the owner/operator must:

1. Obtain provider/legal approval and create an audited exact-host list. Keep automatic polling disabled unless approval explicitly covers it.
2. Create a 32-byte random value through the organization's approved secret-generation/password-manager process, encode it as base64, and set it interactively as `TEAM_CALENDAR_FEED_ENCRYPTION_KEY` with Firebase Secret Manager. Do not put it in source control, chat, logs, shell history, or this report. Do not print it to verify it.
3. Configure `TEAM_CALENDAR_FEED_ALLOWED_HOSTS` as a comma-separated exact hostname list in the Functions deployment environment. Configure `TEAM_CALENDAR_AUTOMATIC_SYNC_ENABLED=false` initially.
4. Deploy `firestore.rules` first so private collections remain denied from their first write.
5. Deploy `firestore.indexes.json` and wait for the one new index to become ready.
6. Deploy the listed calendar/schedule Functions, including the HTTPS subscription endpoint and scheduled job. Secret-bound Functions must be redeployed after secret rotation.
7. Deploy the app JavaScript/native release only after backend compatibility is confirmed.
8. Produce fresh Android and iOS development builds. Do not rely on the currently installed Android development client.

Official implementation references reviewed:

- https://docs.expo.dev/versions/latest/sdk/calendar-legacy/
- https://docs.expo.dev/versions/latest/sdk/calendar/
- https://docs.expo.dev/guides/sdk-libraries-migration/calendar/
- https://docs.expo.dev/versions/latest/sdk/document-picker/
- https://docs.expo.dev/versions/latest/sdk/filesystem/
- https://firebase.google.com/docs/functions/config-env
- https://firebase.google.com/docs/reference/functions/firebase-functions.schedule
- https://www.rfc-editor.org/rfc/rfc5545

## Rollback

1. Set `TEAM_CALENDAR_AUTOMATIC_SYNC_ENABLED=false` and redeploy the scheduled/calendar Functions to stop new polling.
2. Revoke affected personal subscription tokens and disconnect source integrations through the callable/UI path. Choose Keep events if schedule continuity is required.
3. Redeploy the previous app and Functions revisions.
4. Keep the new default-deny Rules in place until all private calendar documents have been securely retired. Do not roll Rules back first.
5. Retain cancelled/detached events and privacy-safe audit summaries for incident review; delete private integration ciphertext only through an approved server-side cleanup after rollback is confirmed.
6. Rotate the encryption secret if credential exposure is suspected, then re-enter authorized links because old ciphertext cannot be decrypted after destructive rotation.

## Remaining approvals and limitations

- Production automatic polling is intentionally unavailable until provider/legal approval and an audited hostname allowlist exist.
- No real provider was contacted, so redirects, conditional headers, legal terms, provider refresh timing, and production TLS/DNS behavior still require approved nonproduction/physical validation.
- XLS/XLSX remains a future enhancement; no large spreadsheet dependency was added.
- The app's existing release policy remains iPhone-only (`supportsTablet: false`) and its required iOS release regression enforces that boundary. The new layouts are responsive and can run in iPhone compatibility mode, but native iPad distribution requires a separate product/release-policy decision and full-app tablet QA. This task did not silently widen the supported device family.
- The current Firebase Functions dependency reports an available newer major/compatible release in emulator output, but dependency upgrades were explicitly out of scope.

## Physical Android/iOS checklist

After Rules/indexes/Functions/configuration and fresh development builds:

- Confirm missing-module recovery on the old Android client: localized English/Spanish build-required alert, no red screen, no lost event/navigation, spinner clears, retry remains possible.
- Confirm the new builds open the system event editor on Android and iOS; save, cancel, Android indeterminate close, double tap, invalid date/timezone, missing destination, permission denial/settings, focus restoration, and increased text size.
- Android: select CSV from Downloads, Drive, Files, and another document provider; verify cached URI access, generic MIME, uppercase `.CSV`, template, Excel comma/semicolon exports, partial rows, 256 KB and 200-row limits.
- iOS: repeat CSV tests from Files/iCloud and verify write-only calendar permission copy.
- Import only the synthetic `.ics` fixture; verify all-day, DST, recurrence, EXDATE, rescheduled instance, cancellation, deselection, retry, and no contacts/attendees.
- With a separately approved synthetic HTTPS host and nonproduction secret, test link validation, credential-free hostname display, preview, import once, Sync Now, replacement, disconnect keep/remove, ETag/304, redirect revalidation, timeout, oversized response, private/metadata IP blocking, rate limits, lease collision, failure cutoff, and automatic-sync flag off/on.
- Verify parents cannot manage feeds and removed/suspended/banned users cannot manage or read subscriptions.
- Generate a personal season token; add to Google and Apple/other apps; use system Copy; verify stable UID, update/cancellation propagation, ETag/304, provider refresh delay copy, revoke/regenerate, membership removal, standing restriction, and archived read-only behavior.
- Verify one initial-import summary notification when explicitly enabled, none when disabled, and no per-event notification storm.
- Exercise narrow Android screens, iPhone, large text, VoiceOver/TalkBack, keyboard navigation, loading announcements, checkbox selection, modal/editor focus return, and rotation/compatibility behavior allowed by the existing app policy.

## Readiness

The implementation and synthetic/emulator verification are ready for fresh Android and iOS development builds after Rules, the index, Functions, the encryption secret, and the approved hostname/feature-flag configuration are deployed to a nonproduction environment in the order above. It is not ready for production automatic polling until provider/legal approval is recorded, and the current installed Android client cannot physically test `ExpoCalendar` without replacement.
