import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function FriendsScreen() {
  return (
    <ScreenWrapper>
      <View style={styles.content}>
        <Text style={styles.title}>Friends</Text>
        <Card>
          <Text style={styles.cardTitle}>Social connections</Text>
          <Text style={styles.cardText}>Friend discovery will appear here once the Firebase collections are ready.</Text>
        </Card>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  title: { fontFamily: Typography.heading, fontSize: 30, color: Colors.textHeading },
  cardTitle: { fontFamily: Typography.bodySemiBold, fontSize: 18, color: Colors.textHeading },
  cardText: { fontFamily: Typography.bodyRegular, color: Colors.textPrimary, lineHeight: 20, marginTop: Spacing.sm },
});