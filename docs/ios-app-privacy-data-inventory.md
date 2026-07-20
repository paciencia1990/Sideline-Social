# iOS App Privacy Data Inventory

Status: **draft for owner/privacy counsel review; do not copy blindly into App Store Connect.** “Linked” means tied to an account, team, Squad, conversation, or device token. No tracking or third-party advertising behavior was found.

| Apple data type | Examples in Sideline Social | Purpose | Linked | Tracking | Retention/deletion note |
|---|---|---|---|---|---|
| Name | Adult first/last/display name; child profile name | Account, social identity, private team participation | Yes | No | Adult/child profiles deleted with account; authored references anonymized |
| Email address | Firebase Auth email and private user document | Authentication, password reset, account support | Yes | No | Auth and profile deleted |
| Phone number | Optional profile field if supplied | Account/profile functionality | Yes | No | Deleted with profile; confirm whether UI still collects it |
| User ID | Firebase UID and membership/author IDs | Authentication, authorization, synchronization, fraud/safety | Yes | No | Deleted or removed; moderation records anonymized |
| Device ID | Notification token and hashed token-document key | Push notifications, security/abuse prevention | Yes | No | Removed on sign-out/account deletion or invalid receipt |
| Precise location | Current coordinates after Find Nearby; venue coordinates | Nearby Squad discovery and map display | Yes/possibly transient | No | Current coordinate is not intentionally stored on the user profile; venue coordinates persist. Confirm native map/provider transmission |
| Other user content | Team/Squad data, child profiles, friend requests, announcements, replies, chat text, names, RSVPs | App functionality and community features | Yes | No | Deleted, removed, or anonymized according to ownership and moderation constraints |
| Audio data | User-recorded team voice messages | Team communication | Yes | No | Storage object and document deleted/anonymized with authored content/account |
| Photos or videos | Profile `photoURL` schema exists; no audited photo-library/camera upload flow | Profile functionality if enabled | Yes | No | Confirm actual production collection; delete stored profile reference/object if feature is enabled |
| Gameplay content | Sessions, answers, scores, completion/reward records | Games, leaderboards, app functionality | Yes | No | Account-linked records deleted where implemented; aggregate leaderboard retention requires review |
| Product interaction | Read/dismiss state, membership activity, feature state | App functionality | Yes | No | Account data deleted; local AsyncStorage cleared |
| Crash/performance/diagnostics | Native Maps manifest declares diagnostics categories; no first-party crash SDK initialized | App functionality/diagnostics | Provider-dependent | No | Validate merged archive and provider disclosures |
| Other diagnostic data | AI request status/usage metadata for coach help | App functionality, abuse/cost controls | Yes | No | Request documents deleted by account deletion; generated content policy requires review |

## Services and recipients

| Service | Data involved | Role/purpose |
|---|---|---|
| Firebase Authentication | Email, UID, profile name | Sign-in and password reset |
| Cloud Firestore | Profiles, teams, Squads, chat, notifications, gameplay, moderation | Primary application database |
| Firebase Realtime Database | Live game sessions/players | Multiplayer state |
| Firebase Storage | Voice memo files | User-requested team audio |
| Cloud Functions | Auth context and feature payloads | Trusted authorization, notifications, moderation, deletion, rewards |
| Expo Push Service | Expo push token, generic alert, navigation identifiers | iOS notification delivery and receipts |
| Firebase Cloud Messaging | Android token, generic alert, navigation identifiers | Android notification delivery |
| Apple Push Notification service | Device delivery metadata and generic alert | iOS remote notifications through Expo |
| Native map provider | Map tiles/usage and potentially device location | Venue and nearby discovery maps |
| Device storage (AsyncStorage) | Auth persistence, mode/language, onboarding, local retry/game/resource state | Local app functionality |

## Explicit negatives found in source

- No advertising SDK or ads.
- No ATT request, IDFA access, fingerprinting, or cross-app tracking.
- No third-party analytics initialization.
- No contacts/address-book access.
- No camera or photo-library permission.
- No payment, subscription, financial, health, or fitness data flow.
- No background location.

## Required owner decisions

1. Confirm whether optional phone and profile-photo fields are active in the submitted UI/data.
2. Decide and publish retention periods for moderation reports, security logs, backups, aggregated rewards/leaderboards, and support records.
3. Confirm map-provider data practices from the final iOS archive and vendor terms.
4. Confirm whether coach AI functionality will be enabled in production and identify the configured processor; do not include personal/child data in prompts.
5. Have privacy counsel approve treatment of child names and parent-controlled team data.
6. Match final App Store Connect answers to the signed build and published Privacy Policy.
