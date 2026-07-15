import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SquadIdentity } from "@/components/SquadIdentity";
import { getSquadSportOption } from "@/constants/sports";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { type Squad, type SquadStatus, getSquadStatus } from "@/services/squadService";

const STATUS_COLORS: Record<SquadStatus, { bg: string; text: string }> = {
  active: { bg: Colors.accentGreen, text: "#FFFFFF" },
  starting_soon: { bg: Colors.accentGold, text: "#FFFFFF" },
  quiet: { bg: Colors.secondary, text: Colors.textHeading },
};

interface SquadCardProps {
  squad: Squad;
  isMember: boolean;
  isHighlighted?: boolean;
  onJoin: () => void;
  onPress: () => void;
  joining?: boolean;
}

export function SquadCard({ squad, isMember, isHighlighted, onJoin, onPress, joining }: SquadCardProps) {
  const { t } = useTranslation();
  const status = getSquadStatus(squad);
  const statusColor = STATUS_COLORS[status];
  const distance = squad.distanceMiles !== undefined
    ? t("squad.distance", { distance: squad.distanceMiles.toFixed(1) })
    : null;
  const statusLabel = status === "active"
    ? t("squad.activeNow")
    : status === "starting_soon"
      ? t("squad.startingSoon")
      : t("squad.quiet");

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[styles.card, isHighlighted && styles.highlighted]}>
      <View style={styles.emojiWrap}>
        <Text style={styles.emoji}>{getSquadSportOption(squad.sportId).emoji}</Text>
      </View>
      <View style={styles.info}>
        <SquadIdentity
          compact
          venueName={squad.venueName}
          sportId={squad.sportId}
          sportDisplayName={squad.sportDisplayName}
        />
        {distance ? <Text style={styles.meta}>{distance}</Text> : null}
        <View style={styles.row}>
          <Text style={styles.members}>{t("squad.memberCount", { count: squad.memberCount })}</Text>
          <View style={[styles.statusPill, { backgroundColor: statusColor.bg }]}>
            <Text style={[styles.statusText, { color: statusColor.text }]}>{statusLabel}</Text>
          </View>
        </View>
      </View>
      <View style={styles.actionWrap}>
        {isMember ? (
          <View style={styles.joinedPill}><Text style={styles.joinedText}>{t("squad.joinedPill")}</Text></View>
        ) : (
          <TouchableOpacity
            accessibilityLabel={`${t("squad.joinButton")} ${squad.venueName}`}
            activeOpacity={0.8}
            disabled={joining}
            onPress={(event) => { event.stopPropagation(); onJoin(); }}
            style={styles.joinButton}
          >
            {joining ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.joinText}>{t("squad.joinButton")}</Text>}
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: Radius.card, flexDirection: "row", gap: Spacing.sm, marginHorizontal: Spacing.md, marginVertical: Spacing.xs, padding: Spacing.md, ...Shadow.card },
  highlighted: { borderColor: Colors.primary, borderWidth: 2 },
  emojiWrap: { alignItems: "center", backgroundColor: Colors.background, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  emoji: { fontSize: 22 },
  info: { flex: 1, gap: 3, minWidth: 0 },
  meta: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  row: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: 2 },
  members: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 11 },
  statusPill: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  statusText: { fontFamily: Typography.bodyBold, fontSize: 9, letterSpacing: 0.5 },
  actionWrap: { alignItems: "center", justifyContent: "center" },
  joinButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, minWidth: 68, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs + 2 },
  joinText: { color: "#FFFFFF", fontFamily: Typography.bodySemiBold, fontSize: 13 },
  joinedPill: { alignItems: "center", backgroundColor: Colors.accentGreen, borderRadius: Radius.button, minWidth: 72, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs + 2 },
  joinedText: { color: "#FFFFFF", fontFamily: Typography.bodySemiBold, fontSize: 12 },
});
