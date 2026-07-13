import React, { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "@/config/firebase";
import { unregisterCurrentDeviceNotificationToken } from "@/services/notificationService";
import { resolveDisplayName } from "@/utils/profileName";

type AppUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  phoneNumber?: string | null;
  photoURL?: string | null;
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
  signIn: async () => {},
  signUp: async () => ({ uid: "", email: null, displayName: null }),
  resetPassword: async () => {},
  signOut: async () => {},
  signInWithGoogle: async () => {},
  signInWithApple: async () => {},
});

function mapUser(firebaseUser: User, displayName: string | null): AppUser {
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName,
    phoneNumber: firebaseUser.phoneNumber,
    photoURL: firebaseUser.photoURL,
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
      const loadVersion = ++profileLoadVersion.current;
      setFirebaseUser(nextUser);
      setUser(null);

      if (!nextUser) {
        setLoading(false);
        return;
      }

      setLoading(true);
      void getDoc(doc(db, "users", nextUser.uid))
        .then((profileDoc) => resolveDisplayName(profileDoc.data(), nextUser.displayName))
        .catch((error) => {
          console.warn("[Auth] profile hydration unavailable:", getErrorCode(error));
          return resolveDisplayName(null, nextUser.displayName);
        })
        .then((displayName) => {
          if (
            disposed ||
            loadVersion !== profileLoadVersion.current ||
            auth.currentUser?.uid !== nextUser.uid
          ) {
            return;
          }

          setUser(mapUser(nextUser, displayName));
          setLoading(false);
        });
    });

    return () => {
      disposed = true;
      profileLoadVersion.current += 1;
      unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextType>(() => ({
    user,
    firebaseUser,
    loading,
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
      }, { merge: true });

      const userDoc = await getDoc(doc(db, "users", credential.user.uid));
      const nextUser = mapUser(
        credential.user,
        resolveDisplayName(userDoc.data(), credential.user.displayName),
      );

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
      await firebaseSignOut(auth);
      profileLoadVersion.current += 1;
      setFirebaseUser(null);
      setUser(null);
      setLoading(false);
    },
    signInWithGoogle: async () => {
      console.warn("Google sign-in is not configured yet.");
    },
    signInWithApple: async () => {
      console.warn("Apple sign-in is not configured yet.");
    },
  }), [firebaseUser, loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

export function useAuth() {
  return useContext(AuthContext);
}