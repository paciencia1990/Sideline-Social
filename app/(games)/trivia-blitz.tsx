import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Zap, Lock } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';

export default function TriviaBlitzScreen() {
  return (
    <ScreenWrapper>
      <View style={styles.container}>
        <View style={styles.iconStack}>
          <Zap size={72} color={Colors.accentGreen} />
          <View style={styles.lockBadge}>
            <Lock size={18} color={Colors.surface} />
          </View>
        </View>
        <Text style={styles.title}>Trivia Blitz</Text>
        <View style={styles.comingSoonBadge}>
          <Text style={styles.comingSoonText}>Coming Soon</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.description}>
            Race to answer trivia questions with your squad!
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
    backgroundColor: Colors.accentGreen,
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
    backgroundColor: `${Colors.accentGreen}22`,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.accentGreen,
  },
  comingSoonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    color: Colors.accentGreen,
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