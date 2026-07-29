import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";

import { Colors, Spacing, Typography } from "@/constants/theme";

export function SettingsBackButton() {
  const { t } = useTranslation();

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/profile");
  };

  return (
    <TouchableOpacity
      accessibilityLabel={t("common.back")}
      accessibilityRole="button"
      activeOpacity={0.75}
      onPress={goBack}
      style={styles.button}
    >
      <ArrowLeft accessibilityElementsHidden color={Colors.textHeading} importantForAccessibility="no-hide-descendants" size={22} />
      <Text style={styles.label}>{t("common.back")}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: Spacing.xs,
    minHeight: 44,
    paddingHorizontal: Spacing.xs,
  },
  label: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
  },
});
