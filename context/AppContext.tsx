import React, { createContext, useContext, useState, ReactNode } from 'react';
import i18n from '@/i18n';

interface AppContextType {
  language: string;
  setLanguage: (lang: string) => void;
  theme: 'light' | 'dark';
}

const AppContext = createContext<AppContextType>({
  language: 'en',
  setLanguage: () => {},
  theme: 'light',
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState('en');

  const setLanguage = (lang: string) => {
    setLanguageState(lang);
    i18n.changeLanguage(lang);
  };

  return (
    <AppContext.Provider value={{ language, setLanguage, theme: 'light' }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}