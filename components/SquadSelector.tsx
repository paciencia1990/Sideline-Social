import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Check, ChevronDown, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { SquadIdentity } from "@/components/SquadIdentity";
import { useSquad } from "@/context/SquadContext";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";

export function SquadSelector() {
  const { t } = useTranslation();
  const { currentSquad, mySquads, selectSquad } = useSquad();
  const [open, setOpen] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  if (mySquads.length < 2 || !currentSquad) return null;

  const choose = async (squadId: string) => {
    if (squadId === currentSquad.squadId) {
      setOpen(false);
      return;
    }
    setSavingId(squadId);
    try {
      await selectSquad(squadId);
      setOpen(false);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <>
      <Pressable
        accessibilityLabel={t("squad.changeSquad")}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={styles.trigger}
      >
        <View style={styles.triggerCopy}>
          <Text style={styles.label}>{t("squad.currentSquad")}</Text>
          <SquadIdentity
            compact
            venueName={currentSquad.venueName}
            sportId={currentSquad.sportId}
            sportDisplayName={currentSquad.sportDisplayName}
          />
        </View>
        <ChevronDown color={Colors.textHeading} size={20} />
      </Pressable>

      <Modal animationType="slide" onRequestClose={() => setOpen(false)} transparent visible={open}>
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.header}>
              <View>
                <Text style={styles.title}>{t("squad.changeSquad")}</Text>
                <Text style={styles.subtitle}>{t("squad.selectSquadBody")}</Text>
              </View>
              <Pressable accessibilityLabel={t("common.close")} accessibilityRole="button" onPress={() => setOpen(false)} style={styles.close}>
                <X color={Colors.textHeading} size={20} />
              </Pressable>
            </View>
            {mySquads.map((squad) => {
              const selected = squad.squadId === currentSquad.squadId;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, busy: savingId === squad.squadId }}
                  key={squad.squadId}
                  onPress={() => void choose(squad.squadId)}
                  style={[styles.option, selected && styles.selectedOption]}
                >
                  <SquadIdentity
                    compact
                    style={styles.optionCopy}
                    venueName={squad.venueName}
                    sportId={squad.sportId}
                    sportDisplayName={squad.sportDisplayName}
                  />
                  {selected ? <Check color={Colors.accentGreen} size={21} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: Radius.card,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: Spacing.md,
    padding: Spacing.md,
  },
  triggerCopy: { flex: 1, gap: Spacing.xs },
  label: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 11, letterSpacing: 0.7, textTransform: "uppercase" },
  backdrop: { backgroundColor: "rgba(47,65,86,0.35)", flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card, gap: Spacing.sm, padding: Spacing.lg, ...Shadow.card },
  header: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", marginBottom: Spacing.sm },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 22 },
  subtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, marginTop: Spacing.xs },
  close: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  option: { alignItems: "center", borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", minHeight: 68, padding: Spacing.md },
  selectedOption: { backgroundColor: Colors.background, borderColor: Colors.accentGreen },
  optionCopy: { flex: 1 },
});
