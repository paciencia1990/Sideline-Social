import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MessageSquare } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';

export default function SquadChatScreen() {
  return (
    <ScreenWrapper>
      <View style={styles.container}>
        <MessageSquare size={64} color={Colors.primary} />
        <Text style={styles.title}>Squad Chat</Text>
        <View style={styles.card}>
          <Text style={styles.description}>Group chat with your nearby squad</Text>
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
  title: {
    fontFamily: Typography.heading,
    fontSize: 28,
    color: Colors.textHeading,
    textAlign: 'center',
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
    fontSize: 14,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
});