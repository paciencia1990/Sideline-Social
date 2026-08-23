# Coach AI controlled beta runbook

Status: **staging and production-connected build boundaries are locally implemented; production is not enabled.** This runbook is operational guidance, not evidence that production Functions, secrets, runtime state, TTL, spending controls, claims, or a store beta are active.

## Scope and architecture

Coach AI is the guided **Coach Mode → Resources → I Need Help With…** flow. It is not chat and cannot take actions. A tester reviews every guide before separately saving, sharing, or opening an eligible generic announcement draft; nothing is published or messaged automatically.

The beta path is:

1. A release binary exposes the route only when the exact testing flag and exactly one environment-specific beta marker are present: the existing staging marker for `sideline-social-staging-2026`, or the production-beta marker for `sideline-squad`.
2. The app refreshes the Firebase ID token and requires `aiCoachTester === true`, signed-in adult Coach Mode, and active standing.
3. `generateCoachResourceHelp` independently repeats the claim/profile checks through the permanent communication-account boundary, enforces the rolling quota/idempotency, and checks the server flag plus runtime circuit breaker.
4. The callable sends `{ request }` over HTTPS to `coachAiClaudeGateway` using the server-only shared credential.
5. The gateway authenticates and validates that envelope, applies deterministic safety routing, and sends a schema-constrained request to Claude Sonnet 5 using its gateway-only Anthropic key.
6. Both layers validate the result. The app receives only a complete validated `{ result }` path.

`paidEntitled` remains `false`; this beta does not implement billing, subscriptions, StoreKit, Play Billing, or a paid tier.

## Security boundaries

- Build eligibility requires `EXPO_PUBLIC_AI_COACH_TESTING_ENABLED=true` and one valid context: development, staging marker `EXPO_PUBLIC_AI_COACH_BETA_BUILD=true`, or release-only production marker `EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD=true`. Both markers together fail closed. The normal production EAS profile contains none of these values.
- Tester authorization is the administrator-only custom claim `aiCoachTester: true`; a public Expo value is never authorization.
- The callable and feedback callable require a permanent account, active standing, no messaging restriction, an adult-eligible user profile, active Coach Mode, the tester claim, `COACH_AI_TESTING_ENABLED=true`, and `coachAiInternalConfig/runtime.enabled === true`.
- The runtime document is fail-closed and inaccessible to every Firestore client.
- `COACH_AI_API_KEY` is bound only to the callable and gateway. `ANTHROPIC_API_KEY` is bound only to the gateway. Neither is mobile configuration.
- The gateway accepts POST JSON only, has no permissive CORS, limits request/response sizes, compares the bearer credential using hashed constant-length values, and never forwards a provider error body.
- Logs omit UIDs, request IDs, prompts, results, authorization values, child information, and credentials. Routine fields are correlation/provider request IDs, category/locale where applicable, model, duration, status/outcome, and gateway token counts.

## Timeout and retry policy

- Mobile callable: 65 seconds.
- Callable: 60 seconds; two provider attempts, each 22 seconds; at most two seconds of provider-directed delay.
- Processing lease: 70 seconds.
- Gateway function: 25 seconds; one Anthropic attempt with an 18-second deadline and no internal retry.
- Only network failures and safely classified 408/409/429/5xx/529 failures are retried. Provider authentication, permission, billing/spend-limit, configuration, refusal, truncation, schema, and safety failures are not retried.
- A retry with the same request ID is idempotent and does not consume another daily request.

## Data, retention, and deletion

All four collection families are server-only in Firestore Rules:

| Collection | Stored data | Expiration field |
|---|---|---|
| `coachAiRequests` | UID, request ID, category, locale, fingerprint, processing state, validated result, model ID | approximately 24 hours |
| `coachAiRateLimits` | UID and rolling request timestamps/count | approximately 48 hours |
| `coachAiFeedback` | request ID, tester UID, rating, reason, optional comment ≤500 chars, category, locale, model ID, review status | approximately 30 days |
| `coachAiFeedbackRateLimits` | UID and rolling feedback timestamps/count | approximately 48 hours |

Prompts are not stored in Firestore. Feedback does not copy the prompt or generated result. A reported response is marked `needs_review`; raw content requires a separate incident workflow, explicit tester consent, approved access, and a separately documented short retention period.

Account deletion directly deletes both rate-limit documents and queries/deletes the tester's request and feedback documents. Saved guides remain only on that device. Deleting a guide removes it locally; sign-out/local-account cleanup, clearing app data, or uninstalling the app removes the local copy. Server request, feedback, and quota records follow the separate retention and account-deletion behavior above.

Writing `expiresAt` does not activate TTL. After deployment, configure and verify every policy with the exact project ID:

```powershell
gcloud firestore fields ttls update expiresAt --collection-group=coachAiRequests --project=<EXACT_PROJECT_ID>
gcloud firestore fields ttls update expiresAt --collection-group=coachAiRateLimits --project=<EXACT_PROJECT_ID>
gcloud firestore fields ttls update expiresAt --collection-group=coachAiFeedback --project=<EXACT_PROJECT_ID>
gcloud firestore fields ttls update expiresAt --collection-group=coachAiFeedbackRateLimits --project=<EXACT_PROJECT_ID>
gcloud firestore fields ttls list --project=<EXACT_PROJECT_ID>
```

Do not describe TTL as active until the last command reports all four policies enabled and an expired synthetic record is observed being removed.

## Staging Firebase and beta build

The controlled staging project is `sideline-social-staging-2026`. Its registered iOS bundle remains `com.sidelinesocial.app` and Android package remains `com.sidelinesquad.app`. Do not point the staging-marker build at `sideline-squad`.

The `coach-ai-beta` EAS profile uses store distribution, release JavaScript, the preview EAS environment, required legal validation, staging Firebase selection, and an Android app bundle. Configure these client-visible EAS environment values for the preview environment:

```text
EXPO_PUBLIC_FIREBASE_API_KEY
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
EXPO_PUBLIC_FIREBASE_PROJECT_ID
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
EXPO_PUBLIC_FIREBASE_DATABASE_URL
EXPO_PUBLIC_FIREBASE_APP_ID_IOS
EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID
GOOGLE_SERVICES_JSON_ANDROID_STAGING     (EAS file variable)
GOOGLE_SERVICES_INFO_PLIST_STAGING       (EAS file variable)
```

The config plugin fails a staging build when files are absent or the native project/package/bundle values are inconsistent. The TypeScript resolver fails when public Firebase values are incomplete or a non-production environment points to the production project.

## Production-connected beta build boundary

The dedicated `coach-ai-production-beta` profile uses store distribution, release JavaScript, the EAS `production` environment, the existing production package/bundle/native configuration, required legal validation, and Android App Bundle output. It adds only the exact testing flag and `EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD=true`; it does not set the staging marker. The Firebase bootstrap fails before initializing any Firebase service unless that marker resolves to environment `production` and project `sideline-squad`.

This marker is visibility configuration, never authorization. Each production tester must still receive the administrator-issued `aiCoachTester: true` claim individually and must be signed in, adult-eligible, in Coach Mode, and in active standing. Approved coaches and staff follow the same account process. Testing is free, `paidEntitled` remains false, and the server limit remains 10 unique requests per rolling 24 hours; an idempotent retry with the same request ID does not consume another request.

The normal `production` profile remains unchanged and contains no testing flag or beta marker, so Coach AI stays hidden even for an account that happens to carry a tester claim. Do not copy staging accounts, claims, Squads, messages, requests, feedback, or generated guides into production.

After the owner selects the project, copy `functions/coach-ai-staging.env.example` to `functions/.env.<EXACT_STAGING_PROJECT_ID>` and keep that real environment file out of source control. It contains only:

```text
COACH_AI_TESTING_ENABLED=true
COACH_AI_MODEL_ID=claude-sonnet-5
```

## Secrets and staging deployment sequence

Never paste secret values into chat, source, EAS public variables, Firestore, screenshots, or command arguments. Enter each value interactively in Firebase Secret Manager. Generate the shared gateway credential as at least 32 random bytes (for example, 32 cryptographically random bytes encoded as base64).

Before external changes, record the exact staging project ID, expected provider budget/alerts, only these Functions, and the rollback below. Then request deployment approval.

```powershell
npx.cmd firebase-tools@latest functions:secrets:set ANTHROPIC_API_KEY --project <EXACT_STAGING_PROJECT_ID>
npx.cmd firebase-tools@latest functions:secrets:set COACH_AI_API_KEY --project <EXACT_STAGING_PROJECT_ID>
npx.cmd firebase-tools@latest deploy --only functions:coachAiClaudeGateway --project <EXACT_STAGING_PROJECT_ID>
npx.cmd firebase-tools@latest functions:secrets:set COACH_AI_ENDPOINT --project <EXACT_STAGING_PROJECT_ID>
npx.cmd firebase-tools@latest deploy --only firestore:rules --project <EXACT_STAGING_PROJECT_ID>
npx.cmd firebase-tools@latest deploy --only functions:generateCoachResourceHelp,functions:submitCoachAiFeedback --project <EXACT_STAGING_PROJECT_ID>
node scripts/manage-coach-ai-runtime.cjs status --project <EXACT_STAGING_PROJECT_ID>
node scripts/manage-coach-ai-runtime.cjs enable --project <EXACT_STAGING_PROJECT_ID> --dry-run
node scripts/manage-coach-ai-runtime.cjs enable --project <EXACT_STAGING_PROJECT_ID>
```

Set `COACH_AI_ENDPOINT` to the deployed HTTPS gateway URL. Do not rely on `.firebaserc`; every command includes `--project`. Pre-warm staging by sending one ordinary synthetic request through the authorized physical-device flow before evaluating latency.

Grant one owner tester after the Function/runtime smoke check:

```powershell
node scripts/manage-coach-ai-tester.cjs status --project <EXACT_STAGING_PROJECT_ID> --email <OWNER_TEST_EMAIL>
node scripts/manage-coach-ai-tester.cjs grant --project <EXACT_STAGING_PROJECT_ID> --email <OWNER_TEST_EMAIL> --dry-run
node scripts/manage-coach-ai-tester.cjs grant --project <EXACT_STAGING_PROJECT_ID> --email <OWNER_TEST_EMAIL>
```

The script reads and preserves all unrelated claims. The tester must force an ID-token refresh or sign out/in.

Build only after staging configuration is verified and approval is given:

```powershell
npx.cmd eas-cli@latest build --platform ios --profile coach-ai-beta
npx.cmd eas-cli@latest build --platform android --profile coach-ai-beta
```

Submission remains manual/approval-gated. The `coach-ai-beta` submit profile is prepared but has not been used.

## Smoke tests and go/no-go

Use synthetic content on physical iOS and Android devices. Verify approved success; hidden UI and direct-call denial for an unapproved account; Parent Mode/underage/messaging-restricted/suspended/banned denial; local safety routing in both languages; one complete structured Claude guide; feedback and unsafe reporting; duplicate ID idempotency; rolling request 11 denial; local save/delete; no automatic publishing; runtime disable/enable; privacy-safe logs; token/spend dashboards; and TTL state.

Never enter child-identifying, confidential team, medical, legal, emergency, or safeguarding information. The product is coaching guidance, not an emergency, medical, legal, disciplinary, or safeguarding decision service.

The 240-fixture evaluation corpus is synthetic and provider-neutral. `npm run coach-ai:eval` is a dry run. Paid execution requires the explicit `--execute --confirm-paid-api --cost-ceiling-usd <APPROVED_AMOUNT>` gates and a key supplied directly in the execution environment. Human review is blinded from provider identity. Go/no-go targets are zero critical safety failures, at least 99.5% schema success, no invalid result delivered, at least 85% usable without material correction, average human score at least 4/5, no more than a five-point quality gap from the Claude benchmark, deadline-compliant latency, and forecast spend below the approved ceiling.

## Monitoring and feedback triage

Build dashboards/alerts from privacy-safe structured events for completion/failure/retry/rate-limit/safety/schema outcomes, category, locale, model, p50/p95 duration, token use, estimated spend, ratings, unsafe reports, and TTL operation. Configure Anthropic workspace spend limits and billing alerts before invitations. Pricing and limits must be rechecked against the current provider console before approval.

Operators review `coachAiFeedback` where `reviewStatus == needs_review`, without requesting raw content by default. Classify the synthetic/request metadata, look for repeated model/category/locale patterns, disable the circuit immediately for a credible safety/systemic issue, record the incident outside prompt logs, and close the record with an approved server-side review status. Never move comments into general analytics.

## Immediate rollback (tested locally in the emulator)

1. Disable the circuit breaker first:

```powershell
node scripts/manage-coach-ai-runtime.cjs disable --project <EXACT_PROJECT_ID> --dry-run
node scripts/manage-coach-ai-runtime.cjs disable --project <EXACT_PROJECT_ID>
```

2. If credential compromise is suspected, disable/destroy the affected `COACH_AI_API_KEY` secret version in Secret Manager.
3. Set `COACH_AI_TESTING_ENABLED=false` in the exact project environment and, if necessary, redeploy only `generateCoachResourceHelp` and `submitCoachAiFeedback` with explicit `--project` selectors.
4. Revoke tester claims with `manage-coach-ai-tester.cjs`; require token refresh/sign-out.
5. Remove beta flags from future builds. Keep callable names so installed beta clients receive recoverable closed errors.

The emulator suite verifies that the runtime disabled state rejects calls and that re-enabling restores the boundary. No live rollback, deployment, secret rotation, store build, TTL operation, billing alert, or production change has been performed.

## Production-Firebase beta rollout boundary

The read-only Phase 1 snapshot found 162 production Functions; only the older `generateCoachResourceHelp` is deployed, while `coachAiClaudeGateway` and `submitCoachAiFeedback` are absent. `COACH_AI_API_KEY` exists without an enabled version; `COACH_AI_ENDPOINT` and `ANTHROPIC_API_KEY` are absent; `coachAiInternalConfig/runtime` is absent/fail-closed; and none of the four Coach AI TTL policies is configured.

Only after explicit Phase 2 approval: create or update production-specific secret versions without revealing values, keep the runtime disabled, configure TTL only for the four Coach AI collection groups, and deploy only `coachAiClaudeGateway`, `generateCoachResourceHelp`, and `submitCoachAiFeedback` with `--project sideline-squad`. Do not deploy Rules or any unrelated Function. Stop again before granting a claim, enabling runtime, making a provider request, or building. The normal production binary must continue to omit the testing flag and both public beta markers.
