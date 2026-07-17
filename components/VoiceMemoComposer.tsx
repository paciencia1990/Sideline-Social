import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Mic, RotateCcw, Trash2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { VoiceMemoPlayer } from "@/components/VoiceMemoPlayer";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { isTeamVoiceAudioAvailable } from "@/services/teamVoiceAudioCapability";
import { deleteLocalVoiceMemo, getLocalVoiceMemoSize } from "@/services/voiceMemoFileService";
import { ensureVoiceRecordingPermission } from "@/services/voiceMemoPermissionService";
import { stopVoicePlayback } from "@/services/voiceMemoAudioService";
import type { LocalVoiceMemoDraft } from "@/types/teamVoiceMessaging";

const MAX_DURATION_MS = 90_000;
const MAX_SIZE_BYTES = 2 * 1024 * 1024;

type Props = {
  active?: boolean;
  disabled?: boolean;
  onChange: (draft: LocalVoiceMemoDraft | null) => void;
  uploadProgress?: number | null;
};

type ExpoAvModule = typeof import("expo-av");

export function VoiceMemoComposer(props: Props) {
  const { t } = useTranslation();
  const audioAvailable = isTeamVoiceAudioAvailable();
  const [audioModule, setAudioModule] = useState<ExpoAvModule | null>(null);

  useEffect(() => {
    if (!audioAvailable) return;
    let mounted = true;
    Promise.resolve().then(() => require("expo-av") as ExpoAvModule).then((module) => {
      if (mounted) setAudioModule(module);
    }).catch(() => {
      if (mounted) setAudioModule(null);
    });
    return () => { mounted = false; };
  }, [audioAvailable]);

  if (!audioAvailable) {
    return <Text accessibilityLiveRegion="polite" style={styles.help}>{t("voiceMemo.updatedBuildRequired")}</Text>;
  }
  if (!audioModule) {
    return <ActivityIndicator accessibilityLabel={t("common.loading")} color={Colors.primary} size="small" />;
  }
  return <VoiceMemoComposerAvailable {...props} audioModule={audioModule} />;
}

function VoiceMemoComposerAvailable({ audioModule, active = true, disabled = false, onChange, uploadProgress }: Props & { audioModule: ExpoAvModule }) {
  const { t } = useTranslation();
  const { Audio, InterruptionModeAndroid, InterruptionModeIOS } = audioModule;
  const recordingRef = useRef<InstanceType<typeof Audio.Recording> | null>(null);
  const draftRef = useRef<LocalVoiceMemoDraft | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const permissionRequestInFlight = useRef(false);
  const startedAt = useRef(0);
  const [draft, setDraft] = useState<LocalVoiceMemoDraft | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const finishRecording = useCallback(async () => {
    const active = recordingRef.current;
    if (!active) return;
    recordingRef.current = null;
    clearTimer();
    setRecording(false);
    try {
      await active.stopAndUnloadAsync();
      const status = await active.getStatusAsync();
      const uri = active.getURI();
      if (!uri || !status.durationMillis || status.durationMillis < 500) throw new Error("recording_too_short");
      const sizeBytes = await getLocalVoiceMemoSize(uri);
      if (sizeBytes < 1 || sizeBytes > MAX_SIZE_BYTES) {
        await deleteLocalVoiceMemo(uri);
        throw new Error("voice_file_too_large");
      }
      const next: LocalVoiceMemoDraft = {
        uri,
        durationMilliseconds: Math.min(status.durationMillis, MAX_DURATION_MS),
        sizeBytes,
        mimeType: "audio/mp4",
        previewed: false,
      };
      setDraft(next);
      draftRef.current = next;
      onChange(next);
    } catch (nextError) {
      console.warn("[VoiceMemoComposer] finish error", getErrorCode(nextError));
      setError(getErrorCode(nextError).includes("large") ? t("voiceMemo.fileTooLarge") : t("voiceMemo.recordingError"));
    } finally {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    }
  }, [Audio, clearTimer, onChange, t]);

  const startRecording = useCallback(async () => {
    if (!active || disabled || recordingRef.current || permissionRequestInFlight.current) return;
    permissionRequestInFlight.current = true;
    setError(null);
    try {
      await stopVoicePlayback();
      const permission = await ensureVoiceRecordingPermission(Audio);
      if (permission === "settings") {
        Alert.alert(
          t("voiceMemo.permissionRequiredTitle"),
          t("voiceMemo.permissionRequiredBody"),
          [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("voiceMemo.openSettings"),
              onPress: () => {
                void Linking.openSettings().catch(() => setError(t("voiceMemo.permissionDenied")));
              },
            },
          ],
        );
        return;
      }
      if (permission !== "granted") {
        setError(t("voiceMemo.permissionDenied"));
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        shouldDuckAndroid: true,
      });
      const active = new Audio.Recording();
      await active.prepareToRecordAsync({
        android: {
          extension: ".m4a",
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 64000,
        },
        ios: {
          extension: ".m4a",
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.MEDIUM,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 64000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: { mimeType: "audio/mp4", bitsPerSecond: 64000 },
      });
      await active.startAsync();
      recordingRef.current = active;
      startedAt.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        const nextElapsed = Date.now() - startedAt.current;
        setElapsed(nextElapsed);
        if (nextElapsed >= MAX_DURATION_MS) void finishRecording();
      }, 250);
    } catch (nextError) {
      console.warn("[VoiceMemoComposer] start error", getErrorCode(nextError));
      setError(t("voiceMemo.recordingError"));
    } finally {
      permissionRequestInFlight.current = false;
    }
  }, [Audio, InterruptionModeAndroid.DoNotMix, InterruptionModeIOS.DoNotMix, active, disabled, finishRecording, t]);

  const removeDraft = useCallback(async () => {
    if (draft?.uri) await deleteLocalVoiceMemo(draft.uri);
    setDraft(null);
    draftRef.current = null;
    onChange(null);
  }, [draft, onChange]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && recordingRef.current) void finishRecording();
    });
    return () => subscription.remove();
  }, [finishRecording]);

  useEffect(() => {
    if (!active && recordingRef.current) void finishRecording();
  }, [active, finishRecording]);

  useEffect(() => () => {
    clearTimer();
    if (recordingRef.current) void recordingRef.current.stopAndUnloadAsync();
    if (draftRef.current?.uri) void deleteLocalVoiceMemo(draftRef.current.uri);
  }, [clearTimer]);

  return (
    <View style={styles.container}>
      <Text style={styles.help}>{t("voiceMemo.help", { seconds: 90 })}</Text>
      {recording ? (
        <View accessibilityLabel={`${t("voiceMemo.recording")} ${formatTime(elapsed)}`} style={styles.recordingRow}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>{t("voiceMemo.recording")} {formatTime(elapsed)}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={finishRecording} style={styles.primaryButton}>
            <Text style={styles.primaryText}>{t("voiceMemo.stop")}</Text>
          </TouchableOpacity>
        </View>
      ) : draft ? (
        <View style={styles.preview}>
          <VoiceMemoPlayer
            durationMilliseconds={draft.durationMilliseconds}
            onPreviewed={() => {
              if (draft.previewed) return;
              const next = { ...draft, previewed: true };
              setDraft(next);
              draftRef.current = next;
              onChange(next);
            }}
            uri={draft.uri}
          />
          <View style={styles.actionRow}>
            <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={() => { void removeDraft().then(startRecording); }} style={styles.outlineButton}>
              <RotateCcw color={Colors.primary} size={17} /><Text style={styles.outlineText}>{t("voiceMemo.recordAgain")}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={removeDraft} style={styles.outlineButton}>
              <Trash2 color={Colors.primary} size={17} /><Text style={styles.outlineText}>{t("voiceMemo.delete")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity accessibilityLabel={t("voiceMemo.recordAccessibility")} accessibilityRole="button" disabled={disabled || !active} onPress={startRecording} style={[styles.primaryButton, (disabled || !active) && styles.disabled]}>
          <Mic color={Colors.surface} size={18} /><Text style={styles.primaryText}>{t("voiceMemo.record")}</Text>
        </TouchableOpacity>
      )}
      {uploadProgress != null ? (
        <View accessibilityLiveRegion="polite" style={styles.uploadRow}>
          <ActivityIndicator color={Colors.primary} size="small" />
          <Text style={styles.help}>{t("voiceMemo.uploading", { percent: Math.round(uploadProgress * 100) })}</Text>
        </View>
      ) : null}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function formatTime(milliseconds: number) {
  const seconds = Math.min(90, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function getErrorCode(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  help: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 18 },
  primaryButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.md },
  primaryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold },
  disabled: { opacity: 0.5 },
  recordingRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  recordingDot: { backgroundColor: Colors.primary, borderRadius: 6, height: 12, width: 12 },
  recordingText: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodyBold },
  preview: { gap: Spacing.sm },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  outlineButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.xs, minHeight: 42, paddingHorizontal: Spacing.md },
  outlineText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  uploadRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
});
