import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { useAuth } from "@/context/AuthContext";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";

export default function EmailLoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSignIn = async () => {
    setError("");
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setLoading(true);
    try {
      await signIn(email, password);
      await AsyncStorage.setItem("onboardingComplete", "true");
      router.replace("/(tabs)");
    } catch (nextError) {
      console.warn("[EmailLogin] sign in error:", nextError);
      setError("Could not sign in with those credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenWrapper>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ChevronLeft size={24} color={Colors.textHeading} />
          </TouchableOpacity>
          <Text style={styles.title}>Sign in</Text>
          <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.button} onPress={handleSignIn} disabled={loading}>
            {loading ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.buttonText}>Sign in</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/(auth)/forgot-password")}>
            <Text style={styles.link}>Forgot password?</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", padding: Spacing.lg, gap: Spacing.md },
  backButton: { position: "absolute", top: Spacing.lg, left: Spacing.lg, width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: Typography.heading, fontSize: 32, color: Colors.textHeading, textAlign: "center" },
  input: { height: 52, borderWidth: 1, borderColor: Colors.secondary, borderRadius: Radius.button, paddingHorizontal: Spacing.md, backgroundColor: Colors.surface, fontFamily: Typography.bodyRegular, ...Shadow.card },
  button: { height: 52, borderRadius: Radius.button, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  buttonText: { fontFamily: Typography.bodySemiBold, color: Colors.surface, fontSize: 16 },
  error: { fontFamily: Typography.bodyRegular, color: Colors.primary, textAlign: "center" },
  link: { fontFamily: Typography.bodySemiBold, color: Colors.primary, textAlign: "center" },
});