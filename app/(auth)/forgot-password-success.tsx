import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';

export default function ForgotPasswordSuccessScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <ScreenWrapper>
      <View style={styles.container}>
        {/* Checkmark */}
        <Text style={styles.checkmark}>✓</Text>

        {/* Headline */}
        <Text style={styles.headline}>{t('auth.checkYourEmail')}</Text>

        {/* Body */}
        <Text style={styles.body}>{t('auth.resetEmailSent')}</Text>

        {/* Back to Sign In */}
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace('/(auth)/sign-in')}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>{t('auth.backToSignIn')}</Text>
        </TouchableOpacity>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.lg,
  },
  checkmark: {
    fontSize: 80,
    color: Colors.accentGreen,
    textAlign: 'center',
  },
  headline: {
    fontFamily: Typography.heading,
    fontSize: 28,
    color: Colors.textHeading,
    textAlign: 'center',
  },
  body: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  button: {
    height: 52,
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: Spacing.md,
  },
  buttonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.surface,
  },
});