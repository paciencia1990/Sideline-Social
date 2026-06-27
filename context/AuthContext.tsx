import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
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

function mapUser(firebaseUser: User | null): AppUser | null {
  if (!firebaseUser) return null;
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    phoneNumber: firebaseUser.phoneNumber,
    photoURL: firebaseUser.photoURL,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setFirebaseUser(nextUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value = useMemo<AuthContextType>(() => ({
    user: mapUser(firebaseUser),
    firebaseUser,
    loading,
    signIn: async (email, password) => {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    },
    signUp: async (email, password, profile = {}) => {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();

      if (displayName) {
        await updateProfile(credential.user, { displayName });
      }

      await setDoc(doc(db, "users", credential.user.uid), {
        userId: credential.user.uid,
        firstName: profile.firstName ?? "",
        lastName: profile.lastName ?? "",
        displayName: displayName || null,
        email: email.trim(),
        zipCode: profile.zipCode ?? "",
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
      const data = userDoc.data();

      return {
        uid: credential.user.uid,
        email: credential.user.email,
        displayName: (data?.displayName as string | null) ?? displayName ?? null,
        phoneNumber: credential.user.phoneNumber,
        photoURL: credential.user.photoURL,
      };
    },
    resetPassword: async (email) => {
      await sendPasswordResetEmail(auth, email.trim());
    },
    signOut: async () => {
      await firebaseSignOut(auth);
    },
    signInWithGoogle: async () => {
      console.warn("Google sign-in is not configured yet.");
    },
    signInWithApple: async () => {
      console.warn("Apple sign-in is not configured yet.");
    },
  }), [firebaseUser, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}