# Android production and development variants

## Identities

| Profile | App label | Package | Artifact | Dev client |
|---|---|---|---|---|
| `development` | Sideline Social Dev | `com.sidelinesquad.app.dev` | APK | Yes |
| `production` | Sideline Social | `com.sidelinesquad.app` | Android App Bundle | No |

The debug build uses `applicationIdSuffix ".dev"`, its own label, and its own deep-link schemes. Release keeps the existing application ID, app label, and signing path. Because Android treats the package name as the installed-app identity, the two builds can be installed together. The development profile does not enable build-number auto-increment, so it cannot consume or change the Google Play production versionCode.

## Firebase separation

The existing Firebase project now contains a separate Android app named `Sideline Social Dev` for `com.sidelinesquad.app.dev`.

- Production continues to use the tracked root `google-services.json` for `com.sidelinesquad.app`.
- Local development uses `android/app/src/debug/google-services.json`. This generated file is ignored and must not be committed.
- EAS development uses the secret file variable `GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT`. Gradle copies the injected file into the debug source set on the ephemeral builder.
- If the development Firebase file is absent, the debug Gradle build stops with an explicit setup error instead of silently using production credentials for the wrong package.

Firebase email/password authentication does not require an Android SHA certificate. If Google sign-in, App Check, or another SHA-bound Firebase feature is added later, register the EAS development signing fingerprints on the development Firebase app only.

## Build and run

Create the installable development client without touching the Play app:

```powershell
npx eas-cli@latest build --platform android --profile development
```

Install the returned APK as `Sideline Social Dev`, then start Metro:

```powershell
npm run start:dev-client
```

That script runs the equivalent of:

```powershell
npx expo start --dev-client --scheme sidelinesquad-dev
```

Create a Google Play-ready production App Bundle only with:

```powershell
npx eas-cli@latest build --platform android --profile production
```

Do not use the production profile merely to refresh the local development client; it intentionally participates in the remote production versionCode strategy.

## Verification still required

After the next development EAS build, install its APK beside the existing Play test build on the same Android device and confirm:

1. Both launcher labels and icons are visible.
2. Opening `Sideline Social Dev` connects to Metro with the development scheme.
3. Opening `Sideline Social` still launches the Play test build independently.
4. Email sign-in, Firestore, Functions, Realtime Database, Storage, maps, and push-token registration work in the development package.
5. Notifications and deep links open the correct package.

No app was uninstalled or installed during this repository/configuration pass.
