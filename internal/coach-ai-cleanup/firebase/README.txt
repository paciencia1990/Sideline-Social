Cleanup tools — proposed first-generation Firebase migration, October 17, 2026

Status: local source only. No Function, Hosting site, grant, schedule, alert,
activation or compiled/uploaded package has been created by this preparation.
The old disabled Cloud Run services are left untouched.

console-entry.cjs exports only coachAiCleanupConsole with the existing dedicated
keyless operator identity. observer-entry.cjs exports only coachAiCleanupObserver
with the existing read-only observer identity. Both use firebase-functions/v1,
30 seconds, 512 MiB, min 0/max 1 and private invocation by default. The entries
are not exported through functions/src/index.ts. Do not deploy the whole app
Functions source to install these internal tools.

The pure console.cjs / observer.cjs factories reuse the current host and workflow
code. request.cjs replays only the managed framework's Buffer rawBody into the
existing Node handlers, preserving the original Authorization and scheduler
headers and enforcing bounded bytes. It never uses req.body or rereads the
already-consumed incoming stream. There is no listener or Cloud Run bootstrap.
Cached initialization failure is terminal for that instance; no retry is added.

config.cjs pins the existing Firebase project, exact new Function names, proposed
Hosting site/origin and full observer Function audience. The proposed site ID
sideline-coach-cleanup-2026 has NOT been checked for availability. A conflict
stops the future preflight; changing it requires refreshing the exact review.
Runtime project proof must come from consistent provider project variables or
server FIREBASE_CONFIG, not only a caller-controlled expected-project value.

firebase.cleanup-review.json is separate from firebase.json and the moderation
configuration. It rewrites the dedicated site's root to the console Function;
hosting-empty/ uploads no assets. Static UI files are served by the Function's
fixed asset allowlist. Never upload the parent internal folder. The canonical
operator origin is https://sideline-coach-cleanup-2026.web.app; data posts from
other origins remain denied, including alternate Firebase aliases.

The private observer receives scheduled POSTs at its bare Function URL:
https://us-central1-sideline-social-staging-2026.cloudfunctions.net/coachAiCleanupObserver
Its OIDC audience must be identical. Only the trusted adapter maps that root
request to the old host's /observe route. Keep independent signature/issuer/
audience/email/subject verification and original job/time checks. If real
platform handling removes/changes the signed token, stop and review the design;
never silently remove the verifier or substitute a shared static credential.

Future isolated package layout (no such output has been built):
  package.json + package-lock.json from the existing pinned functions package;
  main = internal/coach-ai-cleanup/firebase/<console|observer>-entry.cjs;
  scripts = {} and npm fetch-retries=0;
  functions/lib/<selected core module>.js from the reviewed TypeScript closure;
  internal/coach-ai-cleanup/... only the manifest's allowlisted runtime/UI files.
No index.js, Docker recipe, CLI credential lookup, private env file, operator UID
pin, service-account JSON or key file is a package input. Preserve the exact
lock; no dependency installation or TypeScript emit occurred in preparation.

The entries declare no automatic/latest secret binding. The disabled Functions
need no data or secret access. A future reviewed API configuration update must
pin verification-key version 1 on only the console before enabling reads.
Using a bare CLI redeploy later could reset manual runtime settings; it is not
the reviewed execution method. Use the consolidated target-only review.

Eleven focused offline fixture groups passed once. The fixture uses fake HTTP
requests and a stubbed SDK registration, not an emulator or deployed backend.
Existing MFA/workflow/retention/closure suites were not repeated. Platform raw
headers, current IAM, real MFA, Hosting availability and scheduled delivery are
still future acceptance; all capability flags default false. Mutation activation
is outside the initial migration deployment scope.

Consolidated source inventory, exact grants, staged deployment and remaining
provider-delivery boundaries:
docs/coach-ai-cleanup-firebase-migration-review-20261017.txt
docs/coach-ai-cleanup-firebase-migration-review-20261017.json
docs/coach-ai-cleanup-firebase-migration-manifest-20261017.json
