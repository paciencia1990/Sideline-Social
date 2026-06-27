import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Eye, Lock } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';

export default function SpotDifferenceScreen() {
  return (
    <ScreenWrapper>
      <View style={styles.container}>
        <View style={styles.iconStack}>
          <Eye size={72} color={Colors.accentGold} />
          <View style={styles.lockBadge}>
            <Lock size={18} color={Colors.surface} />
          </View>
        </View>
        <Text style={styles.title}>Spot the Difference</Text>
        <View style={styles.comingSoonBadge}>
          <Text style={styles.comingSoonText}>Coming Soon</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.description}>
            Find the differences between two images. Launching soon!
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
    backgroundColor: Colors.accentGold,
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
    ...Shadow.card,
  },
  description: {
    fontFamily: Typography.bodyRegular,
    fontSize: 15,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
});