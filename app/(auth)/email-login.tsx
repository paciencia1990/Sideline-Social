import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronLeft } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';

function mapFirebaseError(code: string, t: (key: string) => string): string {
  switch (code) {
    case 'auth/user-not-found':
      return t('auth.errors.userNotFound');
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return t('auth.errors.wrongPassword');
    case 'auth/invalid-email':
      return t('auth.errors.invalidEmail');
    case 'auth/too-many-requests':
      return t('auth.errors.tooManyRequests');
    default:
      return t('auth.errors.generic');
  }
}

export default function EmailLoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignIn = async () => {
    setError('');
    if (!email.trim()) {
      setError(t('auth.errors.invalidEmail'));
      return;
    }
    if (!password) {
      setError(t('auth.errors.fieldRequired'));
      return;
    }

    setLoading(true);
    try {
      const auth = (await import('@react-native-firebase/auth')).default;
      await auth().signInWithEmailAndPassword(email.trim(), password);

      const onboardingComplete = await AsyncStorage.getItem('onboardingComplete');
      if (onboardingComplete !== 'true') {
        router.replace('/(auth)/onboarding');
      } else {
        router.replace('/(tabs)');
      }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      setError(mapFirebaseError(code, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenWrapper>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Back button */}
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.7}
            style={styles.backButton}
          >
            <ChevronLeft size={24} color={Colors.textHeading} />
          </TouchableOpacity>

          {/* Title */}
          <Text style={styles.title}>{t('auth.welcomeBack')}</Text>

          {/* Form */}
          <View style={styles.form}>
            {/* Email */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('auth.emailAddress')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('auth.emailAddress')}
                placeholderTextColor={Colors.secondary}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('auth.password')}</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder={t('auth.password')}
                  placeholderTextColor={Colors.secondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((v) => !v)}
                  activeOpacity={0.7}
                  style={styles.showHideBtn}
                >
                  <Text style={styles.showHideText}>
                    {showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Error */}
            {!!error && <Text style={styles.errorText}>{error}</Text>}

            {/* Sign In button */}
            <TouchableOpacity
              style={styles.signInButton}
              onPress={handleSignIn}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color={Colors.surface} />
              ) : (
                <Text style={styles.signInText}>{t('auth.signInButton')}</Text>
              )}
            </TouchableOpacity>

            {/* Forgot password */}
            <TouchableOpacity
              onPress={() => router.push('/(auth)/forgot-password')}
              activeOpacity={0.7}
              style={styles.linkWrapper}
            >
              <Text style={styles.linkText}>{t('auth.forgotPassword')}</Text>
            </TouchableOpacity>

            {/* Sign up link */}
            <TouchableOpacity
              onPress={() => router.push('/(auth)/sign-up')}
              activeOpacity={0.7}
              style={styles.linkWrapper}
            >
              <Text style={styles.bodyText}>
                {t('auth.dontHaveAccount')}{' '}
                <Text style={styles.linkBold}>{t('auth.signUp')}</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    padding: Spacing.lg,
    paddingTop: Spacing.md,
    flexGrow: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    marginLeft: -Spacing.xs,
  },
  title: {
    fontFamily: Typography.heading,
    fontSize: 28,
    color: Colors.textHeading,
    marginBottom: Spacing.xl,
  },
  form: {
    gap: Spacing.md,
  },
  fieldGroup: {
    gap: Spacing.xs,
  },
  label: {
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    color: Colors.textHeading,
  },
  input: {
    height: 52,
    borderWidth: 1.5,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    fontFamily: Typography.bodyRegular,
    fontSize: 15,
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
    ...Shadow.card,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    backgroundColor: Colors.surface,
    ...Shadow.card,
  },
  passwordInput: {
    flex: 1,
    height: 52,
    paddingHorizontal: Spacing.md,
    fontFamily: Typography.bodyRegular,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  showHideBtn: {
    paddingHorizontal: Spacing.md,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  showHideText: {
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    color: Colors.primary,
  },
  errorText: {
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    color: Colors.primary,
    textAlign: 'center',
  },
  signInButton: {
    height: 52,
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  signInText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.surface,
  },
  linkWrapper: {
    alignSelf: 'center',
    paddingVertical: Spacing.xs,
  },
  linkText: {
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    color: Colors.textHeading,
  },
  bodyText: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  linkBold: {
    fontFamily: Typography.bodySemiBold,
    color: Colors.primary,
  },
});