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
import { flattenStyle } from '@/utils/flatten-style';

const SPORTS = [
  'Soccer',
  'Baseball',
  'Basketball',
  'Football',
  'Lacrosse',
  'Swimming',
  'Dance',
  'Gymnastics',
  'Tennis',
  'TrackAndField',
  'Volleyball',
  'Other',
] as const;

type Sport = (typeof SPORTS)[number];

function mapFirebaseError(code: string, t: (key: string) => string): string {
  switch (code) {
    case 'auth/email-already-in-use':
      return t('auth.errors.emailInUse');
    case 'auth/invalid-email':
      return t('auth.errors.invalidEmail');
    case 'auth/weak-password':
      return t('auth.errors.weakPassword');
    case 'auth/too-many-requests':
      return t('auth.errors.tooManyRequests');
    default:
      return t('auth.errors.generic');
  }
}

export default function SignUpScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [selectedSports, setSelectedSports] = useState<Sport[]>([]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState('');

  const toggleSport = (sport: Sport) => {
    setSelectedSports((prev) =>
      prev.includes(sport) ? prev.filter((s) => s !== sport) : [...prev, sport]
    );
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!firstName.trim()) newErrors.firstName = t('auth.errors.fieldRequired');
    if (!lastName.trim()) newErrors.lastName = t('auth.errors.fieldRequired');
    if (!email.trim() || !/.+@.+\..+/.test(email))
      newErrors.email = t('auth.errors.invalidEmail');
    if (password.length < 8) newErrors.password = t('auth.errors.shortPassword');
    if (password !== confirmPassword) newErrors.confirmPassword = t('auth.errors.passwordMismatch');
    if (!zipCode.trim() || !/^\d{5}$/.test(zipCode))
      newErrors.zipCode = t('auth.errors.invalidZip');
    if (selectedSports.length === 0) newErrors.sports = t('auth.errors.selectSport');
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreateAccount = async () => {
    setGlobalError('');
    if (!validate()) return;

    setLoading(true);
    try {
      const auth = (await import('@react-native-firebase/auth')).default;
      const firestore = (await import('@react-native-firebase/firestore')).default;

      const credential = await auth().createUserWithEmailAndPassword(email.trim(), password);
      const uid = credential.user.uid;

      await firestore().collection('users').doc(uid).set({
        userId: uid,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        zipCode: zipCode.trim(),
        sports: selectedSports,
        phoneNumber: phoneNumber.trim() || null,
        createdAt: new Date().toISOString(),
        tier: 'member',
        totalStars: 0,
        squadIds: [],
        friendIds: [],
        preferredLanguage: 'en',
        profileVisibility: 'squad_only',
      });

      router.replace('/(auth)/onboarding');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      setGlobalError(mapFirebaseError(code, t));
    } finally {
      setLoading(false);
    }
  };

  const sportLabel = (sport: Sport): string => {
    const key = `auth.sports.${sport}` as const;
    return t(key as string);
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
          <Text style={styles.title}>{t('auth.createAccount')}</Text>

          {/* First Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.firstName')}</Text>
            <TextInput
              style={flattenStyle([styles.input, !!errors.firstName && styles.inputError])}
              placeholder={t('auth.firstName')}
              placeholderTextColor={Colors.secondary}
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
            />
            {!!errors.firstName && <Text style={styles.fieldError}>{errors.firstName}</Text>}
          </View>

          {/* Last Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.lastName')}</Text>
            <TextInput
              style={flattenStyle([styles.input, !!errors.lastName && styles.inputError])}
              placeholder={t('auth.lastName')}
              placeholderTextColor={Colors.secondary}
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
            />
            {!!errors.lastName && <Text style={styles.fieldError}>{errors.lastName}</Text>}
          </View>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.emailAddress')}</Text>
            <TextInput
              style={flattenStyle([styles.input, !!errors.email && styles.inputError])}
              placeholder={t('auth.emailAddress')}
              placeholderTextColor={Colors.secondary}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {!!errors.email && <Text style={styles.fieldError}>{errors.email}</Text>}
          </View>

          {/* Password */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.password')}</Text>
            <View
              style={flattenStyle([
                styles.passwordRow,
                !!errors.password && styles.passwordRowError,
              ])}
            >
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
            {!!errors.password && <Text style={styles.fieldError}>{errors.password}</Text>}
          </View>

          {/* Confirm Password */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.confirmPassword')}</Text>
            <View
              style={flattenStyle([
                styles.passwordRow,
                !!errors.confirmPassword && styles.passwordRowError,
              ])}
            >
              <TextInput
                style={styles.passwordInput}
                placeholder={t('auth.confirmPassword')}
                placeholderTextColor={Colors.secondary}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setShowConfirmPassword((v) => !v)}
                activeOpacity={0.7}
                style={styles.showHideBtn}
              >
                <Text style={styles.showHideText}>
                  {showConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                </Text>
              </TouchableOpacity>
            </View>
            {!!errors.confirmPassword && (
              <Text style={styles.fieldError}>{errors.confirmPassword}</Text>
            )}
          </View>

          {/* Zip Code */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.zipCode')}</Text>
            <TextInput
              style={flattenStyle([styles.input, !!errors.zipCode && styles.inputError])}
              placeholder={t('auth.zipCode')}
              placeholderTextColor={Colors.secondary}
              value={zipCode}
              onChangeText={setZipCode}
              keyboardType="numeric"
              maxLength={5}
            />
            {!!errors.zipCode && <Text style={styles.fieldError}>{errors.zipCode}</Text>}
          </View>

          {/* Primary Sports */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.primarySports')}</Text>
            <View style={styles.sportsGrid}>
              {SPORTS.map((sport) => {
                const selected = selectedSports.includes(sport);
                return (
                  <TouchableOpacity
                    key={sport}
                    onPress={() => toggleSport(sport)}
                    activeOpacity={0.8}
                    style={flattenStyle([styles.chip, selected && styles.chipSelected])}
                  >
                    <Text
                      style={flattenStyle([
                        styles.chipText,
                        selected && styles.chipTextSelected,
                      ])}
                    >
                      {sportLabel(sport)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {!!errors.sports && <Text style={styles.fieldError}>{errors.sports}</Text>}
          </View>

          {/* Phone Number */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.phoneNumber')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('auth.phoneNumber')}
              placeholderTextColor={Colors.secondary}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
            />
            <Text style={styles.phoneHelper}>{t('auth.phoneHelper')}</Text>
          </View>

          {/* Global error */}
          {!!globalError && <Text style={styles.globalError}>{globalError}</Text>}

          {/* Create Account button */}
          <TouchableOpacity
            style={styles.createButton}
            onPress={handleCreateAccount}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={Colors.surface} />
            ) : (
              <Text style={styles.createButtonText}>{t('auth.createAccountButton')}</Text>
            )}
          </TouchableOpacity>

          {/* Sign in link */}
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.7}
            style={styles.signInWrapper}
          >
            <Text style={styles.bodyText}>
              {t('auth.alreadyHaveAccount')}{' '}
              <Text style={styles.linkBold}>{t('auth.signIn')}</Text>
            </Text>
          </TouchableOpacity>

          <View style={styles.bottomPad} />
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
  },
  title: {
    fontFamily: Typography.heading,
    fontSize: 28,
    color: Colors.textHeading,
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
  inputError: {
    borderColor: Colors.primary,
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
  passwordRowError: {
    borderColor: Colors.primary,
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
  fieldError: {
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    color: Colors.primary,
  },
  sportsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.secondary,
    backgroundColor: Colors.surface,
  },
  chipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: {
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  chipTextSelected: {
    color: Colors.surface,
  },
  phoneHelper: {
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    color: Colors.textPrimary,
  },
  globalError: {
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    color: Colors.primary,
    textAlign: 'center',
  },
  createButton: {
    height: 52,
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  createButtonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.surface,
  },
  signInWrapper: {
    alignSelf: 'center',
    paddingVertical: Spacing.xs,
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
  bottomPad: {
    height: Spacing.xl,
  },
});