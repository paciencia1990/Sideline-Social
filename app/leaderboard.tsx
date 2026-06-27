import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function LeaderboardScreen() {
  return (
    <ScreenWrapper>
      <View style={styles.content}>
        <Text style={styles.title}>Leaderboard</Text>
        <Text style={styles.text}>Sideline Stars rankings will show here after the Firebase data model is populated.</Text>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  title: { fontFamily: Typography.heading, fontSize: 30, color: Colors.textHeading },
  text: { fontFamily: Typography.bodyRegular, color: Colors.textPrimary, lineHeight: 22 },
});