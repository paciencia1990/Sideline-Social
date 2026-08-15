import { Check } from "lucide-react-native";
import { router } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Spacing, Typography } from "@/constants/theme";

export function LegalAssentControls({
  adultConfirmed,
  onAdultConfirmedChange,
  onPoliciesAcceptedChange,
  policiesAccepted,
}: {
  adultConfirmed: boolean;
  onAdultConfirmedChange: (value: boolean) => void;
  onPoliciesAcceptedChange: (value: boolean) => void;
  policiesAccepted: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <AssentCheckbox
        checked={policiesAccepted}
        label={t("auth.legalAcceptance")}
        onChange={onPoliciesAcceptedChange}
      />
      <TouchableOpacity
        accessibilityHint={t("auth.reviewPoliciesHint")}
        accessibilityRole="link"
        onPress={() => router.push("/settings/legal" as never)}
        style={styles.reviewLink}
      >
        <Text style={styles.reviewLinkText}>{t("auth.reviewPolicies")}</Text>
      </TouchableOpacity>
      <AssentCheckbox
        checked={adultConfirmed}
        label={t("auth.adultEligibility")}
        onChange={onAdultConfirmedChange}
      />
    </View>
  );
}

function AssentCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      activeOpacity={0.8}
      onPress={() => onChange(!checked)}
      style={styles.row}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <Check color="#FFFFFF" size={16} strokeWidth={3} /> : null}
      </View>
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  checkbox: {
    alignItems: "center",
    borderColor: Colors.textHeading,
    borderRadius: 5,
    borderWidth: 2,
    flexShrink: 0,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  checkboxChecked: { backgroundColor: Colors.accentGreen, borderColor: Colors.accentGreen },
  container: { gap: Spacing.sm },
  label: { color: Colors.textPrimary, flex: 1, fontFamily: Typography.bodyRegular, lineHeight: 21, minWidth: 0 },
  reviewLink: { alignSelf: "flex-start", borderRadius: Radius.sm, minHeight: 44, justifyContent: "center", paddingHorizontal: Spacing.xs },
  reviewLinkText: { color: Colors.communicationLink, fontFamily: Typography.bodySemiBold, textDecorationLine: "underline" },
  row: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.sm, minHeight: 48, paddingVertical: Spacing.xs },
});

