import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Firebase User type (from @react-native-firebase/auth)
interface FirebaseUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  phoneNumber?: string | null;
  photoURL?: string | null;
}

interface AuthContextType {
  user: FirebaseUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<FirebaseUser>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => ({ uid: '', email: null, displayName: null }),
  signOut: async () => {},
  signInWithGoogle: async () => {},
  signInWithApple: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const setupAuthListener = async () => {
      try {
        // Dynamically import to gracefully handle missing native config
        const auth = (await import('@react-native-firebase/auth')).default;
        unsubscribe = auth().onAuthStateChanged((firebaseUser) => {
          if (firebaseUser) {
            setUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              phoneNumber: firebaseUser.phoneNumber,
              photoURL: firebaseUser.photoURL,
            });
          } else {
            setUser(null);
          }
          setLoading(false);
        });
      } catch (error) {
        // Firebase not configured yet (missing native files) — fall through gracefully
        console.warn('[AuthContext] Firebase not configured:', error);
        setLoading(false);
      }
    };

    setupAuthListener();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string): Promise<void> => {
    const auth = (await import('@react-native-firebase/auth')).default;
    await auth().signInWithEmailAndPassword(email, password);
  };

  const signUp = async (email: string, password: string): Promise<FirebaseUser> => {
    const auth = (await import('@react-native-firebase/auth')).default;
    const credential = await auth().createUserWithEmailAndPassword(email, password);
    const fbUser = credential.user;
    return {
      uid: fbUser.uid,
      email: fbUser.email,
      displayName: fbUser.displayName,
      phoneNumber: fbUser.phoneNumber,
      photoURL: fbUser.photoURL,
    };
  };

  const signOut = async (): Promise<void> => {
    try {
      const auth = (await import('@react-native-firebase/auth')).default;
      await auth().signOut();
    } catch (error) {
      console.warn('[AuthContext] signOut error:', error);
    }
    setUser(null);
  };

  const signInWithGoogle = async (): Promise<void> => {
    // TODO: Wire up Google Sign-In with expo-auth-session when GoogleService credentials are available
    console.warn('[AuthContext] Google sign-in not configured yet.');
  };

  const signInWithApple = async (): Promise<void> => {
    // TODO: Wire up Apple Sign-In with expo-apple-authentication when Apple credentials are available
    console.warn('[AuthContext] Apple sign-in not configured yet.');
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, signInWithGoogle, signInWithApple }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}