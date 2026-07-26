import React, { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Check, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/PrimaryButton";
import { useSquad } from "@/context/SquadContext";
import { SQUAD_SPORTS, getSquadSportTranslationKey, type SquadSportId } from "@/constants/sports";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";

interface CreateSquadSheetProps {
  isOpen: boolean;
  onClose: () => void;
  userCoords: { latitude: number; longitude: number } | null;
  onSquadCreated: (squadId: string) => void;
}

export function CreateSquadSheet({ isOpen, onClose, userCoords, onSquadCreated }: CreateSquadSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { createSquad, joinSquad } = useSquad();
  const [sportId, setSportId] = useState<SquadSportId | null>(null);
  const [venueName, setVenueName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setError("");
      setLoading(false);
    }
  }, [isOpen]);

  const finishJoin = async (squadId: string) => {
    setLoading(true);
    setError("");
    try {
      await joinSquad(squadId);
      setVenueName("");
      setSportId(null);
      onClose();
      onSquadCreated(squadId);
    } catch (nextError) {
      logCreateDiagnostic("join", nextError);
      setError(t("squad.errorJoining"));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    setError("");
    if (!userCoords) {
      setError(t("squad.locationRequired"));
      return;
    }
    if (!venueName.trim()) {
      setError(t("squad.invalidVenue"));
      return;
    }
    if (!sportId) {
      setError(t("squad.sportRequired"));
      return;
    }

    setLoading(true);
    try {
      const result = await createSquad({
        venueName: venueName.trim(),
        sportId,
        venueLocation: userCoords,
      });
      if (result.status === "existing") {
        setLoading(false);
        const sportName = t(getSquadSportTranslationKey(sportId));
        Alert.alert(
          t("squad.alreadyExists"),
          `${venueName.trim()}\n${sportName}`,
          [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("squad.joinThisSquad"), onPress: () => void finishJoin(result.squadId) },
          ],
        );
        return;
      }
      await finishJoin(result.squadId);
    } catch (nextError) {
      logCreateDiagnostic("find-or-create", nextError);
      setError(t("squad.errorCreating"));
      setLoading(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={isOpen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.backdrop, { paddingBottom: insets.bottom }]}
      >
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{t("squad.createThisSquad")}</Text>
            <TouchableOpacity accessibilityLabel={t("common.close")} accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <X color={Colors.textHeading} size={20} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.form}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.label}>{t("squad.venue")}</Text>
            <TextInput
              accessibilityLabel={t("squad.venue")}
              autoCorrect={false}
              onChangeText={setVenueName}
              placeholder={t("squad.venuePlaceholder")}
              style={styles.input}
              value={venueName}
            />

            <Text style={styles.label}>{t("squad.selectSport")}</Text>
            <View accessibilityRole="radiogroup" style={styles.sportGrid}>
              {SQUAD_SPORTS.map((sport) => {
                const selected = sportId === sport.id;
                return (
                  <TouchableOpacity
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    activeOpacity={0.8}
                    key={sport.id}
                    onPress={() => setSportId(sport.id)}
                    style={[styles.sportOption, selected && styles.sportSelected]}
                  >
                    <Text style={styles.sportEmoji}>{sport.emoji}</Text>
                    <Text style={styles.sportText}>{t(getSquadSportTranslationKey(sport.id))}</Text>
                    {selected ? <Check color={Colors.accentGreen} size={16} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text accessibilityLiveRegion="polite" style={styles.locationNote}>
              {userCoords ? t("squad.venueUsesLocation") : t("squad.locationRequired")}
            </Text>
            {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
            <PrimaryButton
              disabled={!userCoords || !venueName.trim() || !sportId}
              loading={loading}
              onPress={() => void handleCreate()}
              title={t("squad.createThisSquad")}
            />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function logCreateDiagnostic(operation: string, error: unknown) {
  if (!__DEV__) return;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  console.info("[CreateSquad]", { operation, code });
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(47, 65, 86, 0.35)", flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card, maxHeight: "90%", padding: Spacing.lg, ...Shadow.card },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: Spacing.sm },
  title: { color: Colors.textHeading, flex: 1, fontFamily: Typography.heading, fontSize: 22 },
  closeButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  form: { gap: Spacing.sm, paddingBottom: Spacing.lg },
  label: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13, marginTop: Spacing.xs },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textPrimary, fontFamily: Typography.bodyRegular, minHeight: 48, paddingHorizontal: Spacing.md },
  sportGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  sportOption: { alignItems: "center", borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.xs, minHeight: 46, paddingHorizontal: Spacing.sm, width: "48%" },
  sportSelected: { backgroundColor: Colors.background, borderColor: Colors.accentGreen },
  sportEmoji: { fontSize: 17 },
  sportText: { color: Colors.textHeading, flex: 1, flexShrink: 1, fontFamily: Typography.bodyMedium, fontSize: 12 },
  locationNote: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 18 },
  error: { color: Colors.primary, fontFamily: Typography.bodyRegular, textAlign: "center" },
});
