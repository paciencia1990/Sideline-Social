# iOS Export Compliance

## Repository conclusion

Sideline Social uses encryption only through standard platform and service transport security (HTTPS/TLS for Expo, Firebase, Apple, and map traffic). No custom cryptographic algorithm, VPN, secure-messaging protocol, cryptocurrency implementation, or user-facing encryption feature was found.

`ITSAppUsesNonExemptEncryption` is set to `false` in the Expo iOS configuration. This is the appropriate repository declaration for the audited behavior, subject to owner/legal confirmation and the final signed binary.

## App Store Connect response draft

- Does the app use encryption? **Yes, standard encryption is used by the operating system and network libraries.**
- Is the app limited to exempt encryption such as authentication and secure network communications? **Expected yes.**
- Does it implement proprietary or non-standard cryptography? **No evidence found.**
- Does it require an export compliance document upload? **Not expected for the audited standard/exempt use.**

## Final verification

Before upload, inspect the final dependency list and archive for newly added cryptography, VPN, payment, or secure-file features. Answer App Store Connect based on the shipped binary and the organization’s legal/export assessment; this document is technical guidance, not legal advice.
