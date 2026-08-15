import * as AppleAuthentication from "expo-apple-authentication";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { OutlineButton } from "@/components/OutlineButton";
import { Radius, Spacing } from "@/constants/theme";
import { useAuthProviderAvailability } from "@/hooks/useAuthProviderAvailability";
import type { FederatedAuthProvider } from "@/utils/federatedAuthCore";

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

  return (
    <View style={styles.container}>
      {showApple ? (
        <AppleAuthentication.AppleAuthenticationButton
          accessibilityLabel={t("auth.continueWithApple")}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          cornerRadius={Radius.button}
          onPress={() => {
            if (!disabled && loadingProvider === null) onProviderPress("apple");
          }}
          style={[styles.appleButton, (disabled || loadingProvider !== null) && styles.disabled]}
        />
      ) : null}
      {showGoogle ? (
        <OutlineButton
          disabled={disabled || loadingProvider !== null}
          loading={loadingProvider === "google"}
          onPress={() => onProviderPress("google")}
          title={t("auth.continueWithGoogle")}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  appleButton: { height: 48, width: "100%" },
  container: { gap: Spacing.md, width: "100%" },
  disabled: { opacity: 0.6 },
});
