# Apple App Privacy mapping

Updated **October 20, 2026**. The existing iOS **1.0.0 (21)** IPA is downloaded, matched to Apple metadata and inspected. The prior archive/SDK hold is closed. **No privacy label was changed or published.** The exact current-iOS 19-type correction is ready for separate owner publication approval. See the [final publication review](apple-privacy-label-publication-review-20261020.txt) and [matched archive evidence](apple-privacy-ios-reconciliation-20261020/ios-build-21-native-evidence.json).

## Exact current-iOS set

All rows are collected. Tracking is No. Linkage and purpose combine app-owned records with the shipped SDK declarations; an SDK's unlinked collection does not override a separate linked app flow.

| Data type | Purposes | Linked |
|---|---|---|
| Name | App Functionality | Yes |
| Email Address | App Functionality | Yes |
| Phone Number | App Functionality | Yes |
| Coarse Location | App Functionality | Yes |
| Precise Location | App Functionality | Yes |
| Contacts | App Functionality | Yes |
| Emails or Text Messages | App Functionality | Yes |
| Photos or Videos | App Functionality | Yes |
| Audio Data | App Functionality | Yes |
| Gameplay Content | App Functionality | Yes |
| Other User Content | App Functionality | Yes |
| Customer Support | App Functionality | Yes |
| User ID | App Functionality, Analytics | Yes |
| Device ID | App Functionality, Analytics | Yes |
| Product Interaction | App Functionality, Analytics | Yes |
| Other Usage Data | Analytics | Yes |
| Crash Data | Analytics | No |
| Performance Data | Analytics | No |
| Other Data Types | App Functionality, Analytics | Yes |

The nine additions are Phone Number, Coarse Location, Contacts, Device ID, Product Interaction, Other Usage Data, Crash Data, Performance Data, Other Data Types. User ID keeps App Functionality and adds Analytics. Preserve the other existing types and answers. Phone Number/Other Usage Data/Other Data Types include the actual Google Sign-In manifest declarations; they are not claims of new app-entry screens. Crash and Performance data come from native Google Maps declarations, not an inferred Firebase Crashlytics/Performance integration.

The binary contains Firebase Core 12.18.0, Google Sign-In 9.2.0, Google Maps resources 9.4.0 and the React Native Maps 1.27.2 privacy wrapper. Default MapKit JSX does not establish that Google SDKs are absent. Device ID is linked because Expo tokens are stored with UID. Coarse Location covers retained ZIP/reduced-accuracy venue data; Precise Location remains for captured venue pins. The source location-copy correction is local and has not changed the installed build.

## Billing-enabled iOS addendum

Build 21 predates native RevenueCat purchase support. For the planned billing-enabled candidate add **Purchase History: App Functionality, Analytics; Linked Yes; Tracking No**. This produces 20 types if other behaviors/SDKs are unchanged. Current source's purchases 10.12.2 / PurchasesHybridCommon 19.10.0 input is not a claim about the old archive. Compare actual changes at the normal release handoff; no new build or repeated audit/test suite is requested now.

The optional privacy-choices URL remains blank; preserve the existing policy URL. No blanket advertising, Product Personalization, no-telemetry, or immediate-erasure assertion is made. No card/bank fields or every possible free-form-text data category is added. The review uses source, native manifests and vendor-default evidence, not runtime traffic capture. Publication still requires separate owner authorization and the final accuracy acknowledgement.

[Apple definitions](https://developer.apple.com/app-store/app-privacy-details/), [Google Maps iOS disclosures](https://developers.google.com/maps/documentation/ios-sdk/apple-privacy-policy), [RevenueCat guidance](https://www.revenuecat.com/docs/platform-resources/apple-platform-resources/apple-app-privacy).
