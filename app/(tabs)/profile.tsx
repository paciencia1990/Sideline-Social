import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { User, Award, Settings } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Typography, Spacing, Shadow, Radius } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { useApp } from '@/context/AppContext';
import { flattenStyle } from '@/utils/flatten-style';

const STATS = [
  { label: 'Sideline Stars', value: '0' },
  { label: 'Games Played', value: '0' },
  { label: 'Friends', value: '0' },
];

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { language, setLanguage } = useApp();

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarLetter}>U</Text>
          </View>
          <Text style={styles.profileName}>Parent Name</Text>
          <View style={styles.tierBadge}>
            <Text style={styles.tierText}>Bronze · Level 1</Text>
          </View>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          {STATS.map((stat, index) => (
            <View key={index} style={styles.statBox}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Achievements */}
        <Text style={styles.sectionTitle}>Achievements</Text>
        <View style={styles.achievementsCard}>
          <Award size={32} color={Colors.secondary} />
          <Text style={styles.achievementsText}>Your badges will appear here</Text>
        </View>

        {/* Settings */}
        <Text style={styles.sectionTitle}>Settings</Text>
        <View style={styles.settingsCard}>
          {/* Language Toggle */}
          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>Language</Text>
            <View style={styles.langToggle}>
              <TouchableOpacity
                style={flattenStyle([styles.langButton, language === 'en' && styles.langButtonActive])}
                onPress={() => setLanguage('en')}
                activeOpacity={0.8}
              >
                <Text style={flattenStyle([styles.langText, language === 'en' && styles.langTextActive])}>EN</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={flattenStyle([styles.langButton, language === 'es' && styles.langButtonActive])}
                onPress={() => setLanguage('es')}
                activeOpacity={0.8}
              >
                <Text style={flattenStyle([styles.langText, language === 'es' && styles.langTextActive])}>ES</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Account Settings */}
          <TouchableOpacity style={styles.settingsRow} activeOpacity={0.7}>
            <Text style={styles.settingsLabel}>Account Settings</Text>
            <Settings size={18} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontFamily: Typography.heading,
    fontSize: 32,
    color: '#FFFFFF',
  },
  profileName: {
    fontFamily: Typography.heading,
    fontSize: 22,
    color: Colors.textHeading,
  },
  tierBadge: {
    backgroundColor: `${Colors.accentGold}22`,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.accentGold,
  },
  tierText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    color: Colors.accentGold,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  statBox: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    alignItems: 'center',
    ...Shadow.card,
  },
  statValue: {
    fontFamily: Typography.heading,
    fontSize: 22,
    color: Colors.primary,
  },
  statLabel: {
    fontFamily: Typography.bodyRegular,
    fontSize: 10,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  sectionTitle: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.textHeading,
  },
  achievementsCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.card,
  },
  achievementsText: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  settingsCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    overflow: 'hidden',
    ...Shadow.card,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: `${Colors.secondary}60`,
  },
  settingsLabel: {
    fontFamily: Typography.bodyMedium,
    fontSize: 14,
    color: Colors.textHeading,
  },
  langToggle: {
    flexDirection: 'row',
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.secondary,
    overflow: 'hidden',
  },
  langButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: 'transparent',
  },
  langButtonActive: {
    backgroundColor: Colors.primary,
  },
  langText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    color: Colors.textPrimary,
  },
  langTextActive: {
    color: '#FFFFFF',
  },
});