import React from 'react';
import { StyleSheet, Text, View, Linking } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { PrimaryButton } from '@/components/PrimaryButton';

interface SquadPermissionCardProps {
  onRetry?: () => void;
}

export function SquadPermissionCard({ onRetry }: SquadPermissionCardProps) {
  const { t } = useTranslation();

  const handleOpenSettings = async () => {
    await Linking.openSettings();
    // After user returns from Settings, allow retry
    if (onRetry) onRetry();
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <MapPin size={40} color={Colors.primary} />
        </View>
        <Text style={styles.title}>{t('squad.permissionTitle')}</Text>
        <Text style={styles.body}>{t('squad.permissionBody')}</Text>
        <PrimaryButton
          title={t('squad.openSettings')}
          onPress={handleOpenSettings}
          style={styles.button}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.background,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
    maxWidth: 340,
    width: '100%',
    ...Shadow.card,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F5EEE9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  title: {
    fontFamily: Typography.heading,
    fontSize: 20,
    color: Colors.textHeading,
    textAlign: 'center',
  },
  body: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    marginTop: Spacing.xs,
  },
});