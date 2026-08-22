# Google Play Data Safety mapping

Status: **PRELIMINARY — REQUIRES OWNER REVIEW.** Do not submit this worksheet. It reflects the current production-capable Android source and integrated SDKs. The normal production binary hides Coach AI; any internal-testing `coach-ai-beta` App Bundle must include the conditional AI rows below.

Google defines “collected” as data transmitted off device, including SDK transfers and pseudonymous data. Real-time memory-only processing must still be evaluated as ephemeral. Service-provider and user-initiated-transfer exceptions may mean data is not “shared,” but contracts and actual provider use must support the exception. Sources: <https://support.google.com/googleplay/android-developer/answer/10787469> and <https://support.google.com/googleplay/android-developer/answer/13327111>.

## Top-level preliminary answers

| Question | Preliminary answer | Qualification |
|---|---|---|
| Does the app collect user data? | **Yes** | Account, social/team, child, communications, location, audio, notification identifiers, gameplay and safety data leave the device |
| Does the app share user data? | **No, if processor/user-directed-transfer exceptions apply** | Firebase/Google, Expo and Apple are intended delivery/hosting processors; users direct content to teammates/friends. Contracts and map-provider behavior must be confirmed |
| Is data encrypted in transit? | **Yes** | Firebase and Expo endpoints use TLS/HTTPS; verify final maps/network configuration and no cleartext release traffic |
| Can users request deletion? | **In app: yes. Web: not yet** | Do not claim full Play compliance until a public non-PDF web resource exists and the local deletion corrections are deployed/verified |
| Independent security review? | **No evidence** | Do not claim one |
| Ads? | **No** | No ad SDK or advertising-ID access found |

## Data-type answers

| Play category / type | Collected | Shared | Ephemeral | Required/optional | Purposes | Provider/evidence | Deletion | Recommended answer / decision |
|---|---:|---:|---:|---|---|---|---|---|
| Location — Approximate location | Yes | No* | Current coordinate: yes; venue: no | Optional | App functionality | Expo Location → Firebase Functions; device may grant approximate; optional ZIP needs purpose review | No raw current coordinate intentionally stored; venue persists with Squad; permission revocable | Declare collected, optional, app functionality. *Processor exception confirmation required |
| Location — Precise location | Yes | No* | Current coordinate: yes; venue: no | Optional | App functionality | Android `ACCESS_FINE_LOCATION`; `getCurrentPositionAsync`; nearby callable; venue GeoPoint | As above | Declare collected even though UI says “nearby”; actual permission/transmission can be precise |
| Personal info — Name | Yes | No* | No | Account creation required; child name optional | Account management, app functionality, personalization | Firebase Auth/Firestore; adults enter their/child names | Profile/child/public projection deleted; shared authorship deleted/anonymized | Declare collected. Child name is adult-supplied but still personal data |
| Personal info — Email address | Yes | No* | No | Required | Account management, app functionality | Firebase Authentication/private profile | Auth/profile deleted | Declare collected, required |
| Personal info — User IDs | Yes | No* | No | Required | Account management, app functionality, fraud/security | Firebase UID and membership/content references | Deleted, removed, transferred or anonymized; local residual-reference fix awaits deployment | Declare collected, required |
| Personal info — Address | No current address flow | — | — | — | — | Optional ZIP exists; no street address | Profile deletion | Do not select Address unless ZIP purpose/use causes category inclusion after owner review |
| Personal info — Phone number | No current active flow | — | — | — | — | Schema/type only | Profile deletion | Do not select unless final binary collects it |
| Personal info — Other info | Yes | No* | No | Mostly optional | App functionality, personalization | ZIP, sport preferences, roles, team/child associations | Profile/membership cleanup | Declare conservatively; determine whether ZIP is also approximate location |
| Messages — Other in-app messages | Yes | No* | No | Optional | App functionality, safety/security | Friend/team/private text, announcements/replies/captions in Firestore | Deleted/anonymized by account/content deletion | Declare collected; not E2EE |
| Photos and videos — Photos | No current active flow | — | — | — | — | `photoURL` support only; no picker/upload | URL field deleted | Do not select absent a real collection flow |
| Audio files — Voice or sound recordings | Yes | No* | No after send | Optional | App functionality, safety/security | Expo Audio; Firebase Storage voice memo | Local draft and authored Storage object deleted; report may retain text metadata/path reference per policy | Declare collected, optional |
| App activity — App interactions | Yes | No* | No | Mixed | App functionality, personalization | Notification state, memberships, friendship/block/report actions, weekly challenge | User-root/action records deleted or anonymized | Declare collected |
| App activity — In-app search history | Yes | No* | Yes in application code | Optional | App functionality | Venue query sent to callable; no intentional query-history storage found | Request lifecycle/provider logs | Declare collected with ephemeral-processing answer if Play form exposes it; provider logs need confirmation |
| App activity — Other user-generated content | Yes | No* | No | Optional | App functionality, safety/security | Team/Squad metadata, reports, child-team links and free-form UGC; beta Coach AI guided fields/feedback are processed by Firebase and Anthropic | Existing data deleted/anonymized per policy; AI prompt not stored, request/guide ~24h, feedback ~30d, quota ~48h, account deletion covers all | Declare collected for any beta track; disclose provider processing and optional status |
| App activity — App interactions / beta diagnostics | Conditional Coach AI beta | No* | Provider-dependent | Optional beta | App functionality, fraud/security, beta quality | Correlation/provider request ID, category/locale, model, status/duration, token counts, rating/reason; no prompt or guide in routine logs | Firebase/provider retention and TTL require verification | Map to the current Play form categories before internal distribution; do not claim analytics/advertising use |
| App activity — Other actions / gameplay | Yes | No* | No | Optional | App functionality | Game sessions, answers/state, scores, stars, rewards, challenge completion, leaderboard | User records deleted; season totals fixed locally; production verification required | Declare collected |
| Device or other IDs | Yes | No* | No | Optional (notifications) | App functionality | Android FCM registration token associated with UID; token doc uses SHA-256 token ID | Sign-out best effort; account deletion/invalid-token cleanup | Declare collected, optional. Token is an app-instance/device identifier |
| App info and performance — Crash logs | No app-directed collection found | — | — | — | — | No Crashlytics/Sentry | — | Do not select after final AAB scan |
| App info and performance — Diagnostics/other performance | Requires provider confirmation | No* | Provider-dependent | Required for network service if present | App functionality, security | Firebase service data may include IP, resource IDs and technical usage; Functions logs codes and hashed deletion UID | Provider retention unknown | Resolve before submission; do not guess |
| Financial info, Health and fitness, Contacts, Calendar, Web browsing, Files/documents | No current collection found | — | — | — | — | No active feature/permission/SDK | — | Do not select after final binary confirmation |

`No*` assumes Google/Firebase, Expo Push/APNs and the map provider process data only as service providers and that user-visible team/friend delivery qualifies for the user-initiated-transfer exception. If any provider uses the data for its own advertising/profile purposes, the relevant row becomes shared.

## Security and deletion facts

- Client/backend communication uses Firebase/HTTPS endpoints; release Android manifest has no cleartext debug flag.
- Firestore, RTDB and Storage rules gate private data; privileged mutations use authenticated callables.
- Voice Storage direct reads are denied; authorized callers receive short-lived signed URLs.
- Push lock-screen text is generic and omits child names/message bodies.
- In-app deletion is readily discoverable under Profile → Account Settings.
- The local backend deletes Authentication last and is retryable/idempotent; sole owner/admin deletion is blocked safely.
- Moderation reports are retained with reporter/reported UIDs removed; the retention period is not approved.
- Local corrections now remove season leaderboard and conversation UID remnants, but are not deployed by this audit.
- The required public deletion-request URL is absent. A user who uninstalled the app cannot yet submit a request through a verified web resource.

## Android variant boundary

The Google Play form applies to `com.sidelinesquad.app`, not the separately installable development package. The production EAS profile has `developmentClient:false` and outputs an App Bundle. Debug overlay/Metro cleartext behavior belongs to `com.sidelinesquad.app.dev` and must not appear in the production AAB. Google notes that a form must cover all versions currently distributed under the production package; inspect every active Play track and final AAB before submission.

## Blocking confirmations

1. Publish and test a public HTTPS privacy policy and account-deletion request page.
2. Supply operator identity/contact and approve retention/legal/audience language.
3. Deploy/test the deletion and public-name minimization corrections and repair public profiles.
4. Verify exact production Functions/rules revision and final AAB manifest/SDK list.
5. Confirm Firebase, Expo Push, APNs and map provider service-provider contracts, log/backup retention and international processing.
6. Establish real moderation/support/child-safety operations and audience/minimum-age decisions.
