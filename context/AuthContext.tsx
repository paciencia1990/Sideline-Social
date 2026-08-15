import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  EmailAuthProvider,
  type User,
  createUserWithEmailAndPassword,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  unlink,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, type DocumentData } from "firebase/firestore";

import { auth, db } from "@/config/firebase";
import { CURRENT_LEGAL_ASSENT_VERSION } from "@/constants/legalAssent";
import i18n from "@/i18n";
import { ensureFederatedUserProfile } from "@/services/authProfileService";
import {
  clearPendingProviderConflict,
  getPendingProviderConflict,
  ProviderFlowError,
  rememberPendingProviderConflict,
  requestFederatedCredential,
  subscribeToAppleCredentialRevocation,
} from "@/services/federatedAuthService";
import { clearSignedInUserLocalState } from "@/services/localUserStateService";
import { unregisterCurrentDeviceNotificationToken } from "@/services/notificationService";
import {
  canUnlinkSignInMethod,
  createAuthOperationGuard,
  emailsMatch,
  providerIdFor,
  readAccountOnboardingCompleted,
  readSignInMethods,
  type FederatedAuthProvider,
  type SignInMethod,
} from "@/utils/federatedAuthCore";
import { resolveFirebaseIdentityKind } from "@/utils/authIdentity";
import { completeLocalSignOut } from "@/utils/localUserStateCore";
import { readModeOnboardingState, type AppMode } from "@/utils/onboardingMode";
import { resolveDisplayName } from "@/utils/profileName";
import { setVoicePlaybackAuthorizationContext } from "@/utils/voicePlaybackCore";

export type AppUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  phoneNumber?: string | null;
  photoURL?: string | null;
  activeMode: AppMode | null;
  defaultMode: AppMode | null;
  onboardingPath: AppMode | null;
  accountOnboardingCompleted: boolean;
  modeOnboardingCompleted: boolean;
};

type SignUpProfile = {
  adultEligibilityConfirmed?: boolean;
  firstName?: string;
  lastName?: string;
  policiesAccepted?: boolean;
  zipCode?: string;
  sports?: string[];
  phoneNumber?: string | null;
};

export type ProviderReauthenticationResult = {
  authorizationCode: string | null;
  provider: FederatedAuthProvider;
};

interface AuthContextType {
  user: AppUser | null;
  firebaseUser: User | null;
  loading: boolean;
  signInMethods: SignInMethod[];
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, profile?: SignUpProfile) => Promise<AppUser>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  linkProvider: (provider: FederatedAuthProvider) => Promise<void>;
  reauthenticateWithPassword: (password: string) => Promise<void>;
  reauthenticateWithProvider: (provider: FederatedAuthProvider) => Promise<ProviderReauthenticationResult>;
  unlinkProvider: (provider: FederatedAuthProvider) => Promise<void>;
};

const defaultUser: AppUser = {
  uid: "",
  email: null,
  displayName: null,
  activeMode: null,
  defaultMode: null,
  onboardingPath: null,
  accountOnboardingCompleted: true,
  modeOnboardingCompleted: true,
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  firebaseUser: null,
  loading: true,
  signInMethods: [],
  refreshProfile: async () => {},
  signIn: async () => {},
  signUp: async () => defaultUser,
  resetPassword: async () => {},
  signOut: async () => {},
  signInWithGoogle: async () => {},
  signInWithApple: async () => {},
  linkProvider: async () => {},
  reauthenticateWithPassword: async () => {},
  reauthenticateWithProvider: async (provider) => ({ authorizationCode: null, provider }),
  unlinkProvider: async () => {},
});

function mapUser(firebaseUser: User, profileExists: boolean, profile?: DocumentData): AppUser {
  const modeState = readModeOnboardingState(profile);
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: resolveDisplayName(profile, firebaseUser.displayName),
    phoneNumber: firebaseUser.phoneNumber,
    photoURL: firebaseUser.photoURL,
    activeMode: modeState.activeMode,
    defaultMode: modeState.preferredMode,
    onboardingPath: modeState.onboardingPath,
    accountOnboardingCompleted: readAccountOnboardingCompleted(profileExists, profile),
    modeOnboardingCompleted: modeState.onboardingCompleted,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [providerRevision, setProviderRevision] = useState(0);
  const profileLoadVersion = useRef(0);
  const authOperationInFlight = useRef(false);
  const authOperationGuard = useRef(createAuthOperationGuard());

  useEffect(() => {
    let disposed = false;
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      const loadVersion = ++profileLoadVersion.current;
      setUser(null);

      if (!nextUser) {
        setVoicePlaybackAuthorizationContext(null);
        setFirebaseUser(null);
        setLoading(false);
        return;
      }
      if (resolveFirebaseIdentityKind(nextUser) === "anonymous") {
        setVoicePlaybackAuthorizationContext(null);
        setFirebaseUser(null);
        setLoading(false);
        void firebaseSignOut(auth).catch(() => undefined);
        void clearSignedInUserLocalState().catch(() => undefined);
        return;
      }

      setVoicePlaybackAuthorizationContext(nextUser.uid);
      setFirebaseUser(nextUser);
      setLoading(true);
      void getDoc(doc(db, "users", nextUser.uid))
        .then((profileDoc) => ({ exists: profileDoc.exists(), profile: profileDoc.data() }))
        .catch((error: unknown) => {
          console.warn("[Auth] profile hydration unavailable:", getErrorCode(error));
          return { exists: true, profile: undefined };
        })
        .then(({ exists, profile }) => {
          if (disposed || loadVersion !== profileLoadVersion.current || auth.currentUser?.uid !== nextUser.uid) return;
          setUser(mapUser(nextUser, exists, profile));
          setLoading(false);
        });
    });

    return () => {
      disposed = true;
      profileLoadVersion.current += 1;
      unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser || resolveFirebaseIdentityKind(currentUser) !== "permanent") {
      setFirebaseUser(null);
      setUser(null);
      setLoading(false);
      return;
    }
    const loadVersion = ++profileLoadVersion.current;
    setLoading(true);
    try {
      const profileDoc = await getDoc(doc(db, "users", currentUser.uid));
      if (loadVersion !== profileLoadVersion.current || auth.currentUser?.uid !== currentUser.uid) return;
      setFirebaseUser(currentUser);
      setUser(mapUser(currentUser, profileDoc.exists(), profileDoc.data()));
    } finally {
      if (loadVersion === profileLoadVersion.current && auth.currentUser?.uid === currentUser.uid) setLoading(false);
    }
  }, []);

  const runExclusiveAuthOperation = useCallback(async <T,>(operation: (operationId: number) => Promise<T>) => {
    if (authOperationInFlight.current) throw codedError("auth/operation-in-progress");
    authOperationInFlight.current = true;
    const operationId = authOperationGuard.current.begin();
    try {
      return await operation(operationId);
    } finally {
      if (authOperationGuard.current.isCurrent(operationId)) authOperationInFlight.current = false;
    }
  }, []);

  const signOut = useCallback(async () => {
    clearPendingProviderConflict();
    try {
      await unregisterCurrentDeviceNotificationToken();
    } catch (error) {
      console.warn("[Notifications] sign-out cleanup unavailable:", getErrorCode(error));
    }
    await completeLocalSignOut({
      firebaseSignOut: () => firebaseSignOut(auth),
      clearLocalUserState: clearSignedInUserLocalState,
      reportFailure: (stage, error) => {
        console.warn(`[Auth] ${stage} unavailable:`, getErrorCode(error));
      },
      resetLocalAuthContext: () => {
        setVoicePlaybackAuthorizationContext(null);
        profileLoadVersion.current += 1;
        setFirebaseUser(null);
        setUser(null);
        setLoading(false);
      },
    });
  }, []);

  useEffect(() => subscribeToAppleCredentialRevocation(() => {
    void signOut().catch((error) => {
      console.warn("[Auth] Apple credential revocation sign-out unavailable:", getErrorCode(error));
    });
  }), [signOut]);

  const signInFederated = useCallback(async (provider: FederatedAuthProvider) => {
    await runExclusiveAuthOperation(async (operationId) => {
      setUser(null);
      setLoading(true);
      try {
        const providerResult = await requestFederatedCredential(provider);
        let credentialResult;
        try {
          credentialResult = await signInWithCredential(auth, providerResult.credential);
        } catch (error) {
          if (getErrorCode(error) === "auth/account-exists-with-different-credential") {
            rememberPendingProviderConflict({
              ...providerResult,
              authorizationCode: null,
              email: getErrorEmail(error) ?? providerResult.email,
            });
            throw codedError("auth/linking-required");
          }
          throw error;
        }
        if (!authOperationGuard.current.isCurrent(operationId)) throw codedError("auth/stale-response");

        const pending = getPendingProviderConflict();
        if (pending && pending.provider !== provider) {
          if (pending.email && !emailsMatch(credentialResult.user.email, pending.email)) {
            clearPendingProviderConflict();
            await firebaseSignOut(auth);
            throw codedError("auth/conflict-email-mismatch");
          }
          await linkWithCredential(credentialResult.user, pending.credential);
          clearPendingProviderConflict();
        } else if (pending?.provider === provider) {
          clearPendingProviderConflict();
        }

        await ensureFederatedUserProfile(credentialResult.user, providerResult);
        await refreshProfile();
      } catch (error) {
        if (auth.currentUser) await firebaseSignOut(auth).catch(() => undefined);
        setLoading(false);
        throw error;
      }
    });
  }, [refreshProfile, runExclusiveAuthOperation]);

  const signIn = useCallback(async (email: string, password: string) => {
    await runExclusiveAuthOperation(async () => {
      setUser(null);
      setLoading(true);
      try {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        const pending = getPendingProviderConflict();
        if (pending) {
          if (pending.email && !emailsMatch(credential.user.email, pending.email)) {
            clearPendingProviderConflict();
            await firebaseSignOut(auth);
            throw codedError("auth/conflict-email-mismatch");
          }
          await linkWithCredential(credential.user, pending.credential);
          clearPendingProviderConflict();
        }
        await refreshProfile();
      } catch (error) {
        if (auth.currentUser) await firebaseSignOut(auth).catch(() => undefined);
        setLoading(false);
        throw error;
      }
    });
  }, [refreshProfile, runExclusiveAuthOperation]);

  const signUp = useCallback(async (email: string, password: string, profile: SignUpProfile = {}) => {
    if (!profile.policiesAccepted || !profile.adultEligibilityConfirmed) {
      throw codedError("auth/account-onboarding-incomplete");
    }
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const firstName = profile.firstName?.trim() ?? "";
    const lastName = profile.lastName?.trim() ?? "";
    const displayName = [firstName, lastName].filter(Boolean).join(" ");
    if (displayName) await updateProfile(credential.user, { displayName });

    await setDoc(doc(db, "users", credential.user.uid), {
      userId: credential.user.uid,
      firstName,
      lastName,
      displayName: displayName || null,
      email: email.trim(),
      zipCode: profile.zipCode?.trim() ?? "",
      sports: profile.sports ?? [],
      phoneNumber: profile.phoneNumber ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      tier: "member",
      totalStars: 0,
      sidelineStars: 0,
      squadIds: [],
      friendIds: [],
      preferredLanguage: i18n.resolvedLanguage?.startsWith("es") ? "es" : "en",
      profileVisibility: "squad_only",
      accountOnboardingCompleted: true,
      accountOnboardingCompletedAt: serverTimestamp(),
      adultEligibilityConfirmed: true,
      legalAssentVersion: CURRENT_LEGAL_ASSENT_VERSION,
      privacyPolicyAcceptedAt: serverTimestamp(),
      termsOfUseAcceptedAt: serverTimestamp(),
      communityGuidelinesAcceptedAt: serverTimestamp(),
      modeOnboardingCompleted: false,
    }, { merge: true });

    const userDoc = await getDoc(doc(db, "users", credential.user.uid));
    const nextUser = mapUser(credential.user, userDoc.exists(), userDoc.data());
    profileLoadVersion.current += 1;
    setFirebaseUser(credential.user);
    setUser(nextUser);
    setLoading(false);
    return nextUser;
  }, []);

  const reauthenticateWithPassword = useCallback(async (password: string) => {
    await runExclusiveAuthOperation(async () => {
      const currentUser = auth.currentUser;
      if (!currentUser?.email) throw codedError("auth/password-reauth-unavailable");
      await reauthenticateWithCredential(
        currentUser,
        EmailAuthProvider.credential(currentUser.email, password),
      );
      await currentUser.getIdToken(true);
    });
  }, [runExclusiveAuthOperation]);

  const reauthenticateWithProvider = useCallback(async (provider: FederatedAuthProvider) => {
    return runExclusiveAuthOperation(async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) throw codedError("auth/requires-recent-login");
      const providerResult = await requestFederatedCredential(provider);
      await reauthenticateWithCredential(currentUser, providerResult.credential);
      await currentUser.getIdToken(true);
      return {
        authorizationCode: providerResult.authorizationCode,
        provider: providerResult.provider,
      };
    });
  }, [runExclusiveAuthOperation]);

  const linkProvider = useCallback(async (provider: FederatedAuthProvider) => {
    await runExclusiveAuthOperation(async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) throw codedError("auth/requires-recent-login");
      assertRecentAuthentication(currentUser);
      const providerResult = await requestFederatedCredential(provider);
      await linkWithCredential(currentUser, providerResult.credential);
      await currentUser.reload();
      setFirebaseUser(auth.currentUser);
      setProviderRevision((revision) => revision + 1);
    });
  }, [runExclusiveAuthOperation]);

  const unlinkProvider = useCallback(async (provider: FederatedAuthProvider) => {
    await runExclusiveAuthOperation(async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) throw codedError("auth/requires-recent-login");
      if (!canUnlinkSignInMethod(currentUser.providerData, provider)) throw codedError("auth/cannot-unlink-last-provider");
      assertRecentAuthentication(currentUser);
      await unlink(currentUser, providerIdFor(provider));
      await currentUser.reload();
      setFirebaseUser(auth.currentUser);
      setProviderRevision((revision) => revision + 1);
    });
  }, [runExclusiveAuthOperation]);

  const value = useMemo<AuthContextType>(() => ({
    user,
    firebaseUser,
    loading,
    signInMethods: readSignInMethods(firebaseUser?.providerData ?? []),
    refreshProfile,
    signIn,
    signUp,
    resetPassword: async (email) => sendPasswordResetEmail(auth, email.trim()),
    signOut,
    signInWithGoogle: () => signInFederated("google"),
    signInWithApple: () => signInFederated("apple"),
    linkProvider,
    reauthenticateWithPassword,
    reauthenticateWithProvider,
    unlinkProvider,
  }), [firebaseUser, linkProvider, loading, providerRevision, reauthenticateWithPassword, reauthenticateWithProvider, refreshProfile, signIn, signInFederated, signOut, signUp, unlinkProvider, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function assertRecentAuthentication(user: User) {
  const lastSignInAt = Date.parse(user.metadata.lastSignInTime ?? "");
  if (!Number.isFinite(lastSignInAt) || Date.now() - lastSignInAt > 5 * 60 * 1000) {
    throw codedError("auth/requires-recent-login");
  }
}

function codedError(code: string) {
  const error = new Error(code);
  (error as Error & { code: string }).code = code;
  return error;
}

function getErrorCode(error: unknown) {
  if (error instanceof ProviderFlowError) return `provider/${error.code}`;
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

function getErrorEmail(error: unknown) {
  if (!error || typeof error !== "object" || !("customData" in error)) return null;
  const customData = (error as { customData?: { email?: unknown } }).customData;
  return typeof customData?.email === "string" ? customData.email : null;
}

export function useAuth() {
  return useContext(AuthContext);
}
