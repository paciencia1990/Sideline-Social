import { useColorScheme as useColorSchemeNative } from "nativewind";

export default function useColorScheme() {
  return useColorSchemeNative().colorScheme;
}
