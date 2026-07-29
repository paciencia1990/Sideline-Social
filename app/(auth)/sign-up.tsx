import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { PasswordInput } from "@/components/PasswordInput";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { CHOOSE_START_MODE_ROUTE } from "@/constants/routes";
import { useAuth } from "@/context/AuthContext";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";

export default function SignUpScreen() {
  const { t } = useTranslation();
  const { signUp } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [sport, setSport] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    setError("");
    if (!firstName.trim() || !lastName.trim() || !email.trim() || password.length < 8) {
      setError(t("auth.errors.signupRequired"));
      return;
    }

    setLoading(true);
    try {
      await signUp(email, password, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        zipCode: zipCode.trim(),
        sports: sport.trim() ? [sport.trim()] : [],
      });
      await AsyncStorage.setItem("onboardingComplete", "true");
      router.replace(CHOOSE_START_MODE_ROUTE as never);
    } catch (nextError) {
      if (__DEV__) console.warn("[SignUp] create account error:", nextError);
      setError(t("auth.errors.createFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity accessibilityLabel={t("common.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
            <ChevronLeft accessibilityElementsHidden importantForAccessibility="no-hide-descendants" size={24} color={Colors.textHeading} />
          </TouchableOpacity>
          <Text style={styles.title}>{t("auth.createAccount")}</Text>
          <View style={styles.row}>
            <TextInput style={[styles.input, styles.half]} placeholder={t("auth.firstName")} value={firstName} onChangeText={setFirstName} />
            <TextInput style={[styles.input, styles.half]} placeholder={t("auth.lastName")} value={lastName} onChangeText={setLastName} />
          </View>
          <TextInput style={styles.input} placeholder={t("auth.email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <PasswordInput
            autoCapitalize="none"
            autoComplete="new-password"
            containerStyle={styles.input}
            onChangeText={setPassword}
            placeholder={t("auth.password")}
            textContentType="newPassword"
            value={password}
          />
          <TextInput style={styles.input} placeholder={t("auth.zipCode")} value={zipCode} onChangeText={setZipCode} keyboardType="number-pad" />
          <TextInput style={styles.input} placeholder={t("auth.selectSportOptional")} value={sport} onChangeText={setSport} />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.button} onPress={handleCreate} disabled={loading}>
            {loading ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.buttonText}>{t("auth.createAccountButton")}</Text>}
          </TouchableOpacity>
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", padding: Spacing.lg, gap: Spacing.md },
  backButton: { position: "absolute", top: Spacing.lg, left: Spacing.lg, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: Typography.heading, fontSize: 32, color: Colors.textHeading, textAlign: "center" },
  row: { flexDirection: "row", gap: Spacing.sm },
  half: { flex: 1 },
  input: { height: 52, borderWidth: 1, borderColor: Colors.secondary, borderRadius: Radius.button, paddingHorizontal: Spacing.md, backgroundColor: Colors.surface, fontFamily: Typography.bodyRegular, ...Shadow.card },
  button: { height: 52, borderRadius: Radius.button, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  buttonText: { fontFamily: Typography.bodySemiBold, color: Colors.surface, fontSize: 16 },
  error: { fontFamily: Typography.bodyRegular, color: Colors.primary, textAlign: "center" },
});
