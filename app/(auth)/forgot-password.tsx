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
import { ChevronLeft } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendReset = async () => {
    setError('');
    if (!email.trim() || !/.+@.+\..+/.test(email)) {
      setError(t('auth.errors.invalidEmail'));
      return;
    }

    setLoading(true);
    try {
      const auth = (await import('@react-native-firebase/auth')).default;
      await auth().sendPasswordResetEmail(email.trim());
      router.push('/(auth)/forgot-password-success');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/user-not-found') {
        setError(t('auth.errors.userNotFound'));
      } else if (code === 'auth/invalid-email') {
        setError(t('auth.errors.invalidEmail'));
      } else {
        setError(t('auth.errors.generic'));
      }
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
          <Text style={styles.title}>{t('auth.resetPassword')}</Text>
          <Text style={styles.subtitle}>{t('auth.resetPasswordSubtitle')}</Text>

          {/* Email field */}
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

          {/* Error */}
          {!!error && <Text style={styles.errorText}>{error}</Text>}

          {/* Send Reset Link button */}
          <TouchableOpacity
            style={styles.sendButton}
            onPress={handleSendReset}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={Colors.surface} />
            ) : (
              <Text style={styles.sendButtonText}>{t('auth.sendResetLink')}</Text>
            )}
          </TouchableOpacity>
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
    gap: Spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -Spacing.xs,
    marginBottom: Spacing.sm,
  },
  title: {
    fontFamily: Typography.heading,
    fontSize: 28,
    color: Colors.textHeading,
  },
  subtitle: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
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
  errorText: {
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    color: Colors.primary,
    textAlign: 'center',
  },
  sendButton: {
    height: 52,
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  sendButtonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.surface,
  },
});