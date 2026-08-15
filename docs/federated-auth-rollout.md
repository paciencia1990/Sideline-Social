# Federated authentication rollout

Google and Apple sign-in are implemented behind explicit build-time switches. Both switches default to `false`, so no production provider is enabled by this source change alone.

## Trust boundaries

- Firebase Authentication owns credentials and the canonical UID. Firestore, Realtime Database, Storage, moderation, Stars, teams, Squads, chats, and game records continue to authorize by that UID.
- Provider credentials are exchanged directly with Firebase Auth. ID tokens and pending conflict credentials stay in memory only and are never written to Firestore, RTDB, logs, analytics, or local storage.
- Provider profile data can initialize only a missing user document. The transaction never overwrites an existing name or photo.
- A matching email is not a client-side data-merge authority. The user must authenticate an existing method before the pending provider credential is linked to that UID. Two established UIDs require a separately reviewed server-side merge design.
- Newly created provider profiles must complete legal/adult confirmation and Parent/Coach mode onboarding. Existing profiles without the new marker are treated as complete for compatibility.
- Linking, unlinking, and deletion require recent authentication. Deletion remains server-authoritative and checks token `auth_time`.

## Owner configuration: Google

1. Enable Google in Firebase Authentication only during the approved rollout window.
   Keep Firebase Authentication set to one account per email; otherwise the client cannot prevent separate UIDs for providers that independently assert the same email.
2. In Google Cloud, configure a consent screen and Web, Android, and iOS OAuth clients. Request only OpenID authentication identity; do not add contacts, Calendar, Drive, or offline access.
3. Configure Android clients for `com.sidelinesquad.app.dev` and `com.sidelinesquad.app` with the SHA-1 and SHA-256 fingerprints for each actual development and production signing key.
4. Download separate Android Firebase files. Keep the production `google-services.json` package aligned with `com.sidelinesquad.app`; inject the development file through `GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT`.
5. Create the iOS client for `com.sidelinesocial.app`. Inject its verified plist through the EAS file variable `GOOGLE_SERVICES_INFO_PLIST`, or supply its reversed client ID through `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` and its public client ID through `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
6. Set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the Web OAuth client ID if native auto-detection is not used. Use environment-specific public client IDs when development and production OAuth clients differ.
7. Set `EXPO_PUBLIC_GOOGLE_AUTH_ENABLED=true` only after the files, package IDs, URL scheme, and signing fingerprints are verified. The Expo config fails closed if Google is enabled without verified iOS native configuration.

## Owner configuration: Apple

1. Enable Sign in with Apple for the App ID `com.sidelinesocial.app` and confirm the capability in the generated entitlement.
2. Enable Apple in Firebase Authentication. Create and securely configure the Apple key, Team ID, Key ID, and private key in Firebase; never commit the `.p8` key or a generated client secret.
3. Configure Apple private-email relay for the app's authenticated sender domains. Sideline Social preserves Apple relay addresses and does not ask users to reveal a personal address.
4. Set `EXPO_PUBLIC_APPLE_AUTH_ENABLED=true` for iOS only after Firebase and Apple configuration are verified.
5. `expo-apple-authentication` does not support Android. A secure Android path requires a Services ID, approved return URL, state/nonce validation, and a server-backed Apple web OAuth code exchange. Keep the Android Apple action fail-closed until that separately reviewed flow exists.
6. The Expo JavaScript stack cannot revoke an Apple authorization code during deletion. Before production Apple enablement, add and review a native/server revocation path using Apple's current token-revocation requirements. Google grant revocation is already best-effort after server deletion.

## Build and deployment requirements

- New Android and iOS development/production builds are required because Nitro Google Sign-In, Expo Apple Authentication, Expo Crypto, the iOS Apple capability, and URL schemes are native configuration.
- Deploy the updated `deleteOwnAccount` Function before releasing these clients so the server-side recent-authentication gate is active. No Firestore, RTDB, or Storage Rules change is required.
- Provider enablement, native credential files, Apple keys, and OAuth client settings are owner-operated secrets/configuration and are intentionally not changed here.

## Privacy and store disclosures

- Review the Privacy Policy, App Store privacy answers, Google Play Data Safety form, account-deletion documentation, and reviewer notes for authentication email/name and provider linking.
- State that provider identity is used for account access, not advertising, cross-app tracking, contacts, provider activity, or age/role verification.
- Document that Google/Apple names are optional profile suggestions, photos are not imported automatically, and Apple private relay addresses are supported.

## Physical-device matrix

- Android development build and production-signed internal build: new/returning Google, cancellation, offline interruption, existing-account conflict, linking, unlinking, sign-out, and deletion.
- iPhone: new/returning Apple and Google, Hide My Email, first-authorization name, revoked Apple credential, cancellation, offline interruption, linking, unlinking, sign-out, and deletion.
- Both platforms: email regression, duplicate taps, stale callbacks, restricted accounts, English/Spanish, large text, TalkBack/VoiceOver, and mode restoration.
- Android Apple: verify the action fails closed until the server-backed web flow is implemented; then add the complete OAuth matrix before enablement.

## Rollout and rollback

1. Keep both flags false while deploying the deletion Function and validating development builds against non-production provider configuration.
2. Enable one provider and platform at a time in an internal build. Monitor Firebase Auth errors, duplicate-account support reports, profile-creation failures, and deletion retries without logging identity data.
3. Roll back instantly by setting the relevant public build flag to false and shipping a replacement build. Existing linked credentials and canonical UIDs remain valid; email and other connected methods continue to work.
4. Do not delete provider links or user data during rollback.

Official references used: Expo Google authentication and Apple Authentication guides, the Nitro Google Sign-In Expo/usage documentation, Firebase credential linking and reauthentication guidance, and Apple's Sign in with Apple and account-deletion guidance.
