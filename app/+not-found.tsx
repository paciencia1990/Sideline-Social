import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Link, Stack } from "expo-router";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not Found" }} />
      <View style={styles.container}>
        <Text style={styles.title}>This screen does not exist.</Text>
        <Link href="/(tabs)" style={styles.link}>Go home</Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    backgroundColor: Colors.background,
    padding: Spacing.lg,
  },
  title: {
    fontFamily: Typography.heading,
    color: Colors.textHeading,
    fontSize: 22,
    textAlign: "center",
  },
  link: {
    fontFamily: Typography.bodySemiBold,
    color: Colors.primary,
    fontSize: 16,
  },
});