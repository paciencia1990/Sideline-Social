import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { getSquadSportTranslationKey, type SquadSportId } from "@/constants/sports";
import { Colors, Spacing, Typography } from "@/constants/theme";

type SquadIdentityProps = {
  venueName: string;
  sportId: SquadSportId;
  sportDisplayName: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function SquadIdentity({ venueName, sportId, sportDisplayName, compact, style }: SquadIdentityProps) {
  const { t } = useTranslation();
  const sportName = t(getSquadSportTranslationKey(sportId), { defaultValue: sportDisplayName });

  return (
    <View
      accessible
      accessibilityLabel={`${venueName}. ${sportName}.`}
      style={[styles.container, style]}
    >
      <Text style={[styles.venueName, compact && styles.compactVenue]}>{venueName}</Text>
      <Text style={[styles.sportName, compact && styles.compactSport]}>{sportName}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexShrink: 1, gap: Spacing.xs },
  venueName: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    lineHeight: 21,
    flexShrink: 1,
  },
  sportName: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
  },
  compactVenue: { fontSize: 14, lineHeight: 19 },
  compactSport: { fontSize: 12, lineHeight: 17 },
});
