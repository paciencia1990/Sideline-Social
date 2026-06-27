import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Bell, Trophy, Users } from "lucide-react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { useAuth } from "@/context/AuthContext";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function HomeScreen() {
  const { user } = useAuth();
  const name = user?.displayName || user?.email || "Sideline parent";

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>Sideline Squad</Text>
        <Text style={styles.title}>Welcome, {name}</Text>
        <Text style={styles.subtitle}>Find nearby parents, join a squad, and turn wait time into game time.</Text>

        <Card style={styles.card}>
          <View style={styles.row}>
            <Users size={28} color={Colors.primary} />
            <View style={styles.copy}>
              <Text style={styles.cardTitle}>Squads nearby</Text>
              <Text style={styles.cardText}>Use the Squad tab to discover or create a sideline group.</Text>
            </View>
          </View>
          <PrimaryButton title="Open Squad" onPress={() => router.push("/(tabs)/squad")} />
        </Card>

        <Card style={styles.card}>
          <View style={styles.row}>
            <Trophy size={28} color={Colors.accentGold} />
            <View style={styles.copy}>
              <Text style={styles.cardTitle}>Sideline Stars</Text>
              <Text style={styles.cardText}>Challenges and rewards are ready for Firebase-backed data.</Text>
            </View>
          </View>
        </Card>

        <Card style={styles.card}>
          <View style={styles.row}>
            <Bell size={28} color={Colors.accentGreen} />
            <View style={styles.copy}>
              <Text style={styles.cardTitle}>Updates</Text>
              <Text style={styles.cardText}>Notifications will appear here once your backend rules are live.</Text>
            </View>
          </View>
        </Card>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  kicker: { fontFamily: Typography.accent, fontSize: 24, color: Colors.primary },
  title: { fontFamily: Typography.heading, fontSize: 30, color: Colors.textHeading },
  subtitle: { fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 22, color: Colors.textPrimary },
  card: { gap: Spacing.md },
  row: { flexDirection: "row", gap: Spacing.md, alignItems: "center" },
  copy: { flex: 1 },
  cardTitle: { fontFamily: Typography.bodySemiBold, fontSize: 16, color: Colors.textHeading },
  cardText: { fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, color: Colors.textPrimary, marginTop: 2 },
});