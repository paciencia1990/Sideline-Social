import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import i18n from "@/i18n";

type SupportedLanguage = "en" | "es";

interface AppContextType {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  theme: "light" | "dark";
}

function normalizeLanguage(language?: string): SupportedLanguage {
  return language?.startsWith("es") ? "es" : "en";
}

const AppContext = createContext<AppContextType>({
  language: "en",
  setLanguage: () => {},
  theme: "light",
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>(() =>
    normalizeLanguage(i18n.resolvedLanguage ?? i18n.language)
  );

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

  return (
    <AppContext.Provider value={{ language, setLanguage, theme: "light" }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
