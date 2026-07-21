# Sideline Social privacy-policy fact sheet

Status: **verified engineering facts plus conspicuous decision placeholders. This is not legal prose and is not the final Privacy Policy.** A single unified policy can cover iOS and Android, with a short Platform-Specific Information section for notification delivery, Firebase files and Android development-build differences.

## Policy identity

- Product: Sideline Social
- Platforms: iOS and Android
- Operator legal name: **[OWNER REQUIRED]**
- Privacy contact: **[MONITORED EMAIL/FORM REQUIRED]**
- Mailing address: **[COUNSEL/OWNER DECISION IF REQUIRED]**
- Effective date / last updated: **[REQUIRED]**
- Jurisdiction, governing law, legal bases, consumer-rights regions and representative/DPO: **[COUNSEL REQUIRED]**

## Facts the policy must cover

### Data users provide

- Adult first and last name, email, password submitted directly to Firebase Authentication, optional ZIP code and sports preferences.
- Child display names entered and controlled by a parent/adult account.
- Team/Squad membership, roles, invite/join actions, team-child links, venue/sport information and selections.
- Friend requests, blocks, announcements, replies, private/group messages, reports and other free-form content.
- Optional voice recordings plus duration/size/MIME metadata.
- No active phone-number, camera/photo-library upload, payment or subscription flow was found. A profile `photoURL` schema/HTTPS URL path exists and must be re-audited if enabled.

Do not say Sideline Social stores raw passwords. The app passes credentials to Firebase Authentication.

### Automatically generated or device-derived data

- Firebase UID and authorization/membership identifiers.
- Optional foreground current or last-known coordinates for nearby Squad search; precise coordinates are transmitted to a Firebase callable but not intentionally saved as a user-location history.
- Venue coordinates/geohash stored with a Squad and visible on authenticated community map surfaces.
- Push registration token, platform, notification delivery ticket/receipt linkage, notification route/read/dismiss/open state.
- Game session/player/readiness/connected state, answers/state, scores, Sideline Stars, rewards, weekly challenge assignment/completion and device IANA time zone.
- Firebase/Cloud operational request metadata may include IP addresses, resource identifiers and technical service data; provider settings and retention require confirmation.
- On-device AsyncStorage stores mode/onboarding/selected Squad/retry/game state; account deletion clears local storage.

### Child-related information

- Sideline Social is designed for adult parents/coaches, not direct child accounts.
- Adults enter child display names and associate stable child IDs with teams.
- Child profiles are private to the parent; child/team roster data is restricted to authorized team functions/members.
- Child-related information can also be typed or spoken by adults in UGC; generic push bodies do not reveal it on the lock screen.
- Signup currently has no technical age/adult attestation. Intended audience, minimum age and whether to add an age gate/attestation are **[PRODUCT/COUNSEL REQUIRED]**.

### Purposes

- Account creation, authentication, recovery and account management.
- Parent/Coach mode, Teams, Squads, venue discovery and team/Squad administration.
- Friends, messaging, announcements, voice communication and notifications.
- Games, leaderboards, Sideline Stars, Weekly Challenge and app personalization.
- Authorization, abuse prevention, reporting, moderation evidence, security and support.
- No active advertising, cross-app tracking, billing or analytics purpose was found.

### Service providers

- Google Firebase: Authentication, Cloud Firestore, Realtime Database, Storage, Cloud Functions and Android FCM.
- Expo: application runtime/build tooling; Expo Push Service for the iOS delivery path; location/audio/notifications modules.
- Apple APNs for iOS push delivery.
- Native maps provider (Apple or Google depending final iOS configuration; Google maps on Android is expected): map tiles and possibly technical/location request data.
- Apple/Google app stores and EAS Build process app/build/account metadata outside normal in-app collection; final policy scope/contract wording requires review.

Describe providers as processors/service providers only after contracts and settings confirm that role. Disclose international processing/storage and subprocessors based on approved provider terms: **[OWNER/COUNSEL REQUIRED]**.

### User-generated content and recipients

- Team content is visible to authorized team participants; friend/group content to intended participants; Squad profiles/leaderboards to authenticated eligible surfaces.
- Content is not end-to-end encrypted; Firebase/backend access is technically possible subject to rules/operator controls.
- Reporting may create a restricted evidence snapshot. Blocking applies to friend chat and is enforced in backend delivery/query paths; team-level blocking is not implemented.
- Technical reports/status fields do not equal a staffed moderation program. Publish only approved, real procedures and contacts.

### Location

- Foreground only; Android approximate and precise permissions, iOS when-in-use.
- Requested contextually for nearby discovery; manual venue-name search remains available after denial.
- No background location, live sharing or IP-derived application location logic found.
- Current coordinates are application-ephemeral; venue coordinates persist with Squad data.

### Notifications

- Permission is optional/contextual. Android uses FCM device tokens; iOS uses an Expo push token delivered through Expo/APNs.
- Tokens are linked to the signed-in UID for delivery, removed best-effort on sign-out and on account deletion/invalid receipt.
- Lock-screen title/body are generic. Route identifiers travel in the push data payload.

### Audio/media

- Microphone is requested only after Record; text remains available if denied.
- Voice memo is temporarily local, limited to 90 seconds/2 MB, previewed before send, then stored in Firebase Storage with authorization-gated signed playback URLs.
- Local drafts and authored remote audio are deleted by their respective cleanup paths.
- Bundled game art, icons and animation assets are product content, not collected user media.

### Security facts

- Authenticated callables and Firebase rules protect private collections; report collections deny ordinary client access.
- Storage direct reads are denied and playback uses time-limited authorized URLs.
- TLS/HTTPS is expected for active provider traffic; the release manifest does not enable debug cleartext traffic.
- Logs intentionally avoid passwords, tokens and message bodies; deletion logs include only a truncated SHA-256 UID hash and counts.
- Do not promise absolute security. Final incident response, access review, backups and administrator controls require operator confirmation.

### Retention and deletion

- Account deletion is available in-app under Profile → Account Settings and requires password reauthentication plus destructive confirmation.
- Backend cleanup is retryable/idempotent and deletes Firebase Auth last. Sole owners/admins must transfer responsibility first.
- Profiles, children, memberships, tokens, many game/reward/action records, authored announcements/replies and voice files are deleted. Shared messages/notifications and safety reports may remain anonymized.
- Local source now also removes Squad season totals/creator references and denormalized conversation UID references; this must be deployed and verified before the policy claims it as production behavior.
- Moderation reports may be retained without account UIDs. Exact periods/reasons for moderation evidence, logs, backups, support requests and legal holds: **[COUNSEL/OWNER REQUIRED]**.
- A public web deletion-request page is required and not yet published. See `docs/account-deletion-webpage-requirements.md`.

### Rights and choices

- Edit adult name/profile fields and child profiles; remove a child only after active team links are resolved.
- Join/leave teams and Squads subject to ownership/admin safety rules.
- Block/unblock friend-chat users; report content/users; remove own content where supported.
- Revoke location, microphone and notifications in system Settings; use manual/text alternatives.
- Request account deletion in app and, once published, through the web resource.
- Region-specific access/correction/portability/objection/appeal rights and response periods: **[COUNSEL REQUIRED]**.

### Advertising, tracking, analytics and purchases

- No ad SDK, attribution SDK, IDFA/ATT, Android Advertising ID use, cross-app tracking, Firebase Analytics initialization, Crashlytics, Performance, Play Billing, IAP, RevenueCat or purchase/entitlement record was found.
- Re-audit the signed binaries and provider dashboards before stating this publicly.

### Coach AI

- `coachAiEnabled` is false. Client UI does not call the backend; active callable is an authenticated non-secret disabled stub; unfinished provider code is outside the runtime import graph.
- Do not disclose current prompt/provider/model processing because none is active.
- Before any enablement, update the policy, Apple/Play disclosures, consent/notice, provider list, retention/deletion and child/personal-data restrictions.

## Platform-Specific Information wording facts

- Android production (`com.sidelinesquad.app`) uses FCM directly; iOS (`com.sidelinesocial.app`) uses Expo Push/APNs.
- Android manifest declares coarse and fine location, record audio and modify audio; iOS uses when-in-use location/microphone purpose strings and runtime notification authorization.
- The separately installable Android development package (`com.sidelinesquad.app.dev`) includes development-client/Metro behavior and is not the Play production package.
- Final iOS map provider/Firebase plist and notification entitlement require signed-archive confirmation.

These differences fit within one unified policy; they do not justify separate policies.

## Public pages that must exist

1. Privacy Policy: named as such, public HTTPS HTML, operator/contact, all verified collection/use/sharing/security/retention/deletion facts, platform-specific section and rights.
2. Terms of Use: operator, account eligibility, acceptable use, UGC license/ownership, service limits, termination, dispute/jurisdiction language approved by counsel.
3. Community Guidelines: prohibited content/conduct, child/privacy protection, reporting, moderation/enforcement, appeals and emergency/CSAM escalation language that matches real operations.
4. Support page: monitored contact, hours/expectations, account access/deletion/help routes, safety reporting and accessibility/language options.
5. Account deletion page: dedicated public resource described in `docs/account-deletion-webpage-requirements.md`, also linked from a prominent privacy-policy anchor.

## Decisions not to invent

Operator entity/contact/address; minimum age/audience; legal bases; retention periods; backup deletion; jurisdictions; international transfer mechanisms; DPO/representative; law-enforcement/CSAM escalation; moderator staffing, response targets, sanctions and appeals; support hours; map provider; Firebase/Expo provider settings; and final public URLs all require real owner/legal confirmation.
