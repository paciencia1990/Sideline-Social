import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, type DocumentData } from "firebase/firestore";
import { auth, db } from "@/config/firebase";
import { clearSignedInUserLocalState } from "@/services/localUserStateService";
import { unregisterCurrentDeviceNotificationToken } from "@/services/notificationService";
import { completeLocalSignOut } from "@/utils/localUserStateCore";
import { readModeOnboardingState, type AppMode } from "@/utils/onboardingMode";
import { resolveDisplayName } from "@/utils/profileName";
import { setVoicePlaybackAuthorizationContext } from "@/utils/voicePlaybackCore";

type AppUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  phoneNumber?: string | null;
  photoURL?: string | null;
  activeMode: AppMode | null;
  defaultMode: AppMode | null;
  onboardingPath: AppMode | null;
  modeOnboardingCompleted: boolean;
};

type SignUpProfile = {
  firstName?: string;
  lastName?: string;
  zipCode?: string;
  sports?: string[];
  phoneNumber?: string | null;
};

interface AuthContextType {
  user: AppUser | null;
  firebaseUser: User | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, profile?: SignUpProfile) => Promise<AppUser>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  firebaseUser: null,
  loading: true,
  refreshProfile: async () => {},
  signIn: async () => {},
  signUp: async () => ({
    uid: "",
    email: null,
    displayName: null,
    activeMode: null,
    defaultMode: null,
    onboardingPath: null,
    modeOnboardingCompleted: true,
  }),
  resetPassword: async () => {},
  signOut: async () => {},
  signInWithGoogle: async () => {},
  signInWithApple: async () => {},
});

function mapUser(firebaseUser: User, profile?: DocumentData): AppUser {
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
    modeOnboardingCompleted: modeState.onboardingCompleted,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const profileLoadVersion = useRef(0);

  useEffect(() => {
    let disposed = false;

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setVoicePlaybackAuthorizationContext(nextUser?.uid ?? null);
      const loadVersion = ++profileLoadVersion.current;
      setFirebaseUser(nextUser);
      setUser(null);

      if (!nextUser) {
        setLoading(false);
        return;
      }

      setLoading(true);
      void getDoc(doc(db, "users", nextUser.uid))
        .then((profileDoc) => profileDoc.data())
        .catch((error) => {
          console.warn("[Auth] profile hydration unavailable:", getErrorCode(error));
          return undefined;
        })
        .then((profile) => {
          if (
            disposed ||
            loadVersion !== profileLoadVersion.current ||
            auth.currentUser?.uid !== nextUser.uid
          ) {
            return;
          }

          setUser(mapUser(nextUser, profile));
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
    if (!currentUser) {
      setFirebaseUser(null);
      setUser(null);
      setLoading(false);
      return;
    }

    const loadVersion = ++profileLoadVersion.current;
    setLoading(true);
    try {
      const profileDoc = await getDoc(doc(db, "users", currentUser.uid));
      if (
        loadVersion !== profileLoadVersion.current ||
        auth.currentUser?.uid !== currentUser.uid
      ) {
        return;
      }

      setFirebaseUser(currentUser);
      setUser(mapUser(currentUser, profileDoc.data()));
    } finally {
      if (
        loadVersion === profileLoadVersion.current &&
        auth.currentUser?.uid === currentUser.uid
      ) {
        setLoading(false);
      }
    }
  }, []);

  const value = useMemo<AuthContextType>(() => ({
    user,
    firebaseUser,
    loading,
    refreshProfile,
    signIn: async (email, password) => {
      setUser(null);
      setLoading(true);
      try {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } catch (error) {
        setLoading(false);
        throw error;
      }
    },
    signUp: async (email, password, profile = {}) => {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const firstName = profile.firstName?.trim() ?? "";
      const lastName = profile.lastName?.trim() ?? "";
      const displayName = [firstName, lastName].filter(Boolean).join(" ");

      if (displayName) {
        await updateProfile(credential.user, { displayName });
      }

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
        tier: "member",
        totalStars: 0,
        sidelineStars: 0,
        squadIds: [],
        friendIds: [],
        preferredLanguage: "en",
        profileVisibility: "squad_only",
        modeOnboardingCompleted: false,
      }, { merge: true });

      const userDoc = await getDoc(doc(db, "users", credential.user.uid));
      const nextUser = mapUser(credential.user, userDoc.data());

      profileLoadVersion.current += 1;
      setFirebaseUser(credential.user);
      setUser(nextUser);
      setLoading(false);
      return nextUser;
    },
    resetPassword: async (email) => {
      await sendPasswordResetEmail(auth, email.trim());
    },
    signOut: async () => {
      try {
        await unregisterCurrentDeviceNotificationToken();
      } catch (error) {
        console.warn("[Notifications] sign-out cleanup unavailable:", getErrorCode(error));
      }
      await completeLocalSignOut({
        firebaseSignOut: () => firebaseSignOut(auth),
        clearLocalUserState: clearSignedInUserLocalState,
        reportFailure: (stage, error) => {
          const label = stage === "firebase-sign-out" ? "Firebase sign-out" : "local sign-out cleanup";
          console.warn(`[Auth] ${label} unavailable:`, getErrorCode(error));
        },
        resetLocalAuthContext: () => {
          setVoicePlaybackAuthorizationContext(null);
          profileLoadVersion.current += 1;
          setFirebaseUser(null);
          setUser(null);
          setLoading(false);
        },
      });
    },
    signInWithGoogle: async () => {
      console.warn("Google sign-in is not configured yet.");
    },
    signInWithApple: async () => {
      console.warn("Apple sign-in is not configured yet.");
    },
  }), [firebaseUser, loading, refreshProfile, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

export function useAuth() {
  return useContext(AuthContext);
}
