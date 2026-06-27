import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Spacing, Typography } from "@/constants/theme";

export function GamePlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <ScreenWrapper>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <PrimaryButton title="Back to Games" onPress={() => router.replace("/(tabs)/games")} />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: "center", padding: Spacing.lg, gap: Spacing.md },
  title: { fontFamily: Typography.heading, fontSize: 32, color: Colors.textHeading, textAlign: "center" },
  body: { fontFamily: Typography.bodyRegular, fontSize: 16, color: Colors.textPrimary, textAlign: "center", lineHeight: 24, marginBottom: Spacing.md },
});