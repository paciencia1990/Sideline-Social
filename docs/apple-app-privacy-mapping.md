# Apple App Privacy mapping

Status: **PRELIMINARY — REQUIRES OWNER/PRIVACY-COUNSEL REVIEW AND FINAL IPA VERIFICATION.** Do not submit these answers from this document alone. The normal production binary hides Coach AI; any distributed `coach-ai-beta` build must include the conditional Coach AI disclosures below.

Apple treats data as collected when the app or a third-party partner transmits it off device and retains it beyond real-time servicing; data is generally linked when tied to an account/device. Apple specifically directs apps with private messaging to declare Emails or Text Messages, game logic to declare Gameplay Content, and free-form text/voice to declare Other User Content and Audio Data. Source: <https://developer.apple.com/app-store/app-privacy-details/>.

## Recommended collected data types

| Apple category / data type | Collect? | Purposes | Linked to user | Tracking | SDK/provider and evidence | Recommended App Store Connect answer / caveat |
|---|---:|---|---:|---:|---|---|
| Contact Info — Name | Yes | App Functionality; Product Personalization | Yes | No | Firebase Auth/Firestore; adult profile, public first + last initial, adult-entered child name; `AuthContext.tsx`, `childService.ts`, `publicUserProfileCore.ts` | Select collected, linked, not tracking. Explain child names are entered by adults and team-restricted |
| Contact Info — Email Address | Yes | App Functionality | Yes | No | Firebase Authentication and private user profile | Select collected, linked, not tracking |
| Contact Info — Phone Number | No current active flow | — | — | No | Optional schema/type only; no collection UI found | Do not select unless final build/account backend actually accepts it |
| Contact Info — Physical Address | No | — | — | No | No address collection found; ZIP is optional and needs purpose confirmation | Do not select. Reassess ZIP if used as location/address |
| Location — Precise Location | Yes, optional | App Functionality | Yes in authenticated request; persisted venue coordinate is Squad-linked | No | Expo Location → nearby callable; Firebase; native maps | Select Precise Location, App Functionality, linked, not tracking. Current GPS is application-ephemeral but transmitted; venue coordinates persist |
| Location — Coarse Location | Possibly | App Functionality | Yes | No | User may grant reduced accuracy; optional ZIP exists | Owner should confirm whether to select Coarse Location in addition to Precise based on final iOS behavior and ZIP use |
| Identifiers — User ID | Yes | App Functionality | Yes | No | Firebase UID across Auth/Firestore/RTDB | Select collected, linked, not tracking |
| Identifiers — Device ID | Yes | App Functionality | Yes | No | Expo push token/APNs delivery identifier associated with UID | Select Device ID, linked, not tracking; confirm Expo/Apple provider treatment |
| User Content — Emails or Text Messages | Yes, optional | App Functionality | Yes | No | Friend chat, team/private messages, announcements/replies in Firestore | Select; these are not end-to-end encrypted and are readable by authorized backend/operator access |
| User Content — Other User Content | Yes, optional | App Functionality; Safety | Yes | No | Team/Squad/child data, reports, free-form content and RSVP-style replies; beta Coach AI guided fields and optional feedback comment are processed by Firebase/Anthropic | Select collected, linked, not tracking. For a beta build, describe AI processing and prohibit child/confidential identifiers |
| Other Data — generated Coach AI guide and model/request metadata | Conditional beta | App Functionality; Safety | Yes | No | Validated guide/request metadata retained about 24h; rating/reason/model metadata about 30d; content-free provider/token diagnostics | Include for any beta binary after counsel maps the generated guide to the current App Store Connect taxonomy; TTL/provider retention must be verified |
| User Content — Audio Data | Yes, optional | App Functionality | Yes | No | Expo Audio; Firebase Storage voice memo | Select collected, linked, not tracking |
| User Content — Photos or Videos | No current active upload | — | — | No | `photoURL` schema/HTTPS URL support exists, but no camera/photo picker/upload flow found | Do not select unless final binary enables profile-photo collection or upload |
| Usage Data — Gameplay Content | Yes, optional | App Functionality | Yes | No | RTDB/Firestore sessions, answers/state, scores, reward records | Select collected, linked, not tracking |
| Usage Data — Product Interaction | Yes | App Functionality; Product Personalization | Yes | No | Notification read/dismiss/open state, memberships, selected Squad, challenge completion, social actions | Select collected, linked, not tracking. Do not label as Analytics; no analytics use was found |
| Diagnostics — Crash Data | No app-directed collection found | — | — | No | No Crashlytics/Sentry/Expo error reporting SDK | Do not select after final archive confirms absence |
| Diagnostics — Performance Data | No app-directed collection found | — | — | No | No Firebase Performance or equivalent | Do not select after final archive confirms absence |
| Diagnostics — Other Diagnostic Data | Requires provider confirmation | App Functionality/security if applicable | Potentially | No | Firebase service data/Cloud Functions logs may include IP, request metadata and resource IDs; application logs avoid content/tokens and deletion logs hash UID | Do not select solely from server operational logs without counsel/provider review; resolve before submission |
| Search History | Nearby venue search query is transmitted but not intentionally stored | App Functionality | Yes in request | No | `searchVenueSportSquads` callable | Likely real-time service request; confirm optional-disclosure/ephemeral treatment with counsel |
| Sensitive Info, Health & Fitness, Financial Info, Purchases, Contacts, Browsing History, Advertising Data | No current collection found | — | — | No | No active fields/SDKs/features | Do not select after final binary confirmation |

## Tracking and advertising recommendation

Recommended preliminary answers:

- Data used to track: **No**.
- App Tracking Transparency prompt: **No**; no `NSUserTrackingUsageDescription`, IDFA, advertising SDK, data broker, retargeting or cross-app advertising behavior was found.
- Third-party advertising, developer advertising/marketing: **No current use found**.

This requires a final archive/dependency scan and confirmation that Firebase, Expo Push and map-provider settings do not enable undisclosed analytics/advertising use.

## Optional-disclosure exemptions

Do not rely broadly on Apple's infrequent/optional user-provided-data exemption. Messaging, voice, teams, location discovery and gameplay are normal app features, not rare edge cases. Current GPS used only to answer nearby discovery may be real-time application processing, but because it is transmitted through an authenticated Firebase callable and provider request metadata may exist, the conservative recommendation is to disclose Precise Location.

## Platform/provider decisions still blocking submission

1. Confirm the exact `GoogleService-Info.plist` and Firebase iOS registration embedded in the archive; two iOS registrations exist in the project.
2. Confirm APNs/Expo Push credentials, provider contracts, delivery and ticket retention.
3. Confirm whether iOS maps use Apple Maps or Google Maps in the final binary and review that provider's data practices.
4. Inspect final IPA entitlements, privacy manifests, required-reason APIs and linked SDKs.
5. Approve treatment of Firebase operational IP/request metadata and logs.
6. Deploy and verify the local account-deletion and public-name minimization corrections, then repair existing public projections.
7. Approve operator identity, retention, child-data, UGC operations and public policy/support URLs.

## Evidence boundary

The Firebase project contains a deployed callable set, but function-name presence does not prove deployed source parity. These recommendations reflect current local source plus deployed architecture inventory, not a signed IPA or a version-hash comparison.
