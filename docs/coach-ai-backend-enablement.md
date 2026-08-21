# AI Coach development testing and future activation

## Audited implementation

AI Coach is the guided **I Need Help With…** flow under Coach Mode > Resources. It is not a free-form chat or multi-turn conversation. The existing client collects one of nine coaching categories, optional sport/age/practice details, a general situation, desired outcome, and tone. It renders a validated structured guide, supports local device history (up to 25 saved guides), edit/share/delete, and can open eligible announcement drafts for explicit review. Checklists, communication templates, and daily tips are independent non-AI Coach Resources.

The implementation is spread across:

- `app/coach/resources/index.tsx`, `app/coach/resources/help/index.tsx`, and `app/coach/resources/help/result.tsx` for entry, guided request, history, and result UI.
- `types/coachResources.ts`, `services/coachResourcesService.ts`, and `functions/src/coachResourceHelpCore.ts` for request/result contracts, local persistence, callable access, validation, and safety responses.
- `functions/src/coachResourceHelp.ts` and the export in `functions/src/index.ts` for the server-mediated provider boundary.
- `i18n/index.ts` for English and Spanish copy.
- `scripts/test-coach-resources-core.cjs`, `scripts/test-coach-ai-access.ts`, `scripts/test-coach-resources-functions-emulator.cjs`, and `scripts/test-coach-ai-firestore-rules.cjs` for focused regression coverage.

There is no StoreKit, Google Play Billing, RevenueCat, subscription service, AI paywall, or paid entitlement implementation in this repository. The prior feature was hidden by the hard-coded `FEATURE_FLAGS.coachAiEnabled: false`; direct routes and the client service also failed closed. The prior active callable was an authenticated feature-disabled stub. A second unfinished provider implementation lived under `functions/src/disabled`; its reviewed logic is now consolidated into the active source and the disconnected duplicate is removed.

## Current development-only access model

Three independent decisions remain separate:

1. **Build availability:** `EXPO_PUBLIC_AI_COACH_TESTING_ENABLED` must equal exactly `true`, and React Native `__DEV__` must also be true. Missing, `false`, `TRUE`, whitespace-padded, or any other value is off. Store/production JavaScript has `__DEV__ === false`, so it remains off even if an environment is misconfigured. No EAS profile enables the flag.
2. **Client entitlement/context:** the temporary entitlement source is `development-testing` for AI Coach only. It does not alter `tier`, premium state, purchases, or any other feature. UI access additionally requires a signed-in account with `adultEligibilityConfirmed === true`, active Coach Mode, and active account standing. The `paid` entitlement input is deliberately false and reserved for future server-validated purchases.
3. **Backend permission:** the callable independently requires the exact server flag `COACH_AI_TESTING_ENABLED=true`, a permanent Firebase account with the administrator-only custom claim `aiCoachTester: true`, active (not messaging-restricted, suspended, or banned) standing, and a server-read adult Coach Mode profile. Normal app UI cannot grant the claim or enable the server flag.

The Functions emulator is treated as a server testing environment but still requires the tester claim and all user/account checks. This exception is not present in deployed production Functions.

## Viewing the existing UI on a development client

From the repository root in PowerShell:

```powershell
$env:EXPO_PUBLIC_AI_COACH_TESTING_ENABLED="true"
npm.cmd run start:dev-client -- --clear
```

Open the existing Sideline Social development client, sign in with an adult-eligible account, switch to Coach Mode, and open Resources. This is a JavaScript-only flag and UI change; an already compatible Expo SDK 57 development client does not need a new native build. Restart Metro without the variable (or set it to anything other than exact `true`) to hide the entry again.

The current deployed `generateCoachResourceHelp` callable still represents the pre-change disabled stub because this work intentionally performs no deployment. The UI can therefore be reviewed on a phone, but live generation will show the localized recoverable configuration state until the reviewed test backend is deployed and configured.

## Provider and deployment audit

The Firebase project currently lists `generateCoachResourceHelp` as a deployed v1 callable in `us-central1` on Node.js 22. Repository history and source identify that deployment path as the compatibility stub; this audit did not invoke it with production user data or redeploy it.

The preserved integration is a provider-neutral HTTPS adapter. No provider company or model is hard-coded. It POSTs only the explicit guided request as `{ request }` with a server-side bearer credential and expects either a validated structured result or `{ result: ... }`. The diagnostic model identifier defaults to `provider-managed` unless the non-secret server value `COACH_AI_MODEL_ID` is configured. Consequently, a specific model/provider cannot honestly be identified from this repository.

Metadata-only Secret Manager checks found:

- `COACH_AI_ENDPOINT`: secret not found.
- `COACH_AI_API_KEY`: secret object exists, but no enabled secret version was listed.

No secret values were accessed. No AI credential exists in Expo public configuration, client source, EAS production configuration, Firestore, or local checked-in environment files. With the endpoint absent and no enabled API-key version, provider generation cannot currently work.

Before an isolated test deployment, an approved provider endpoint and API key must be created as enabled server-only secret versions, the provider/model and data terms must be approved, `COACH_AI_TESTING_ENABLED=true` must be set only on the intended backend test environment, and the designated test account must receive the `aiCoachTester` custom claim through an administrator-controlled process. The client must sign out/in or refresh its ID token after a claim change. None of those external changes are performed here.

## Limits, safety, privacy, and records

The callable is server-mediated and enforces:

- 10 unique requests per authorized tester in a rolling 24-hour window.
- Transactional request reservation, fingerprint conflict detection, processing leases, and idempotent replay so rapid taps/concurrent duplicates do not multiply provider work or usage counts.
- Request field limits (including 1,500 characters for situation and 500 for desired outcome), structured output limits (including 5,000-character body, bounded sections/lists), and a 128 KB provider response ceiling.
- At most two provider attempts, each limited to nine seconds, within a 30-second callable timeout. Only transient network, timeout, 408, 429, and 5xx failures are retried.
- English/Spanish high-risk keyword routing to a local safety response that directs testers to emergency, safeguarding, medical, or authority processes instead of generating provider guidance.
- Privacy-safe logs containing only UID, request ID, stage, duration, model identifier, and sanitized outcome. Full prompts, responses, child information, email addresses, auth tokens, and credentials are not logged.

Only the fields explicitly entered in the guided form are sent to the provider. The code does not attach child names, rosters, team data, private messages, contacts, or locations. The UI displays a localized warning not to enter names, diagnoses, contact details, addresses, school records, or other identifying/confidential information.

`coachAiRequests` stores a fingerprint, minimal category/locale metadata, status, and the validated result for idempotency; it intentionally does not store the prompt. Records include an `expiresAt` 24 hours after creation. `coachAiRateLimits` stores the rolling window and count. Firestore Rules currently default-deny both collections to all clients, with explicit emulator coverage; no new client rule or composite index is needed. A Firestore TTL policy for `coachAiRequests.expiresAt` still needs to be configured before backend activation because writing `expiresAt` alone does not delete records.

On-device generated/saved guides are namespaced by user and cleared by the existing sign-out/account-switch cleanup. No cloud conversation history exists. There was and remains no AI-specific content-reporting or thumbs-up/down control; generated text can be edited, shared through the OS, or deleted locally.

## Functional state and recoverable errors

The existing category-first, multiline, keyboard-aware flow and structured result screen remain intact. The development preview adds a localized label, immediate rapid-tap locking, retry with the same request ID, and local cancellation. Cancellation prevents late caching/navigation, although an already-started server request may finish and count toward the daily limit. Errors are localized for access, missing configuration, rate limit, timeout, offline/unavailable network, provider failure, and unknown failure; the entered form remains available for retry. Results and the form survive ordinary backgrounding through route/component state and local result caching, while sign-out clears user-scoped history.

Accessibility support includes button roles/states, radio state, live loading/error announcements, multiline labels, scalable text, safe-area screen wrappers, and focus transfer to a generated result heading. English and Spanish keys are kept in parity. No automatic sending occurs.

## Work remaining for real monetization and production

Before production activation:

1. Select and contract the provider/model; approve data processing, retention, deletion, subprocessors, regional processing, safety, and incident response.
2. Create App Store and Google Play subscription products and implement purchase, restoration, receipt/transaction validation, server-owned entitlements, expiration, cancellation, grace periods, refunds, family/account rules, and cross-platform reconciliation.
3. Replace the `paidEntitled: false` adapter with the server-validated entitlement without changing build availability or backend permission boundaries.
4. Complete adversarial safety, prompt-injection, output-quality, abuse, moderation/reporting, accessibility, localization, offline, and physical-device testing.
5. Add usage dashboards, provider budget alerts/hard ceilings, per-model cost monitoring, retention/TTL monitoring, and operational rollback controls.
6. Update the privacy inventory, Privacy Policy, Terms, in-app disclosures/consent, App Store privacy answers, Google Play Data safety answers, and App Review/Play review configuration.
7. Deploy and smoke-test the callable and TTL policy in an isolated non-production project. Only after approval should production secrets/configuration be created, the callable be deployed, and a separate production feature rollout/rollback plan be executed.

## Rollback

Remove `EXPO_PUBLIC_AI_COACH_TESTING_ENABLED` (or set any value other than exact `true`) and restart Metro to hide the development entry. For any future backend test deployment, set `COACH_AI_TESTING_ENABLED` to a non-`true` value and remove tester custom claims to stop requests. Keep the callable name so older clients receive a recoverable closed response. Provider credentials can then be disabled under the approved incident procedure.
