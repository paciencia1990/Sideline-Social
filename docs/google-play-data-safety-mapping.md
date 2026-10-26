# Google Play Data safety mapping

Reviewed **October 20, 2026** against Build 36 source, its existing AAB and the saved Play draft. **No answers were changed or submitted.** This replaces the obsolete July/conditional-billing worksheet status. See the [full review](full-app-privacy-review-20261020/review.txt) and [recorded evidence](full-app-privacy-review-20261020/review.json).

All 20 identified types are already declared. The table records the expanded saved preview. “No Optional badge” is the observed preview state; not every underlying radio dialog was reopened. Explicit search-history handling and prior billing/User ID receipts were also read/reused.

| Data type | Collected | Shared | Choice shown | Collection purposes | Sharing purposes |
|---|---|---|---|---|---|
| Name | Yes | No | No Optional badge | App functionality, Fraud prevention, security, and compliance, Account management | — |
| Email address | Yes | No | No Optional badge | App functionality, Fraud prevention, security, and compliance, Account management | — |
| User IDs | Yes | No | No Optional badge | App functionality, Analytics, Fraud prevention, security, and compliance, Account management | — |
| Other info | Yes | No | No Optional badge | App functionality, Fraud prevention, security, and compliance, Personalization, Account management | — |
| Purchase history | Yes | No | No Optional badge | App functionality, Analytics | — |
| Approximate location | Yes | Yes | Optional | App functionality | App functionality |
| Precise location | Yes | Yes | Optional | App functionality | App functionality |
| Other in-app messages | Yes | No | Optional | App functionality, Fraud prevention, security, and compliance | — |
| Photos | Yes | No | Optional | App functionality, Fraud prevention, security, and compliance, Account management | — |
| Voice or sound recordings | Yes | No | Optional | App functionality, Fraud prevention, security, and compliance | — |
| Contacts | Yes | No | Optional | App functionality, Fraud prevention, security, and compliance, Personalization | — |
| Calendar events | Yes | No | Optional | App functionality | — |
| Crash logs | Yes | Yes | No Optional badge | Analytics | Analytics |
| Diagnostics | Yes | Yes | No Optional badge | App functionality, Analytics | Analytics |
| Files and docs | Yes | No | Optional | App functionality | — |
| App interactions | Yes | Yes | No Optional badge | App functionality, Analytics, Fraud prevention, security, and compliance | Analytics |
| In-app search history | Yes | No | Optional | App functionality | — |
| Other user-generated content | Yes | No | Optional | App functionality, Fraud prevention, security, and compliance, Personalization | — |
| Other actions | Yes | No | Optional | App functionality, Fraud prevention, security, and compliance | — |
| Device or other IDs | Yes | Yes | No Optional badge | App functionality, Analytics, Fraud prevention, security, and compliance, Account management | Analytics |

In-app search is explicitly ephemeral, optional, collected and not shared, for functionality. It is omitted from the public preview but remains in the declaration. Source searches do not intentionally persist query text; this is not a provider-backup guarantee.

## Reconciled findings

- Photos, calendar events and imported Files/docs are active flows. ICS preview text reaches Firestore; its 15-minute eligibility expiry is not an immediate physical-deletion promise.
- Contacts covers the social graph, even without phone-address-book permission.
- Maps 19.1.0, FCM/Installations and App Check are present. Preserve the current SDK diagnostics/identifier and scoped Shared answers. The RevenueCat service-provider exclusion is not a full-app No-sharing answer.
- Purchase history remains non-ephemeral and Required for App functionality/Analytics; User IDs retains all four saved purposes.
- Messages, translation inputs, child display names/relationships, gameplay, AI inputs/results and reports are covered by their respective categories; they are not automatically anonymous.
- No active structured phone-entry, card/bank, medical/fitness, installed-app-list, video, advertising or web-history flow was identified in this scope. Library capability alone is not collection.
- CAMERA/biometric permissions and a Google advertising-ID client class appear in the existing artifact. No corresponding camera-capture, biometric upload or app-directed ad-ID/attribution flow was found; AD_ID permission is absent. Optional later permission minimization does not require a new build for this review.

## Security, deletion and release

The saved form uses encryption in transit, email/password + OAuth, and the published deletion/Privacy URLs. Optional partial-deletion answers are unset. Existing staff and in-app deletion paths remain; safety holds and provider retention are not instantaneous. The published policy distinguishes paid results, unfinished work, feedback and reduced cleanup receipts.

No Save, Save draft, Submit or release action was used. One CSV export yielded no accessible file for the task and was not repeated; UI observations were retained. No new privacy test campaign is proposed. Reconcile all still-distributed versions and obtain final publication approval separately.

[Google definitions](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en), [Maps SDK guidance](https://developers.google.com/maps/documentation/android-sdk/play-data-disclosure), [Firebase privacy](https://firebase.google.com/support/privacy), [RevenueCat disclosure](https://www.revenuecat.com/docs/platform-resources/google-platform-resources/google-plays-data-safety). Maps guidance describes its latest SDK; the artifact is 19.1.0. No complete runtime or partner-contract certification is claimed.
