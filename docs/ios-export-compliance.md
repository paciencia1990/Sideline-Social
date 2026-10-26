# iOS Export Compliance

Updated October 20, 2026. **Local technical handoff complete; existing declaration unchanged.**

## Result and scope

The retained identity-matched iOS 1.0.0 (21) archive inspection already records
`ITSAppUsesNonExemptEncryption=false`. The local Expo configuration has the same
value. No declaration change, new binary or documentation upload was identified
as necessary by this scoped technical review.

The earlier description, “encryption only through transport,” was too narrow.
Current app source also uses SHA-256 and secure random values for authentication,
identifiers and fingerprints. These uses are recorded below rather than omitted.
This source review does not retroactively certify the exact JavaScript/dependency
content of Build 21 or a future billing-enabled iOS candidate.

## Observed use

| Scope | Observed behavior |
|---|---|
| Network access | Standard HTTPS service connections; no app-defined secure messaging or VPN protocol found in the scoped client search. |
| Apple sign-in | SHA-256 nonce; random nonce/state via Expo Crypto. |
| Schedule imports | SHA-256 row fingerprints and random operation identifiers. |
| Reporting/media | Random request/temp-file identifiers; SHA-256 cache keys. These hashes are not an encryption scheme for users' messages or files. |
| Installed Expo Crypto 57.0.1 iOS source | CommonCrypto digest functions, Security random bytes, Foundation UUID; the included AES module delegates to Apple CryptoKit AES-GCM. |
| Calendar integrations | The client calls Firebase Functions; this is not evidence of client end-to-end calendar encryption. Server implementation is outside this iOS-client classification scope. |

The Expo pod includes its native AES files even though no app-side AES call was
found. Accordingly, this review does not claim the cryptographic capability is
absent merely because current app calls use hashing and random identifiers.
Its inspected iOS implementation uses Apple system cryptography.

## Apple rule and proposed answer guidance

Apple distinguishes OS-provided encryption from algorithms supplied outside the
OS. Its documentation table says the OS-only category does not require an App
Store Connect encryption-document upload. External standard implementations can
have different requirements, including France-specific documentation when that
country is included. See [Apple's documentation table](https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption).

For the reviewed scope, retain the existing false value as the technical proposal.
False means no **non-exempt** encryption; it must not be described as “the app
uses no cryptography.” If asked a general encryption-use question, disclose the
standard OS transport/authentication use. If asked specifically about non-exempt
or independently implemented algorithms, answer that exact question using the
actual submitted candidate rather than copying a bare Yes/No from an older form.

These are technical preparation notes, not a new legal classification, CCATS,
France filing, government self-classification determination or Apple approval.
Any applicable company/country obligations remain for the ordinary release
handoff; no new agreement or declaration was accepted in this step.

## Evidence and normal release handoff

Existing archive evidence: [native metadata](apple-privacy-ios-reconciliation-20261020/ios-build-21-native-evidence.json).
Archive identity: com.sidelinesocial.app, 1.0.0 (21), existing IPA SHA-256
`59936bb278fcb7b5d29320087627059725ae28a7638ff58df9ffa6db86396dc5`.
No new Expo lookup, archive download, archive re-inspection or Apple account
request was made; the accepted receipt was reused.

At the next separately approved iOS candidate handoff, check that its final
Info.plist and actual native dependency scope still support the declaration.
Do not request a speculative build or separate cryptography test campaign for
this preparation. New proprietary/non-OS crypto or changed distribution scope
would require reassessment at that handoff. Store questions are not submitted now.

Current source hashes, APIs and review limits: [technical result](ios-export-handoff-20261020/result.json).

## Primary references checked October 20

- [Apple export-compliance overview](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance).
- [Apple encryption-documentation table](https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption).
- [Apple declaration-key guidance](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations).

No app/backend source, cryptographic settings, countries, secrets or permissions
changed. Firebase and moderation remain live. No retries, tests, builds,
deployments, review submissions or store releases occurred.
