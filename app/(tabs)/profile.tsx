import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { useAuth } from "@/context/AuthContext";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function ProfileScreen() {
  const { user, signOut } = useAuth();

  return (
    <ScreenWrapper>
      <View style={styles.content}>
        <Text style={styles.title}>Profile</Text>
        <Card style={styles.card}>
          <Text style={styles.name}>{user?.displayName || "Sideline parent"}</Text>
          <Text style={styles.email}>{user?.email || "Not signed in"}</Text>
          <PrimaryButton title="Sign out" onPress={signOut} disabled={!user} />
        </Card>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  title: { fontFamily: Typography.heading, fontSize: 30, color: Colors.textHeading },
  card: { gap: Spacing.md },
  name: { fontFamily: Typography.bodySemiBold, fontSize: 18, color: Colors.textHeading },
  email: { fontFamily: Typography.bodyRegular, color: Colors.textPrimary },
});