import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { router } from "expo-router";

import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Spacing, Typography } from "@/constants/theme";

const games = [
  {
    title: "Bomb Defusal",
    route: "/(games)/bomb-defusal/Lobby",
    body: "Team up to solve sideline clues before the timer runs out.",
  },
  {
    title: "Spot the Difference",
    route: "/(games)/spot-the-difference/Lobby",
    body: "A quick visual game for parents between plays.",
  },
  {
    title: "Trivia Blitz",
    route: "/(games)/trivia-blitz/Lobby",
    body: "Fast sports and community trivia for the whole squad.",
  },
] as const;

export default function GamesScreen() {
  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Games</Text>
        <Text style={styles.subtitle}>Open a lobby, ready up, and start the countdown.</Text>
        {games.map((game) => (
          <Card key={game.title} style={styles.card}>
            <Text style={styles.cardTitle}>{game.title}</Text>
            <Text style={styles.cardText}>{game.body}</Text>
            <PrimaryButton title="Open Lobby" onPress={() => router.push(game.route as never)} />
          </Card>
        ))}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  title: { fontFamily: Typography.heading, fontSize: 30, color: Colors.textHeading },
  subtitle: { fontFamily: Typography.bodyRegular, color: Colors.textPrimary, lineHeight: 22 },
  card: { gap: Spacing.sm },
  cardTitle: { fontFamily: Typography.bodySemiBold, fontSize: 18, color: Colors.textHeading },
  cardText: { fontFamily: Typography.bodyRegular, color: Colors.textPrimary, lineHeight: 20 },
});
