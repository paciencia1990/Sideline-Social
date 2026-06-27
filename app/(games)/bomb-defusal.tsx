import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Bomb, Lock } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';

export default function BombDefusalScreen() {
  return (
    <ScreenWrapper>
      <View style={styles.container}>
        <View style={styles.iconStack}>
          <Bomb size={72} color={Colors.primary} />
          <View style={styles.lockBadge}>
            <Lock size={18} color={Colors.surface} />
          </View>
        </View>
        <Text style={styles.title}>Bomb Defusal</Text>
        <View style={styles.comingSoonBadge}>
          <Text style={styles.comingSoonText}>Coming Soon</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.description}>
            Defuse the bomb as a team before time runs out. Real-time multiplayer coming soon!
          </Text>
        </View>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  iconStack: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: Colors.textHeading,
    borderRadius: 12,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: Typography.heading,
    fontSize: 30,
    color: Colors.textHeading,
    textAlign: 'center',
  },
  comingSoonBadge: {
    backgroundColor: `${Colors.primary}22`,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  comingSoonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    color: Colors.primary,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    maxWidth: 300,
    ...Shadow.card,
  },
  description: {
    fontFamily: Typography.bodyRegular,
    fontSize: 15,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
});