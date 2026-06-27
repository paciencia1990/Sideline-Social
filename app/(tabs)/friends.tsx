import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Users, UserPlus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Typography, Spacing, Shadow, Radius } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';

const SUGGESTED = [
  { id: '1', initials: 'MK', name: 'Morgan K.' },
  { id: '2', initials: 'JL', name: 'Jamie L.' },
  { id: '3', initials: 'RS', name: 'Riley S.' },
];

export default function FriendsScreen() {
  const { t } = useTranslation();

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Users size={48} color={Colors.primary} />
          <Text style={styles.title}>{t('friends.title')}</Text>
          <Text style={styles.subtitle}>Connect with parents from your squad</Text>
        </View>

        {/* Friend Requests Section */}
        <Text style={styles.sectionTitle}>Friend Requests</Text>
        <View style={styles.emptyState}>
          <UserPlus size={32} color={Colors.secondary} />
          <Text style={styles.emptyText}>No pending requests</Text>
        </View>

        {/* Suggested Connections */}
        <Text style={styles.sectionTitle}>Suggested Connections</Text>
        {SUGGESTED.map((person) => (
          <View key={person.id} style={styles.friendCard}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{person.initials}</Text>
            </View>
            <Text style={styles.friendName}>{person.name}</Text>
            <TouchableOpacity style={styles.connectButton} activeOpacity={0.8}>
              <Text style={styles.connectText}>Connect</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  header: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  title: {
    fontFamily: Typography.heading,
    fontSize: 28,
    color: Colors.textHeading,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  sectionTitle: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.textHeading,
  },
  emptyState: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.card,
  },
  emptyText: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  friendCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.card,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.textHeading,
  },
  friendName: {
    fontFamily: Typography.bodyMedium,
    fontSize: 14,
    color: Colors.textHeading,
    flex: 1,
  },
  connectButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.button,
  },
  connectText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    color: '#FFFFFF',
  },
});