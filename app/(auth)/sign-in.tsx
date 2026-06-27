import React from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';

export default function SignInScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const handleGoogle = () => {
    Alert.alert('Coming Soon', 'Google Sign-In is coming soon!');
  };

  const handleApple = () => {
    Alert.alert('Coming Soon', 'Apple Sign-In is coming soon!');
  };

  return (
    <ScreenWrapper>
      <View style={styles.container}>
        {/* Top section — Wordmark + tagline */}
        <View style={styles.wordmarkSection}>
          <Text style={styles.appName}>Sideline Squad</Text>
          <Text style={styles.tagline}>{t('common.tagline')}</Text>
        </View>

        {/* Sign-in buttons */}
        <View style={styles.buttonsSection}>
          {/* Google */}
          <TouchableOpacity style={styles.googleButton} onPress={handleGoogle} activeOpacity={0.8}>
            <Text style={styles.googleIcon}>G</Text>
            <Text style={styles.googleText}>{t('auth.continueWithGoogle')}</Text>
          </TouchableOpacity>

          {/* Apple */}
          <TouchableOpacity style={styles.appleButton} onPress={handleApple} activeOpacity={0.8}>
            <Text style={styles.appleIcon}></Text>
            <Text style={styles.appleText}>{t('auth.continueWithApple')}</Text>
          </TouchableOpacity>

          {/* Email */}
          <TouchableOpacity
            style={styles.emailButton}
            onPress={() => router.push('/(auth)/email-login')}
            activeOpacity={0.8}
          >
            <Text style={styles.emailText}>{t('auth.signInWithEmail')}</Text>
          </TouchableOpacity>

          {/* Forgot Password */}
          <TouchableOpacity
            onPress={() => router.push('/(auth)/forgot-password')}
            activeOpacity={0.7}
            style={styles.forgotWrapper}
          >
            <Text style={styles.forgotText}>{t('auth.forgotPassword')}</Text>
          </TouchableOpacity>
        </View>

        {/* Sign Up Link */}
        <TouchableOpacity
          onPress={() => router.push('/(auth)/sign-up')}
          activeOpacity={0.7}
          style={styles.signUpWrapper}
        >
          <Text style={styles.signUpText}>
            {t('auth.newHere')}{' '}
            <Text style={styles.signUpLink}>{t('auth.createAccount')}</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
    gap: Spacing.xl,
  },
  wordmarkSection: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  appName: {
    fontFamily: Typography.heading,
    fontSize: 34,
    color: Colors.textHeading,
  },
  tagline: {
    fontFamily: Typography.accent,
    fontSize: 16,
    color: Colors.accentGreen,
    fontStyle: 'italic',
  },
  buttonsSection: {
    gap: Spacing.md,
  },
  googleButton: {
    height: 52,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    ...Shadow.card,
  },
  googleIcon: {
    fontFamily: Typography.bodyBold,
    fontSize: 18,
    color: Colors.primary,
  },
  googleText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  appleButton: {
    height: 52,
    backgroundColor: '#000000',
    borderRadius: Radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  appleIcon: {
    fontSize: 18,
    color: '#FFFFFF',
  },
  appleText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  emailButton: {
    height: 52,
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.surface,
  },
  forgotWrapper: {
    alignSelf: 'center',
    paddingVertical: Spacing.xs,
  },
  forgotText: {
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    color: Colors.textHeading,
  },
  signUpWrapper: {
    alignSelf: 'center',
  },
  signUpText: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  signUpLink: {
    fontFamily: Typography.bodySemiBold,
    color: Colors.textHeading,
  },
});