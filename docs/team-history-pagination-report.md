# Team History Pagination and Summary Report

Date: 2026-08-19
Scope: parent/coach announcements, replies, private team messages and inboxes, schedules, archived teams, unread state, and notification targets.

## 1. Root causes

History collections were being treated as current screen state. Parent team detail and overview read every authorized announcement, then resolved one read document per announcement. Coach announcement/reply listeners, private message listeners, the per-user hidden-message listener, and the schedule listener had no result bound. Team list previews therefore paid history-scale cost for preview/count UI, collapsed past schedule content loaded before being requested, and the private inbox used client offsets. Cost, first hydration work, listener snapshots, and retained React objects all grew with history.

## 2. Previously unbounded queries and listeners

- `parentTeamService`: full announcement reads in overview/detail plus one legacy read-document lookup per announcement.
- `teamMessageService`: full coach/team announcement listeners and full reply listeners.
- `teamPrivateMessageService`: full conversation message listener and full per-user hidden-message listener.
- `teamScheduleService`: full event listener and a full event scan to find import fingerprints.
- Parent team list/detail repeated overlapping announcement work; list preview required complete history.
- Private inbox pagination used `offset()` and could reread skipped documents.
- Past schedule content was not isolated from the initial upcoming subscription.

The import duplicate check now queries only the hashed fingerprints present in the selected CSV, in chunks of at most 30; it no longer scans all events.

## 3. Chosen pagination and summary architecture

- Only the newest page is realtime. One extra document is read as a look-ahead and is not rendered.
- Older pages are one-time `startAfter` reads and are merged by ID.
- Ordering always includes a document-ID tie-breaker.
- Parent list previews read only the newest authorized announcement and a server summary, not history.
- Parent unread counts come from server-only per-user/per-team summary documents.
- Private inboxes use conversation metadata and cursor pagination; message bodies are not loaded for previews.
- Upcoming and past schedules are independent. Past is collapsed and unloaded initially.
- Direct-by-ID loaders support notification targets outside the first page.
- Compatibility entry points delegate to the bounded newest-page implementations.

No global or module-level history page cache was added. Explicitly loaded pages are scoped to the mounted authenticated route and its team/conversation key, then released on unmount, team change, mode change, or sign-out. Pagination requests have in-flight and generation guards where async overlap is possible. See section 20 for the remaining long-session retention risk.

## 4. Page sizes and cursor format

Central constants are in `constants/teamHistoryPagination.ts`:

| Data | Rendered page | Query look-ahead maximum |
|---|---:|---:|
| Team announcements | 20 | 21 |
| Announcement replies | 30 | 31 |
| Private messages | 40 | 41 |
| Upcoming schedule | 50 | 51 |
| Past schedule | 20 | 21 |
| Archived teams/history | 20 | 21 where Firestore-backed |
| Private inbox | 25 | 26 |

The client cursor is `{ id, timestampMillis }`. Announcements, replies, and messages order by timestamp then document ID. Schedule events order by `startAt` then document ID. New clients never use Firestore offsets; the inbox callable accepts legacy offsets only for installed-client compatibility.

## 5. Read/unread model

`teamAnnouncementSummaries/{sha256(uid|teamId)}` is a server-only rebuildable projection containing exact `unreadCount`, bounded recent unread IDs/entries, schema version, and timestamps. Its `unreadAnnouncements` marker subcollection makes create/delete/read reconciliation idempotent: a transaction changes the count only when marker existence changes. Announcement create/update/delete/moderation and legacy read creation reconcile markers. The read callable also writes the legacy `reads/{uid}` document; legacy documents are not removed.

The summary callable authenticates the caller and validates active membership before returning a team result. Missing summaries return `available: false`; clients show an unknown unread state and use a bounded first-page legacy fallback rather than displaying a false zero. Author profiles are hydrated once per page through the existing batched profile callable; new/legacy display snapshots remain supported.

Private conversation documents and member documents remain the server-authoritative source for latest preview, activity time, last-read position, unread count, and read-only state. Existing server delete-for-everyone reconciliation remains bounded; delete-for-me continues to write only the participant's hidden marker.

## 6. Notification deep-link behavior

Private-message notifications now include `messageId` in the stored notification and push navigation data. Routes require team/conversation/message identifiers, validate the signed-in participant, fetch the message directly by ID, apply the user's hidden state, then insert it into the visible thread. Read/notification acknowledgement occurs only after an authorized target loads. Deleted, moderated, hidden, malformed, or no-longer-authorized targets use the unavailable state.

Announcement and schedule routes continue using their existing direct-by-ID loaders and acknowledge only after successful authorized loading. No route temporarily renders content while authorization is unresolved.

## 7. Archived-team behavior

Archived coach and parent teams expose announcement history, private conversation history, and schedules through explicit history links. The team hub and conversation composer derive read-only state from archived team/conversation state and suppress create, reply, edit, and other write actions. Direct membership lookup permits an archived team that remains linked to the current user without reopening general access. Functions allow archived private inbox data only for an explicitly requested archived team; the general active inbox excludes it. Existing Rules continue to enforce membership and callable-only writes.

## 8. Before-and-after Firestore read counts

`test:emulator:team-history-pagination` seeded synthetic Firestore data and counted actual query result documents. Parent announcement baseline includes one membership read, all announcements, and one legacy read-state lookup per announcement. The bounded path includes the announcement look-ahead window plus membership and summary documents. Author hydration is one batched callable per page and is reported separately because its internal reads depend on the number of distinct legacy authors.

| History size | Parent announcement initial before | After | Batched author requests after | One older announcement page |
|---:|---:|---:|---:|---:|
| 10 | 21 | 12 | at most 1 | 0 when exhausted |
| 100 | 201 | 23 | at most 1 | at most 21 |
| 1,000 | 2,001 | 23 | at most 1 | at most 21 |

Additional bounded initial results at 1,000 items: replies 31, private messages 41 plus one conversation document and only matching hidden markers for those IDs, upcoming schedule 51, collapsed past schedule 0. Team overview reads one newest preview query and one summary state per team rather than that team's history. Inbox reads 26 conversation documents at most plus matching member metadata, never message history.

The emulator harness intentionally logs counts only. It does not log team, user, child, content, location, notification, or document identifiers.

## 9. Before-and-after listener sizes

| History size | Announcements before/after | Replies before/after | Private messages before/after | Schedule before/after |
|---:|---:|---:|---:|---:|
| 10 | 10 / 10 | 10 / 10 | 10 / 10 | 10 / 10 |
| 100 | 100 / 21 | 100 / 31 | 100 / 41 | 100 / 51 |
| 1,000 | 1,000 / 21 | 1,000 / 31 | 1,000 / 41 | 1,000 / 51 |

An announcement list has one history listener. A reply detail has one reply listener; the target announcement is a direct read. A private thread has one conversation listener, one bounded message listener, and at most two document-ID-chunk hidden-marker listeners for the 41-document window. Schedule has one upcoming listener and no past listener. Inboxes and all older pages are one-time reads.

## 10. Memory and lifecycle findings

Initial retained history objects are capped by the rendered page sizes; look-ahead documents are discarded. Snapshot handlers deduplicate by document ID and stable-sort. Private pagination uses a generation token and in-flight flag, ignores stale responses, and anchors the scroll offset when prepending older messages. Listener-return cleanup is owned by `useEffect`/focus cleanup, and route-key changes clear prior team/conversation state. Hidden-marker listeners subscribe only to IDs in the current newest message window.

Repeated navigation does not preserve a shared history cache or accumulate listeners. Older pages exist only in the active route state and are released when leaving it. Firestore offline persistence/reconnect semantics remain those of the existing SDK; realtime pages reconcile by ID without replacing an older-page cursor.

## 11. Backward compatibility

- Legacy read documents remain readable and are still written.
- New summary absence is an explicit unknown state with bounded fallback.
- Existing announcement/message fields remain accepted; no destructive schema migration exists.
- Compatibility listener functions retain their public signatures while delegating to bounded implementations.
- The inbox callable accepts legacy `offset`/returns `nextOffset`, while new clients send/receive stable cursors.
- Summary triggers tolerate legacy announcements and duplicate delivery through marker-based transactions.
- Existing private preview/unread fields and schedule mutation callables are unchanged.

## 12. Optional dry-run backfill procedure

The optional script is `scripts/backfill-team-announcement-summaries.cjs`; it was not run.

```powershell
npm.cmd run backfill:team-announcement-summaries -- --project=<project-id> --max-teams=100
```

Dry-run is the default and prints privacy-safe aggregate counts only. `--apply` is required for writes. Batches are idempotent and rebuild exact markers/counts. Resume a bounded scan with `--start-after-team=<operator-checkpoint>`; document IDs are intentionally not printed, so the operator must keep the last processed team ID in an access-controlled checkpoint. Applying to production is a separate approved operation outside this task.

## 13. Changed files

- UI/routes: `app/(tabs)/index.tsx`, `app/coach/index.tsx`, `app/coach/messages.tsx`, `app/coach/messages/[announcementId].tsx`, `app/coach/team-messages/index.tsx`, both coach/parent private conversation routes, parent team list/hub/announcement detail, schedule list, and schedule import.
- Shared UI/config: `components/PrivateTeamMessageThread.tsx`, `constants/teamHistoryPagination.ts`, `i18n/index.ts`.
- Services/navigation: `services/parentTeamService.ts`, `services/teamMessageService.ts`, `services/teamPrivateMessageService.ts`, `services/teamScheduleService.ts`, `services/teamService.ts`, `services/notificationService.ts`, `utils/notificationCore.ts`.
- Backend/config: `functions/src/index.ts`, `firestore.indexes.json`.
- Tests/maintenance: `package.json`, both new team-history pagination tests, the summary backfill, and updated parent, notification, and team-message Functions tests.
- Report: this file.

## 14. Tests and emulator results

Passed:

- Functions TypeScript build
- app TypeScript typecheck
- lint (zero errors; hook warning fixed before final run)
- `test:team-history-pagination`
- `test:emulator:team-history-pagination` with 10/100/1,000 fixtures
- `test:parent-teams`
- `test:team-messages`
- `test:team-schedule`
- `test:archived-team-lifecycle`
- `test:notifications`
- actual account-standing script: `test:emulator:account-standing`
- `test:emulator:team-messages` (summary availability, bounded recent unread state, repeated-read idempotency, legacy read compatibility, inbox, archived access, private notification message ID, delete/report/voice protections)
- Firestore Rules: parent teams, team messages, team schedule, notifications
- `git diff --check`

Cursor fixtures cover 0, 10, 20, 21, 40, 41, and 1,000 items; identical timestamps; no duplicate/omitted IDs; and a new realtime arrival between newest and older page reads. Existing suites cover tombstones, delete-for-me/everyone, recurrence/import/time zones, active/archived authorization, Parent/Coach/Staff/outsider roles, reporting/evidence, voice access, account standing, and English/Spanish keys. Physical-only cases are listed in section 19.

## 15. Required indexes

`firestore.indexes.json` adds the collection-group index for replies on `replyType ASC, createdAt DESC`. Existing announcement audience/created-time indexes are reused. Document ID is the deterministic final order. The import-fingerprint `in` query uses a single field and needs no composite index.

## 16. Firebase deployment requirements

Firebase deployment is required later for:

- the new/updated composite index;
- Functions `syncTeamAnnouncementSummaries`, `syncLegacyTeamAnnouncementRead`, `getTeamAnnouncementSummaries`, `markTeamAnnouncementRead`, and the updated private inbox/notification payload behavior.

No `minInstances`, paid service, dependency upgrade, Storage change, Realtime Database change, or Rules change was introduced. The summary collection remains client-denied under the Rules default. Nothing was deployed in this task.

## 17. Client release requirements

A normal client release is required for cursor screens, load-older controls, archived-history links, direct private message routing, unknown-unread UI, schedule split loading, and translations. No EAS build was started. Older clients continue to use legacy reads and inbox offsets during the compatibility period.

## 18. Rollout and rollback order

1. Deploy `firestore.indexes.json` and wait until every required index reports **READY**.
2. Deploy the new/updated Functions and confirm trigger/callable health. Do not configure `minInstances`.
3. Optionally run the summary backfill in dry-run mode. Review counts. Run `--apply` only as a separately approved production operation; resumable batches may run before or after client release because clients handle missing summaries.
4. Release the client.
5. Monitor callable error rates, trigger retries, summary unknown-rate, listener sizes, and inbox pagination. Keep legacy read documents/offset support for the installed-client compatibility window.

Rollback: stop the client rollout or release the previous client first. Leave new indexes, summary documents, and legacy reads intact. If Functions must be rolled back, new clients safely show unknown unread state/use the bounded legacy first-page fallback; do not delete summaries or legacy state. Restore the compatible Functions before resuming rollout.

## 19. Remaining physical-device checks

- iOS/Android keyboard anchoring and no jump while prepending older private messages.
- Voice/image protected playback after background/resume and offline/reconnect.
- Screen-reader order/labels, focus placement on load-older controls and unavailable targets, and large-text wrapping in English/Spanish.
- Sign-out, account switch, mode switch, membership removal, and archived transition while each history screen is open.
- Notification cold/warm launch to targets older than the first page.
- Schedule rendering/calendar handoff around device timezone and DST boundaries.
- Network loss during pagination followed by retry, plus rapid repeated taps on lower-end devices.

## 20. Deferred risks

- Deliberately loading many older pages during one uninterrupted mounted screen retains those user-requested objects until the route exits. Repeated navigation is bounded because no cross-route cache exists, but a future windowed/history-navigation UI could impose a hard active-route page count without creating a gap. This should be decided after device memory profiling because silently evicting visible pages would harm complete-history navigation.
- Historical summaries are absent until touched by triggers or optionally rebuilt; the UI intentionally reports unknown, never zero.
- The summary's bounded recent-unread ID list can resolve the newest page without N+1 reads; an explicitly requested older legacy page may still issue at most 20 legacy read-document lookups.
- Announcement display-name snapshots are not backfilled; legacy pages use one batched profile hydration request.
- Reliable first-content/hydration milliseconds require physical-device network profiling. Emulator acceptance records exact documents/listener sizes; emulator startup and local loopback timings were not presented as production latency.
- Private latest-preview deletion reconciliation keeps the existing bounded server scan; exceptionally long runs of ineligible/deleted latest messages may require a separate server repair job, never a client full-history scan.

READY FOR DEVICE VALIDATION
