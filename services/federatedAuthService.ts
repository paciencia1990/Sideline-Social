import { Platform } from "react-native";
import {
  GoogleAuthProvider,
  OAuthProvider,
  type AuthCredential,
} from "firebase/auth";

import { AUTH_PROVIDER_CONFIG } from "@/config/authProviders";
import type { FederatedAuthProvider } from "@/utils/federatedAuthCore";

export type FederatedCredentialResult = {
  credential: AuthCredential;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  provider: FederatedAuthProvider;
};

export type ProviderFlowErrorCode =
  | "cancelled"
  | "configuration"
  | "interrupted"
  | "missing_credential"
  | "network"
  | "unsupported_platform";

export class ProviderFlowError extends Error {
  readonly code: ProviderFlowErrorCode;

  constructor(code: ProviderFlowErrorCode, message: string) {
    super(message);
    this.name = "ProviderFlowError";
    this.code = code;
  }
}

type PendingProviderConflict = FederatedCredentialResult & {
  expiresAt: number;
};

let pendingConflict: PendingProviderConflict | null = null;
let googleConfiguredFor: string | null = null;

export async function requestFederatedCredential(provider: FederatedAuthProvider) {
  return provider === "google" ? requestGoogleCredential() : requestAppleCredential();
}

export function rememberPendingProviderConflict(result: FederatedCredentialResult) {
  pendingConflict = {
    ...result,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
}

export function getPendingProviderConflict() {
  if (pendingConflict && pendingConflict.expiresAt > Date.now()) return pendingConflict;
  pendingConflict = null;
  return null;
}

export function clearPendingProviderConflict() {
  pendingConflict = null;
}

export async function revokeGoogleAccessIfAvailable(identity: string | null | undefined) {
  if (!identity) return;
  try {
    const { GoogleOneTapSignIn } = loadGoogleSignIn();
    await GoogleOneTapSignIn.revokeAccess(identity);
  } catch {
    // Account cleanup is server-authoritative. Revocation is best-effort when
    // the Google native session still exists on this device.
  }
}

async function requestGoogleCredential(): Promise<FederatedCredentialResult> {
  if (!AUTH_PROVIDER_CONFIG.googleEnabled) {
    throw new ProviderFlowError("configuration", "Google authentication is not enabled for this build.");
  }

  try {
    const google = loadGoogleSignIn();
    const googleConfigurationKey = `${AUTH_PROVIDER_CONFIG.googleWebClientId}:${AUTH_PROVIDER_CONFIG.googleIosClientId ?? "auto"}`;
    if (googleConfiguredFor !== googleConfigurationKey) {
      google.GoogleOneTapSignIn.configure({
        autoSelectOnSignIn: false,
        iosClientId: AUTH_PROVIDER_CONFIG.googleIosClientId,
        offlineAccess: false,
        scopes: null,
        webClientId: AUTH_PROVIDER_CONFIG.googleWebClientId,
      });
      googleConfiguredFor = googleConfigurationKey;
    }

    await google.GoogleOneTapSignIn.checkPlayServices();
    let response = await google.GoogleOneTapSignIn.signIn();
    if (google.isNoSavedCredentialFoundResponse(response)) {
      response = await google.GoogleOneTapSignIn.createAccount();
    }
    if (google.isNoSavedCredentialFoundResponse(response)) {
      response = await google.GoogleOneTapSignIn.presentExplicitSignIn();
    }
    if (google.isCancelledResponse(response)) {
      throw new ProviderFlowError("cancelled", "Google authentication was cancelled.");
    }
    if (!google.isSuccessResponse(response) || !response.data.idToken) {
      throw new ProviderFlowError("missing_credential", "Google did not return a usable identity credential.");
    }

    return {
      credential: GoogleAuthProvider.credential(response.data.idToken),
      email: response.data.user.email,
      firstName: response.data.user.givenName,
      lastName: response.data.user.familyName,
      provider: "google",
    };
  } catch (error) {
    throw normalizeProviderError(error, "google");
  }
}

async function requestAppleCredential(): Promise<FederatedCredentialResult> {
  if (!AUTH_PROVIDER_CONFIG.appleEnabled) {
    throw new ProviderFlowError("configuration", "Apple authentication is not enabled for this build.");
  }
  if (Platform.OS !== "ios") {
    throw new ProviderFlowError(
      "unsupported_platform",
      "Secure Apple authentication is not available in this Android build.",
    );
  }

  try {
    const AppleAuthentication = loadAppleAuthentication();
    const Crypto = loadCrypto();
    if (!(await AppleAuthentication.isAvailableAsync())) {
      throw new ProviderFlowError("configuration", "Apple authentication is unavailable on this device.");
    }
    const rawNonce = await secureRandomHex(Crypto, 32);
    const state = await secureRandomHex(Crypto, 16);
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );
    const response = await AppleAuthentication.signInAsync({
      nonce: hashedNonce,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      state,
    });
    if (response.state !== state) {
      throw new ProviderFlowError("interrupted", "Apple authentication state validation failed.");
    }
    if (!response.identityToken) {
      throw new ProviderFlowError("missing_credential", "Apple did not return a usable identity credential.");
    }

    const credential = new OAuthProvider("apple.com").credential({
      idToken: response.identityToken,
      rawNonce,
    });
    return {
      credential,
      email: response.email,
      firstName: response.fullName?.givenName?.trim() || null,
      lastName: response.fullName?.familyName?.trim() || null,
      provider: "apple",
    };
  } catch (error) {
    throw normalizeProviderError(error, "apple");
  }
}

function loadGoogleSignIn() {
  try {
    return require("react-native-nitro-google-signin") as typeof import("react-native-nitro-google-signin");
  } catch {
    throw new ProviderFlowError("configuration", "This build does not contain Google authentication.");
  }
}

function loadAppleAuthentication() {
  try {
    return require("expo-apple-authentication") as typeof import("expo-apple-authentication");
  } catch {
    throw new ProviderFlowError("configuration", "This build does not contain Apple authentication.");
  }
}

function loadCrypto() {
  try {
    return require("expo-crypto") as typeof import("expo-crypto");
  } catch {
    throw new ProviderFlowError("configuration", "This build cannot create a secure authentication nonce.");
  }
}

async function secureRandomHex(Crypto: typeof import("expo-crypto"), byteCount: number) {
  const bytes = await Crypto.getRandomBytesAsync(byteCount);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeProviderError(error: unknown, provider: FederatedAuthProvider): ProviderFlowError {
  if (error instanceof ProviderFlowError) return error;
  const code = getErrorCode(error).toLowerCase();
  if (code.includes("cancel")) return new ProviderFlowError("cancelled", `${provider} authentication was cancelled.`);
  if (code.includes("network")) return new ProviderFlowError("network", `${provider} authentication lost its network connection.`);
  if (code.includes("developer") || code.includes("configuration") || code.includes("play_services")) {
    return new ProviderFlowError("configuration", `${provider} authentication is not configured for this build.`);
  }
  return new ProviderFlowError("interrupted", `${provider} authentication could not be completed.`);
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}
