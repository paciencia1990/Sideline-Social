import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import i18n from "@/i18n";
import { useAuth } from "@/context/AuthContext";

type SupportedLanguage = "en" | "es";
type AppMode = "parent" | "coach";

interface AppContextType {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  theme: "light" | "dark";
  activeMode: AppMode;
  modeHydrated: boolean;
  setActiveMode: (mode: AppMode) => void;
}

const MODE_STORAGE_KEY = "sidelineSocial.activeMode";

function normalizeLanguage(language?: string): SupportedLanguage {
  return language?.startsWith("es") ? "es" : "en";
}

function normalizeMode(mode?: string | null): AppMode {
  return mode === "coach" ? "coach" : "parent";
}

const AppContext = createContext<AppContextType>({
  language: "en",
  setLanguage: () => {},
  theme: "light",
  activeMode: "parent",
  modeHydrated: false,
  setActiveMode: () => {},
});

export function AppProvider({ children }: { children: ReactNode }) {
  const { loading: authLoading, user } = useAuth();
  const [language, setLanguageState] = useState<SupportedLanguage>(() =>
    normalizeLanguage(i18n.resolvedLanguage ?? i18n.language)
  );
  const [activeMode, setActiveModeState] = useState<AppMode>("parent");
  const [modeHydrated, setModeHydrated] = useState(false);
  const signedOutResetComplete = useRef(false);
  const userId = user?.uid ?? null;

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(MODE_STORAGE_KEY)
      .then((storedMode) => {
        if (isMounted) setActiveModeState(normalizeMode(storedMode));
      })
      .catch(() => {
        if (isMounted) setActiveModeState("parent");
      })
      .finally(() => {
        if (isMounted) setModeHydrated(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (authLoading || !modeHydrated) return;

    if (userId) {
      signedOutResetComplete.current = false;
      return;
    }

    if (signedOutResetComplete.current) return;
    signedOutResetComplete.current = true;

    if (activeMode !== "parent") setActiveModeState("parent");
    AsyncStorage.removeItem(MODE_STORAGE_KEY).catch(() => undefined);
  }, [activeMode, authLoading, modeHydrated, userId]);
  useEffect(() => {
    const handleLanguageChanged = (nextLanguage: string) => {
      setLanguageState(normalizeLanguage(nextLanguage));
    };

    i18n.on("languageChanged", handleLanguageChanged);
    setLanguageState(normalizeLanguage(i18n.resolvedLanguage ?? i18n.language));

    return () => {
      i18n.off("languageChanged", handleLanguageChanged);
    };
  }, []);

  const setLanguage = useCallback((nextLanguage: SupportedLanguage) => {
    setLanguageState(nextLanguage);
    void i18n.changeLanguage(nextLanguage);
  }, []);

  const setActiveMode = useCallback((nextMode: AppMode) => {
    setActiveModeState(nextMode);
    AsyncStorage.setItem(MODE_STORAGE_KEY, nextMode).catch(() => undefined);
  }, []);

  return (
    <AppContext.Provider value={{ language, setLanguage, theme: "light", activeMode, modeHydrated, setActiveMode }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
