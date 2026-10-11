import { createContext, useContext } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const ParentNavigationContext = createContext(false);

export function useParentScreenInsets() {
  const insets = useSafeAreaInsets();
  const menuVisible = useContext(ParentNavigationContext);
  // The menu owns the bottom safe area, and takes space in the layout rather
  // than covering content. Full-screen modal components still use real insets.
  return menuVisible ? { ...insets, bottom: 0 } : insets;
}
