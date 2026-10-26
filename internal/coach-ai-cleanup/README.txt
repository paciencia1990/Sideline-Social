Coach AI cleanup internal interface — local, disconnected implementation

HOST STARTUP / OBSERVER UPDATE — October 15, 2026
host/bootstrap.cjs now supplies two separate explicit Node 22 entry points:
  node internal/coach-ai-cleanup/host/bootstrap.cjs console
  node internal/coach-ai-cleanup/host/bootstrap.cjs observer
These are future runtime commands, not deployment or build commands. Neither was
started against live services. Imports never listen or fetch credentials. The
listener uses 0.0.0.0 and PORT with bounded headers/timeouts; failures never restart.
All capability gates default off. See hosting.env.example for explicit settings.
Console startup requires the exact reviewed HTTPS origin even while disabled.
Enabled console reads require distinct private UID pins and the secret-injected
verification key. Existing workflow MFA/roster/approval/transaction gates remain.

Future packaging must retain this directory/assets and separately supply the
reviewed functions/lib/coachAiCleanupInterface.js closure, its locked runtime
dependencies and firebase-admin/firestore Timestamp for console reads; the observer
requires only functions/lib/coachAiCleanupQueueMonitor.js. The entry point does not
load functions/lib/index.js, compile TypeScript or install dependencies. It fails
closed if required packaged modules/configuration are missing. No package/image
has been built, and the exact artifact/deployer permission review remains open.

observer/ is a separate private service with no operator Auth, vendor, secret or
database-write port. It verifies Google RS256 OIDC locally using Google's public
keys, the exact service audience, scheduler email and immutable numeric subject.
Only ordinary Authorization is accepted; do not configure X-Serverless-Authorization.
Cloud Run Invoker IAM must remain enabled and restricted to the scheduler account.
The observer reads only four projected cleanup collections, at most 501 records
each (501 means unknown, never healthy). It emits only validated aggregate counts,
health/reason and public schedule timing; no IDs, credentials or record text.

POST /observe accepts only the reviewed health/notice job names and original
X-CloudScheduler-ScheduleTime. Health uses ten-minute slots; notice uses weekdays
09:00/16:00 America/New_York, including DST. Delivery up to 15 minutes late retains
the original slot; future/stale/wrong slots are denied without a healthy heartbeat.
The in-memory slot ledger suppresses repeated scans/logs, including failed and
overlapping requests, within that instance. It is bounded and not durable across
cold starts/instances. Future scheduler activation requires acceptance of provider
duplicate delivery and alert aggregation by stable slot; no exactly-once promise.
There is no timer, polling loop, self-retry, direct email or scheduler provisioner.
Logs/alerts, operator visual acceptance and hosted identity/IAM checks are still
future acceptance work. This observer covers cleanup records, not stalled paid
generation responses; that separate activation check remains in the readiness list.

Verification: 18 focused cases passed once plus seven syntax checks, with injected
HTTP/listener/credential fixtures only. Existing 35 host/login cases and 15 retention
cases were not repeated. See docs/coach-ai-cleanup-hosting-observer-implementation-20261015.txt.
The absent-startup/observer statements below describe the historical checkpoint
and are superseded by this update; the underlying operator host remains unchanged.

HOST/LOGIN UPDATE — October 15, 2026
Local host/application.cjs composes the static assets, explicit capability gates,
per-request runtime and existing cleanup adapter. It returns a Node HTTP handler;
there is no listener, environment bootstrap, cloud export or default activation.
All login/read/mutation flags default false. Pass only reviewed explicit config.
Public Auth project must match server project. Never pass receipt UID hashes as pins.
host/runtime.cjs requires the existing createCoachAiCleanupInterface factory and
Timestamp type as dependencies; a future build must package these separately.

login.js + login-page.js now implement email/password + existing TOTP sign-in,
using direct Identity Platform REST requests once per user action. This replaces
the earlier planned Firebase web SDK to avoid implicit retry/token-refresh behavior.
No signup, new factor enrollment, refresh token retention or automatic refresh.
Private inputs clear on submission; only ID token/pending challenge remain in memory.
Session loss/expiry locks the page and clears displayed records. Late responses do
not restore records after sign-out. Existing uncertain-mutation guards stay intact.

host/transport.cjs sends each outbound request once using Node HTTP(S), with no
retrying SDK, redirect following, stored credentials or ambient auth lookup.
Metadata OAuth acquisition occurs once per request scope; its failure is cached
for that scope. Firebase certificate lookup is once per scope. The Auth port
validates RS256 signature/project/claims, current user and revocation; the existing
workflow still requires pins, MFA, verified email, roster and recent auth.
host/firestore.cjs implements only the required bounded REST reads/queries and
single-attempt transactions. It cannot write profiles or roster. No commit retry or
automatic rollback is issued on error; uncommitted server transactions expire.
Deadline after queued writes blocks commit dispatch; a dispatched commit may still
complete after connection loss, so reconcile read-only instead of assuming failure.
These are local application-level controls, not proof of provider exactly-once
delivery, live IAM or actual deployed runtime behavior.

The browser remains disconnected without a configured approved host. No public web
configuration, real UID pins, credential values or native/server deployments were
created. Browser visual acceptance remains pending; the loopback integration server
was an automated HTTP fixture, not a browser-preview workaround, and was stopped.
Observer core remains read-only and unscheduled; its separate hosted OIDC/schedule/
alert wiring is not supplied by the operator host. See
docs/coach-ai-cleanup-host-login-implementation-20261015.txt for current evidence.

HISTORICAL BASELINE BELOW (host-not-implemented statements superseded above)

Files: index.html, style.css, page.js, client.js.
The page makes no requests until a future authenticated same-origin host supplies
window.sidelineCleanupSession = { getToken: async () => currentOperatorIdToken }.
Do not add a token textbox, persist a token, paste credentials into this file or
use a parent/coach mobile session as authority. Tokens remain in memory and are
sent in Authorization only to /internal/coach-ai-cleanup on the same origin.
There is no Firebase web SDK, direct database access, provider key or remote CDN.

The server-side adapter is functions/src/coachAiCleanupInterface.ts. It is a pure
request factory, NOT a deployed endpoint. Construct it with the intended Auth and
Firestore instances, secret accessor callback, fixed origin and separately
controlled immutable primary/backup UID pins. Copy only method, Origin,
Authorization, Content-Type and parsed JSON body from the host request; apply a
16 KB request-parser limit before parsing, preserve response Cache-Control:no-store,
and do not log headers/body. The factory also rejects oversized parsed requests.
Serve scripts/styles on the same origin; preserve CSP and add frame-ancestors 'none'
as an HTTP header. Do not add CORS wildcard or cookie fallback. The host must handle
private login/MFA, session loss and security headers before production integration.
No host login integration, endpoint, permission grant or hosting configuration was
created here. Missing/mismatched pins and roster fail closed. Do not insert fake UIDs
into a live config. Verify actual Auth project membership before any connection.

Available request actions:
 list: no filters or arbitrary collection paths; bounded safe projections.
 detail: kind fences/queue/events/reviews and exact validated key; optional reviewId.
 draft: one close/expire_cleanup/expire_event operation and hashed key.
 approve: exact draft and seven explicit boolean human attestations.
 execute: operation, key, reviewId; verified UID only when a nonbuyer has no queue;
          explicit confirmed:true for expiry. Existing queue UID stays server-side.
 expire_review: exact reviewId and explicit confirmed:true.

The list/detail output excludes raw UID, reviewer UID/email, vendor bodies and
free-form record text. Hashed targets and review UUIDs are pseudonymous operational
identifiers and are shown only to the authenticated operator. They must not be sent
to analytics or aggregate monitor logs. An unresolved nonbuyer UID is supplied only
for its exact hash; the server checks the match and does not recreate it in receipts.

Review UI: choose one record, create a fresh review, check evidence attestations,
save approval, confirm action and execute once. Unknown facts stay unchecked.
The same operator approves/executes; this is not two-person approval. Read-only
reconciliation is available after an unclear outcome, before a new explicit review.
The client blocks duplicate in-flight requests and repeated mutations for the same
review during that page session. Server revisions, single-use review consumption
and single-attempt transactions provide the durable mutation guards.

Read-only monitor: functions/src/coachAiCleanupQueueMonitor.ts.
createCleanupQueueMonitor(() => readCleanupInventory(db)) returns aggregates only.
No IAM provisioner, scheduler, email sender, Function export, database writer, Auth
inventory or vendor client is included. A future host may emit only that aggregate
result and must treat unknown as unhealthy; it must never log the input inventory.
No application retry loop exists. A deployed SDK/host's transport retry settings
still require review; local fixtures do not establish actual network behavior.
Counts are a bounded observational snapshot, not proof of an erasure's completion.

Notice windows: 09:00/16:00 America/New_York Monday-Friday, with DST handled by Intl.
Overdue review is end of the next business day at 16:00; technical escalation at
end of the fifth business day. Weekends skip to Monday. Holidays are not configured.
The future schedule must use these local times. Missed-heartbeat/failure policies
and verified email delivery are deployment gates, not configured by this library.

Verification: see docs/coach-ai-cleanup-interface-implementation-20261015.txt.
The browser rejected local-file preview, so visual browser acceptance is pending.
No preview-server workaround or second browser attempt was made.
