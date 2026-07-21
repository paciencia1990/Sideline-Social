# Account deletion webpage requirements

Status: design specification only. **No webpage was published.** Owner/legal approval and a monitored support workflow are required.

Google Play requires apps that create accounts to offer both an in-app deletion path and a public web resource that lets users request account and associated-data deletion without reinstalling the app. Official guidance: <https://support.google.com/googleplay/android-developer/answer/13327111>.

## Recommended resource

Use a dedicated, publicly accessible HTTPS HTML page titled:

> Delete your Sideline Social account and data

A dedicated page is safer for Play review and easier to test than only an anchor inside a long policy. Also include a prominent `#account-deletion` section in the unified Privacy Policy that links to this page. The page must not be a PDF, require app installation, require login to a deleted/inaccessible account, be geofenced, or redirect only back into the app.

Public URL: **[OWNER REQUIRED — HTTPS ACCOUNT-DELETION URL]**

## Required page content

1. Clearly identify the app as **Sideline Social** and the operator as **[LEGAL OPERATOR NAME REQUIRED]**.
2. Explain the automatic in-app path:
   - Sign in.
   - Open Profile → Account Settings → Delete Account.
   - Enter `DELETE`, enter the current account password, confirm deletion.
   - The app reauthenticates and begins server cleanup immediately.
3. Provide a web form or monitored request channel for users who cannot access the app:
   - account email address;
   - optional current display name only if needed to resolve ambiguity;
   - request type: delete account and associated data;
   - a safe reply address if different;
   - no password, child name, invite code, notification token, Firebase UID, message content or government ID requested through an ordinary form/email.
4. State the verification process without inventing it. Recommended design: send a single-use, time-limited verification link to the Firebase Auth email. If that is impossible, route to a trained support process approved by security/legal. **[OWNER/SECURITY DECISION REQUIRED]**.
5. State an expected completion timeframe: **[LEGAL/OPERATIONS APPROVED PERIOD REQUIRED]**. Do not publish the draft 24/72-hour moderation targets as deletion commitments.
6. Give request status/support contact: **[MONITORED SUPPORT URL/EMAIL REQUIRED]**.
7. Tell users they do not need to reinstall the app and can complete the request entirely from the web/support path.
8. Explain how the requester will receive confirmation and how failed verification or sole-owner transfer requirements are handled.

## Factual deletion categories

After successful verification and safe ownership preflight, current source is designed to delete:

- Firebase Authentication account;
- private account/profile and minimized public social profile;
- adult-entered child profiles and parent-child-team links;
- notification inbox and device push tokens;
- friend requests, friend relationships and block records;
- team and Squad membership plus administration requests;
- authored announcements/replies and their voice files;
- authored message body/audio, with shared message documents anonymized where conversation continuity is retained;
- game participation, Trivia player data, reward-session records, activity and account-scoped Weekly Challenge/reward history;
- Squad season member total/contribution records under the local 2026-07-20 correction;
- historical `coachAiRequests` records if any exist from earlier/dormant work;
- local application data after the in-app flow succeeds.

Team/Squad/community records may remain after safe ownership transfer because they belong to other active participants. Empty conversations/sessions may be deleted; shared conversations can become read-only. An active sole team owner or sole Squad administrator must first transfer ownership or add a successor.

## Retained/anonymized categories

The page and Privacy Policy must accurately disclose:

- safety/moderation reports may be retained with reporter and reported account UIDs nulled;
- shared private-message documents may remain with empty body, no voice file, `Deleted user`, and null sender UID;
- notifications in another account may remain with actor changed to `Deleted user` and null actor UID;
- team/Squad/season records may remain after ownership transfer, with creator/closer identifiers transferred or anonymized;
- provider security/operational logs and backups may persist for provider/legal periods not yet approved;
- records required for security, fraud prevention, legal obligations or dispute handling may be retained only if an approved purpose and period exists.

Retention periods and legal reasons: **[PRIVACY COUNSEL/OWNER REQUIRED]**. Do not publish “indefinite,” “as long as needed,” or a made-up number.

## Three distinct workflows

| Workflow | Current status | Authentication/verification | Result |
|---|---|---|---|
| Automatic in-app deletion | Implemented in source and emulator tested | Current password reauthentication; callable uses authenticated UID | Immediate cleanup attempt; retryable because Auth is deleted last |
| Web deletion request | Not implemented/published | **[Design/owner decision required]**; recommended verified-email link | Must trigger the same backend policy or an equally complete privileged process |
| Support-assisted deletion | Operational process absent | Restricted trained staff; strong verification; least-privilege tooling | Must log the request without copying unnecessary personal/child content and confirm completion |

The web form must not call an admin deletion endpoint directly from an untrusted browser. It should create a rate-limited, abuse-resistant verified request or use a monitored support queue. Do not expose service credentials or return whether arbitrary email addresses have accounts.

## Pre-publication acceptance checks

- Public HTTPS, mobile readable, no login/reinstall requirement, no broken links.
- Operator/app identity exactly matches the Play listing and unified Privacy Policy.
- Monitored contact and approved response period are real.
- Verification is tested for active, signed-out, inaccessible, already-deleted and mistyped-email cases without account enumeration.
- Sole-owner/admin transfer instructions are understandable.
- Categories deleted/retained match the deployed backend, not merely local source.
- Local season/conversation cleanup and public-profile minimization are deployed and verified first.
- English and Spanish versions are approved, materially equivalent and accessible.
- The URL is entered in Play Console's account deletion field and linked from the Privacy Policy/support page.
