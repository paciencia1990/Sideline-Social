import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuthProviderAvailability } from "@/hooks/useAuthProviderAvailability";
import type { FederatedAuthProvider } from "@/utils/federatedAuthCore";

const googleButtonAsset = require("../assets/auth/google-sign-in-light.png");
const appleButtonAsset = require("../assets/auth/apple-sign-in-black.png");

type FederatedAuthButtonsProps = {
  disabled?: boolean;
  loadingProvider: FederatedAuthProvider | null;
  onProviderPress: (provider: FederatedAuthProvider) => void;
};

export function FederatedAuthButtons({
  disabled = false,
  loadingProvider,
  onProviderPress,
}: FederatedAuthButtonsProps) {
  const { t } = useTranslation();
  const { showApple, showGoogle } = useAuthProviderAvailability();

  if (!showApple && !showGoogle) return null;

  const busy = disabled || loadingProvider !== null;

  return (
    <View style={styles.container}>
      <View accessible={false} style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>{t("auth.orContinueWith")}</Text>
        <View style={styles.dividerLine} />
      </View>
      <View style={styles.providerRow}>
        {showGoogle ? (
          <ProviderIconButton
            accessibilityHint={t("auth.continueWithGoogleHint")}
            accessibilityLabel={t("auth.continueWithGoogle")}
            disabled={busy}
            loading={loadingProvider === "google"}
            onPress={() => onProviderPress("google")}
            source={googleButtonAsset}
          />
        ) : null}
        {showApple ? (
          <ProviderIconButton
            accessibilityHint={t("auth.continueWithAppleHint")}
            accessibilityLabel={t("auth.continueWithApple")}
            disabled={busy}
            loading={loadingProvider === "apple"}
            onPress={() => onProviderPress("apple")}
            source={appleButtonAsset}
          />
        ) : null}
      </View>
    </View>
  );
}

function ProviderIconButton({
  accessibilityHint,
  accessibilityLabel,
  disabled,
  loading,
  onPress,
  source,
}: {
  accessibilityHint: string;
  accessibilityLabel: string;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
  source: number;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.providerButton,
        pressed && !disabled && styles.providerButtonPressed,
        disabled && styles.disabled,
      ]}
    >
      <Image accessibilityIgnoresInvertColors source={source} style={styles.providerImage} />
      {loading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={Colors.textHeading} size="small" />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: Spacing.md, width: "100%" },
  disabled: { opacity: 0.55 },
  dividerLine: { backgroundColor: Colors.secondary, flex: 1, height: StyleSheet.hairlineWidth },
  dividerRow: { alignItems: "center", alignSelf: "stretch", flexDirection: "row", gap: Spacing.sm },
  dividerText: { color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 12, textAlign: "center" },
  loadingOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(253,250,246,0.9)",
    borderRadius: Radius.button,
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  providerButton: {
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    height: 48,
    overflow: "hidden",
    width: 48,
  },
  providerButtonPressed: { opacity: 0.78 },
  providerImage: { height: 48, resizeMode: "contain", width: 48 },
  providerRow: { alignItems: "center", flexDirection: "row", gap: Spacing.md, justifyContent: "center", minHeight: 48 },
});
