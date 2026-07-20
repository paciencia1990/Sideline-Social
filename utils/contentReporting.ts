import { Alert } from "react-native";

import type { TeamContentReportReason } from "@/services/contentModerationService";

export function showContentReportPrompt(
  t: (key: string) => string,
  onSelect: (reason: TeamContentReportReason) => void,
) {
  const reasons: TeamContentReportReason[] = ["offensive", "harassment", "privacy", "spam", "other"];
  Alert.alert(
    t("moderation.reportTitle"),
    t("moderation.reportBody"),
    [
      ...reasons.map((reason) => ({
        text: t(`moderation.reasons.${reason}`),
        onPress: () => onSelect(reason),
      })),
      { text: t("common.cancel"), style: "cancel" as const },
    ],
  );
}
