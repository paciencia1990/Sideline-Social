import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BarChart3, Lock } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';

export default function LeagueDashboardScreen() {
  return (
    <ScreenWrapper>
      <View style={styles.container}>
        <View style={styles.lockedWrapper}>
          <View style={styles.iconArea}>
            <BarChart3 size={64} color={`${Colors.accentGold}80`} />
          </View>
          <View style={styles.lockOverlay}>
            <Lock size={28} color={Colors.accentGold} />
          </View>
        </View>
        <Text style={styles.title}>League Dashboard</Text>
        <View style={styles.comingSoonBadge}>
          <Text style={styles.comingSoonText}>Coming Soon</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.description}>
            Track your league's standings, schedules, and results
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
  lockedWrapper: {
    position: 'relative',
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconArea: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockOverlay: {
    position: 'absolute',
    bottom: -8,
    right: -8,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.accentGold,
  },
  title: {
    fontFamily: Typography.heading,
    fontSize: 28,
    color: Colors.textHeading,
    textAlign: 'center',
    opacity: 0.7,
  },
  comingSoonBadge: {
    backgroundColor: `${Colors.accentGold}22`,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.accentGold,
  },
  comingSoonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    color: Colors.accentGold,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    maxWidth: 300,
    opacity: 0.7,
    ...Shadow.card,
  },
  description: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
});