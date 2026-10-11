import React, { useEffect, useRef, useState } from "react";
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
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { SquadSportPicker } from "@/components/SquadSportPicker";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useSquad } from "@/context/SquadContext";
import { type SquadSportId } from "@/constants/sports";
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
  const { user } = useAuth();
  const [sportIds, setSportIds] = useState<SquadSportId[]>([]);
  const pending = useRef(false);
  const request = useRef(0);
  const currentIdentity = useRef(user?.uid);
  currentIdentity.current = user?.uid;
  const [venueName, setVenueName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    request.current += 1;
    pending.current = false;
    setError('');
    setLoading(false);
    return () => { request.current += 1; };
  }, [isOpen, user?.uid]);

  const isCurrent = (id: number) => request.current === id && currentIdentity.current === user?.uid && isOpen;
  const finishJoin = async (squadId: string, id: number) => {
    if (!isCurrent(id)) return;
    pending.current = true;
    setLoading(true);
    setError('');
    try {
      await joinSquad(squadId);
      if (!isCurrent(id)) return;
      setVenueName('');
      setSportIds([]);
      onClose();
      onSquadCreated(squadId);
    } catch (nextError) {
      if (isCurrent(id)) { logCreateDiagnostic('join', nextError); setError(t('squad.errorJoining')); }
    } finally {
      if (isCurrent(id)) { pending.current = false; setLoading(false); }
    }
  };

  const handleCreate = async () => {
    if (pending.current || !isOpen || !user?.uid) return;
    setError('');
    if (!userCoords) { setError(t('squad.locationRequired')); return; }
    if (!venueName.trim()) { setError(t('squad.invalidVenue')); return; }
    if (!sportIds.length) { setError(t('squadSports.required')); return; }
    pending.current = true;
    const id = ++request.current;
    setLoading(true);
    try {
      const result = await createSquad({ venueName: venueName.trim(), sportIds, venueLocation: userCoords });
      if (!isCurrent(id)) return;
      if (result.status === 'existing') {
        pending.current = false;
        setLoading(false);
        Alert.alert(t('squad.alreadyExists'), t('squadSports.existingBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('squad.joinThisSquad'), onPress: () => { if (!pending.current && isCurrent(id)) void finishJoin(result.squadId, id); } },
        ]);
      } else await finishJoin(result.squadId, id);
    } catch (nextError) {
      if (!isCurrent(id)) return;
      logCreateDiagnostic('find-or-create', nextError);
      const details = nextError && typeof nextError === 'object' && 'details' in nextError ? nextError.details as { reason?: string } : null;
      setError(t(details?.reason === 'duplicate-candidates' ? 'squadSports.duplicates' : 'squad.errorCreating'));
      pending.current = false;
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
              editable={!loading}
              onChangeText={setVenueName}
              placeholder={t("squad.venuePlaceholder")}
              style={styles.input}
              value={venueName}
            />

            <Text style={styles.label}>{t('squadSports.select')}</Text>
            <Text style={styles.locationNote}>{t('squadSports.help')}</Text>
            <SquadSportPicker disabled={loading} selected={sportIds} onChange={setSportIds} />

            <Text accessibilityLiveRegion="polite" style={styles.locationNote}>
              {userCoords ? t("squad.venueUsesLocation") : t("squad.locationRequired")}
            </Text>
            {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
            <PrimaryButton
              disabled={loading || !userCoords || !venueName.trim() || !sportIds.length}
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
  locationNote: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 18 },
  error: { color: Colors.primary, fontFamily: Typography.bodyRegular, textAlign: "center" },
});
