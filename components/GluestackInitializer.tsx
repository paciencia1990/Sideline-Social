import { GluestackUIProvider } from "@/components/ui/gluestack-ui-provider";
import "@/global.css";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import React from "react";
import "react-native-reanimated";

interface GluestackInitializerProps {
  colorScheme: "light" | "dark" | undefined;
  children: React.ReactNode;
}

/*
 * THIS FILE SHOULD NOT BE UPDATED */
export default function GluestackInitializer(props: GluestackInitializerProps) {
  return (
    <GluestackUIProvider mode={props.colorScheme === "dark" ? "dark" : "light"}>
      <ThemeProvider
        value={props.colorScheme === "dark" ? DarkTheme : DefaultTheme}
      >
        {props.children}
      </ThemeProvider>
    </GluestackUIProvider>
  );
}
