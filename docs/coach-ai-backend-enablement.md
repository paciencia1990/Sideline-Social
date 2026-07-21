# Coach AI backend enablement

## Current production state

Coach AI is intentionally disabled. The active `generateCoachResourceHelp` export is an authenticated, non-secret compatibility stub. It makes no provider request, performs no Firestore write, and returns `failed-precondition` with `reason: feature_disabled` to signed-in callers. The app also has `FEATURE_FLAGS.coachAiEnabled` set to `false`, so current clients do not call the function and show a localized coming-soon state instead.

The unfinished provider implementation is retained at `functions/src/disabled/coachResourceHelp.ts`. It is compiled for maintenance but is not imported by `functions/src/index.ts` or any module in the active Functions import graph.

## Required product and privacy approvals

Before enabling Coach AI:

1. Approve the AI provider, model, data-processing terms, regional processing, retention, deletion, subprocessors, and incident-response commitments.
2. Update the privacy inventory, public Privacy Policy, App Store privacy disclosures, Google Play Data safety answers, in-app notice, and any consent flow required for the final design.
3. Prohibit child names, contact details, health data, precise locations, team rosters, private messages, and other personal data from prompts unless a separately reviewed design explicitly permits and protects that data.
4. Complete adversarial safety, prompt-injection, output-quality, abuse, cost-limit, logging, retention, accessibility, localization, and physical-device testing.

## Secret creation and binding

Only after approval, create the two Firebase Secret Manager values interactively from the repository root. Never put their values in source control, `.env` files committed to Git, app configuration, EAS public environment variables, logs, screenshots, or client bundles.

```powershell
firebase.cmd functions:secrets:set COACH_AI_API_KEY
firebase.cmd functions:secrets:set COACH_AI_ENDPOINT
```

The provider implementation binds both names through its Functions `runWith({ secrets: [...] })` configuration. The endpoint must be HTTPS. Treat both values as server-only credentials and establish rotation, least-privilege, ownership, and revocation procedures.

## Re-enable the backend deliberately

1. Re-review `functions/src/disabled/coachResourceHelp.ts` and `functions/src/coachResourceHelpCore.ts`; do not move the old implementation unchanged without completing the approvals and testing above.
2. Replace the active compatibility stub in `functions/src/coachResourceHelp.ts` with the reviewed provider implementation while preserving the exported callable name, `us-central1` region, timeout, and memory unless a planned migration says otherwise.
3. Keep authentication, validation, safety handling, rate limiting, idempotency, minimal logging, short retention, and output validation in the active implementation.
4. Add explicit Firestore rules/tests for any final collections. Client access must remain denied unless a reviewed product requirement calls for a narrower permission.
5. Run the full validation suite below with the secrets absent, then with approved test secrets in an isolated non-production Firebase project.
6. Change `FEATURE_FLAGS.coachAiEnabled` only after the reviewed backend has been deployed and smoke-tested. Release the client flag in a controlled app version; do not couple it to an untrusted client environment variable.

## Pre-deployment validation

From `C:\Dev\Sideline_Social_Code`:

```powershell
npm.cmd --prefix functions run build
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:coach-resources
npm.cmd run test:emulator:coach-resources
```

Also run the complete Functions, Firestore rules, authentication/account deletion, moderation/reporting/blocking, notifications, Teams, Friends, Squads, Weekly Challenge, and game reward regression suites. Inspect `functions/lib/index.js` and its runtime import graph to verify only the intended implementation is loaded and its endpoint metadata contains the expected secret bindings.

## Deployment sequence after approval

Use the explicit project and deploy the reviewed callable first:

```powershell
firebase.cmd use sideline-squad
firebase.cmd deploy --only "functions:generateCoachResourceHelp"
firebase.cmd functions:list | Select-String "generateCoachResourceHelp"
```

Then deploy the reviewed rules if they changed:

```powershell
firebase.cmd deploy --only "firestore:rules"
```

Do not enable the client flag until callable authentication, error mapping, safety behavior, privacy logging, rate limiting, cost controls, and both English and Spanish UI states pass physical-device testing.

## Rollback

1. Set `FEATURE_FLAGS.coachAiEnabled` back to `false` and ship the client kill-switch release if any released client can call the provider.
2. Restore the authenticated non-secret compatibility stub at `functions/src/coachResourceHelp.ts` and deploy only `functions:generateCoachResourceHelp`.
3. Verify signed-out calls return `unauthenticated`, signed-in calls return `feature_disabled`, and no provider, Firestore, or billing activity continues.
4. Disable or revoke the provider credential and Firebase secret versions according to the incident or rollback plan; do not delete audit evidence required by policy.
5. Keep the callable export during rollback so existing app builds fail safely instead of encountering an unexpected missing-function error.
