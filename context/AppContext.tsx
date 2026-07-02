import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import i18n from "@/i18n";

type SupportedLanguage = "en" | "es";
type AppMode = "parent" | "coach";

interface AppContextType {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  theme: "light" | "dark";
  activeMode: AppMode;
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
  setActiveMode: () => {},
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>(() =>
    normalizeLanguage(i18n.resolvedLanguage ?? i18n.language)
  );
  const [activeMode, setActiveModeState] = useState<AppMode>("parent");

  useEffect(() => {
    AsyncStorage.getItem(MODE_STORAGE_KEY)
      .then((storedMode) => setActiveModeState(normalizeMode(storedMode)))
      .catch(() => setActiveModeState("parent"));
  }, []);

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
    <AppContext.Provider value={{ language, setLanguage, theme: "light", activeMode, setActiveMode }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}