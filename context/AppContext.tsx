import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import i18n from "@/i18n";
import { useAuth } from "@/context/AuthContext";
import { resolveInitialMode, type AppMode } from "@/utils/onboardingMode";
import { startDevelopmentPerformanceTrace } from "@/utils/performanceDiagnostics";

type SupportedLanguage = "en" | "es";

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
  const [hydratedUserId, setHydratedUserId] = useState<string | null>();
  const explicitModeChoice = useRef<{ userId: string; mode: AppMode } | null>(null);
  const userId = user?.uid ?? null;
  const modeHydrated = !authLoading && hydratedUserId === userId;

  useEffect(() => {
    if (authLoading) return;
    if (explicitModeChoice.current?.userId !== userId) explicitModeChoice.current = null;

    let isMounted = true;

    async function hydrateMode() {
      const completeTrace = startDevelopmentPerformanceTrace("startup.mode-hydration");
      try {
        if (!userId) {
          setActiveModeState("parent");
          await AsyncStorage.removeItem(MODE_STORAGE_KEY).catch(() => undefined);
          if (isMounted) setHydratedUserId(null);
          return;
        }

        const storedMode = await AsyncStorage.getItem(MODE_STORAGE_KEY).catch(() => null);
        if (!isMounted) return;

        // A current session's navigation choice survives an unavailable or stale
        // server preference. This does not change team or account authorization.
        const nextMode = explicitModeChoice.current?.userId === userId
          ? explicitModeChoice.current.mode : resolveInitialMode(user, storedMode);
        setActiveModeState(nextMode);
        await AsyncStorage.setItem(MODE_STORAGE_KEY, nextMode).catch(() => undefined);
        if (isMounted) setHydratedUserId(userId);
      } finally {
        completeTrace();
      }
    }

    void hydrateMode();
    return () => {
      isMounted = false;
    };
  }, [authLoading, user, userId]);

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
    if (userId) explicitModeChoice.current = { userId, mode: nextMode };
    setActiveModeState(nextMode);
    AsyncStorage.setItem(MODE_STORAGE_KEY, nextMode).catch(() => undefined);
  }, [userId]);

  const value = useMemo<AppContextType>(() => ({
    language,
    setLanguage,
    theme: "light",
    activeMode,
    modeHydrated,
    setActiveMode,
  }), [activeMode, language, modeHydrated, setActiveMode, setLanguage]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
