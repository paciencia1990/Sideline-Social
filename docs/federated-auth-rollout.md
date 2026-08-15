# Federated authentication rollout

Google and Apple sign-in are implemented behind explicit build-time switches. Both switches default to `false`, so no production provider is enabled by this source change alone.

## Rollout-review corrections

- Provider entry actions were previously rendered regardless of their build flag, and Android rendered an Apple action that could only fail after a tap. Provider visibility is now resolved centrally from `AUTH_PROVIDER_CONFIG`, the current platform, and `AppleAuthentication.isAvailableAsync()`. Disabled providers render no button or reserved layout space.
- Account deletion previously removed Firebase and Sideline Social data without revoking Sign in with Apple authorization. Apple-linked deletion now captures a fresh one-time authorization code during Apple reauthentication, exchanges and revokes it only inside the authenticated Function, and starts destructive cleanup only after Apple returns success.

## Trust boundaries

- Firebase Authentication owns credentials and the canonical UID. Firestore, Realtime Database, Storage, moderation, Stars, teams, Squads, chats, and game records continue to authorize by that UID.
- Provider credentials are exchanged directly with Firebase Auth. ID tokens and pending conflict credentials stay in memory only and are never written to Firestore, RTDB, logs, analytics, or local storage.
- Provider profile data can initialize only a missing user document. The transaction never overwrites an existing name or photo.
- A matching email is not a client-side data-merge authority. The user must authenticate an existing method before the pending provider credential is linked to that UID. Two established UIDs require a separately reviewed server-side merge design.
- Newly created provider profiles must complete legal/adult confirmation and Parent/Coach mode onboarding. Existing profiles without the new marker are treated as complete for compatibility.
- Linking, unlinking, and deletion require recent authentication. Deletion remains server-authoritative and checks token `auth_time`.
- Apple authorization codes remain only in client memory long enough to call `deleteOwnAccount`. The Function never accepts a caller-supplied UID or provider claim; it resolves the UID and `apple.com` link from verified Firebase Authentication state.
- The Apple private key and client-secret JWT are server-only. The Function exchanges the single-use code at `/auth/token`, revokes the returned refresh token (or access token fallback) at `/auth/revoke`, discards every token, and exposes only sanitized failure categories plus a random correlation ID.
- A server-only Firestore marker keyed by a SHA-256 UID digest prevents concurrent deletion requests. A completed revocation marker lets idempotent cleanup resume after interruption without retaining any Apple code or token. The marker is removed after Auth deletion.

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
5. Provision these Firebase Functions secrets without putting values in source, EAS public variables, shell history, or documentation:
   - `APPLE_TEAM_ID`: the 10-character Apple Developer Team ID.
   - `APPLE_KEY_ID`: the 10-character Sign in with Apple key ID.
   - `APPLE_CLIENT_ID`: exactly `com.sidelinesocial.app` for the authorization code produced by the native iOS `ASAuthorizationAppleIDProvider` flow used here.
   - `APPLE_PRIVATE_KEY`: the complete `.p8` private key, supplied interactively and never committed.
6. Safe interactive provisioning commands are:

   ```powershell
   npx.cmd firebase-tools@latest functions:secrets:set APPLE_TEAM_ID
   npx.cmd firebase-tools@latest functions:secrets:set APPLE_KEY_ID
   npx.cmd firebase-tools@latest functions:secrets:set APPLE_CLIENT_ID
   npx.cmd firebase-tools@latest functions:secrets:set APPLE_PRIVATE_KEY
   ```

7. The current authorization code is native iOS and therefore uses the primary App ID `com.sidelinesocial.app`. A Services ID is used for a future web/Android authorization flow and must not be substituted for `APPLE_CLIENT_ID` in this Function unless that separate flow receives its own reviewed exchange endpoint and secret configuration.
8. `expo-apple-authentication` does not support Android. Apple entry and reauthentication actions are never rendered there. An Apple-linked account must currently use a supported iPhone for Apple-required deletion. A future Android path requires a Services ID, approved return URL, server-owned callback, and separate state/nonce validation.

## Apple deletion request sequence

1. The Apple-linked user types the deletion confirmation and completes fresh native Apple reauthentication on iPhone.
2. The client reauthenticates the same Firebase user with the nonce-bound Apple identity token and keeps the returned authorization code in memory for no more than five minutes.
3. The authenticated `deleteOwnAccount` callable receives only that code. Firebase supplies the authoritative UID and recent `auth_time`.
4. The Function verifies the Firebase user is linked to `apple.com`, acquires a short server-side deletion lock, and creates a five-minute ES256 Apple client-secret JWT from bound secrets.
5. The Function exchanges the single-use code at `https://appleid.apple.com/auth/token`, then sends the resulting refresh or access token to `https://appleid.apple.com/auth/revoke`.
6. Only HTTP 200 marks revocation complete. Codes, client-secret JWTs, and Apple tokens are discarded and never logged or persisted.
7. Existing ownership checks run before revocation. Existing destructive cleanup runs after revocation, with Firebase Authentication still deleted last.
8. Exchange or revocation failure leaves Sideline Social data intact and requires a fresh Apple reauthentication. If cleanup fails after successful revocation, the server marker permits an idempotent retry.

## Build and deployment requirements

- New Android and iOS development/production builds are required because Nitro Google Sign-In, Expo Apple Authentication, Expo Crypto, the iOS Apple capability, and URL schemes are native configuration.
- Provision all four Apple secrets, then deploy only the updated callable:

  ```powershell
  npx.cmd firebase-tools@latest deploy --only functions:deleteOwnAccount --project sideline-squad
  ```

- Do not enable the Apple build flag until the deployed Function has passed a real internal-device exchange/revocation test. No Firestore, RTDB, Storage Rules, or index change is required.
- Provider enablement, native credential files, Apple keys, and OAuth client settings are owner-operated secrets/configuration and are intentionally not changed here.

## Privacy and store disclosures

- Review the Privacy Policy, App Store privacy answers, Google Play Data Safety form, account-deletion documentation, and reviewer notes for authentication email/name and provider linking.
- State that provider identity is used for account access, not advertising, cross-app tracking, contacts, provider activity, or age/role verification.
- Document that Google/Apple names are optional profile suggestions, photos are not imported automatically, and Apple private relay addresses are supported.

## Physical-device matrix

- Android development build and production-signed internal build: new/returning Google, cancellation, offline interruption, existing-account conflict, linking, unlinking, sign-out, and deletion.
- iPhone: new/returning Apple and Google, Hide My Email, first-authorization name, revoked Apple credential, cancellation, offline interruption, linking, unlinking, sign-out, and deletion.
- iPhone Apple deletion: success, cancellation, airplane-mode exchange failure, a stale code retry, duplicate delete taps, Function retry after a simulated cleanup interruption, and confirmation that the Apple authorization is removed from the user's Apple ID settings.
- Both platforms: email regression, duplicate taps, stale callbacks, restricted accounts, English/Spanish, large text, TalkBack/VoiceOver, and mode restoration.
- Android Apple: confirm no Apple entry, link, reauthentication, or deletion button is rendered. Confirm an Apple-linked account receives the localized supported-iPhone deletion instruction.

## Rollout and rollback

1. Keep both flags false while provisioning secrets, deploying the deletion Function, and validating development builds against non-production provider configuration.
2. Enable Apple only in an internal iOS build. Complete at least one real new-account, returning-account, Hide My Email, revocation-event, and deletion test before broader rollout.
3. Enable one provider and platform at a time. Monitor sanitized categories, duplicate-account support reports, profile-creation failures, revocation retries, and cleanup retries without logging identity data or provider credentials.
4. Before provider-only production accounts exist, roll back by setting the relevant build flag false and shipping a replacement build. After provider-only accounts exist, preserve their returning sign-in and deletion path while disabling only new enrollment in a separately reviewed compatibility release.
5. A backend rollback may redeploy the prior `deleteOwnAccount` only while Apple remains disabled. Never expose Apple account creation with a deletion backend that cannot revoke authorization.
6. Do not delete provider links or user data during rollback.

## Files changed for rollout-review corrections

- Provider UI: `components/FederatedAuthButtons.tsx`, `hooks/useAuthProviderAvailability.ts`, `utils/authProviderAvailability.ts`, `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`, `app/settings/sign-in-methods.tsx`, and `app/settings/delete-account.tsx`.
- Client authentication/deletion: `context/AuthContext.tsx`, `services/federatedAuthService.ts`, and `services/accountService.ts`.
- Server revocation: `functions/src/appleAuthorizationRevocation.ts` and `functions/src/accountDeletion.ts`.
- Localization/tests/config documentation: `i18n/index.ts`, `package.json`, `scripts/test-federated-auth-core.cjs`, `scripts/test-apple-authorization-revocation.cjs`, `scripts/test-account-deletion-functions-emulator.cjs`, release validation scripts, and this document.

## Remaining production gates

- Code-level exchange and revocation use mocked HTTP transport in automation; Apple live endpoints are never called by tests.
- Apple revocation is not production-ready until the owner provisions all secrets, confirms Firebase/Apple provider configuration, deploys the Function, creates new native builds, and passes the physical-device matrix against Apple production authorization.
- No credentials, providers, Firebase resources, native builds, or production data are changed by the source implementation itself.

Official references used: Expo Google authentication and Apple Authentication guides, the Nitro Google Sign-In Expo/usage documentation, Firebase credential linking and reauthentication guidance, and Apple's Sign in with Apple and account-deletion guidance.
