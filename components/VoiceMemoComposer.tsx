import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Mic, RotateCcw, Trash2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { VoiceMemoPlayer } from "@/components/VoiceMemoPlayer";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { isTeamVoiceAudioAvailable } from "@/services/teamVoiceAudioCapability";
import { deleteLocalVoiceMemo, getLocalVoiceMemoSize } from "@/services/voiceMemoFileService";
import { ensureVoiceRecordingPermissionDetails } from "@/services/voiceMemoPermissionService";
import { stopVoicePlayback } from "@/services/voiceMemoAudioService";
import {
  createVoiceRecorderDiagnostic,
  finalizeVoiceRecorder,
  prepareAndStartVoiceRecorder,
  resetPreparedVoiceRecorder,
  VoiceRecorderLifecycleError,
  type VoiceRecorderFailureStage,
} from "@/services/voiceMemoRecorderService";
import type { LocalVoiceMemoDraft } from "@/types/teamVoiceMessaging";

const MAX_DURATION_MS = 90_000;
const MAX_SIZE_BYTES = 2 * 1024 * 1024;

type Props = {
  active?: boolean;
  autoStartKey?: number | string | null;
  disabled?: boolean;
  maxDurationMilliseconds?: number;
  maxSizeBytes?: number;
  onChange: (draft: LocalVoiceMemoDraft | null) => void;
  uploadProgress?: number | null;
};

type ExpoAudioModule = typeof import("expo-audio");

const VOICE_RECORDING_OPTIONS: import("expo-audio").RecordingOptions = {
  extension: ".m4a",
  sampleRate: 44_100,
  numberOfChannels: 1,
  bitRate: 64_000,
  android: {
    extension: ".m4a",
    outputFormat: "mpeg4",
    audioEncoder: "aac",
    sampleRate: 44_100,
  },
  ios: {
    extension: ".m4a",
    outputFormat: "aac ",
    audioQuality: 64,
    sampleRate: 44_100,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: "audio/mp4", bitsPerSecond: 64_000 },
};

export function VoiceMemoComposer(props: Props) {
  const { t } = useTranslation();
  const audioAvailable = isTeamVoiceAudioAvailable();
  const [audioModule, setAudioModule] = useState<ExpoAudioModule | null>(null);
  const [audioLoadFailed, setAudioLoadFailed] = useState(false);

  useEffect(() => {
    if (!audioAvailable) return;
    let mounted = true;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Deferred loading protects older native clients without expo-audio.
    Promise.resolve().then(() => require("expo-audio") as ExpoAudioModule).then((module) => {
      if (!mounted) return;
      const recorderApiAvailable =
        typeof module.useAudioRecorder === "function" &&
        typeof module.setAudioModeAsync === "function";
      if (!recorderApiAvailable) {
        logVoiceRecorderFailure(createVoiceRecorderDiagnostic({
          platform: Platform.OS,
          permissionGranted: false,
          canAskAgain: false,
          audioPackageLoaded: true,
          recorderApiAvailable: false,
          audioModeConfigured: false,
          recorderCreated: false,
          recorderPrepared: false,
          failureStage: "load-package",
        }));
        setAudioLoadFailed(true);
        return;
      }
      setAudioModule(module);
      setAudioLoadFailed(false);
    }).catch((error) => {
      if (!mounted) return;
      logVoiceRecorderFailure(createVoiceRecorderDiagnostic({
        platform: Platform.OS,
        permissionGranted: false,
        canAskAgain: false,
        audioPackageLoaded: false,
        recorderApiAvailable: false,
        audioModeConfigured: false,
        recorderCreated: false,
        recorderPrepared: false,
        failureStage: "load-package",
      }, error));
      setAudioModule(null);
      setAudioLoadFailed(true);
    });
    return () => { mounted = false; };
  }, [audioAvailable]);

  if (!audioAvailable) {
    return <Text accessibilityLiveRegion="polite" style={styles.help}>{t("voiceMemo.updatedBuildRequired")}</Text>;
  }
  if (audioLoadFailed) {
    return <Text accessibilityLiveRegion="polite" style={styles.error}>{t("voiceMemo.startRecordingError")}</Text>;
  }
  if (!audioModule) {
    return <ActivityIndicator accessibilityLabel={t("common.loading")} color={Colors.primary} size="small" />;
  }
  return (
    <VoiceRecorderCreationBoundary fallback={t("voiceMemo.startRecordingError")}>
      <VoiceMemoComposerAvailable {...props} audioModule={audioModule} />
    </VoiceRecorderCreationBoundary>
  );
}

class VoiceRecorderCreationBoundary extends React.Component<
  React.PropsWithChildren<{ fallback: string }>,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    logVoiceRecorderFailure(createVoiceRecorderDiagnostic({
      platform: Platform.OS,
      permissionGranted: false,
      canAskAgain: false,
      audioPackageLoaded: true,
      recorderApiAvailable: true,
      audioModeConfigured: false,
      recorderCreated: false,
      recorderPrepared: false,
      failureStage: "create-recorder",
    }, error));
  }

  render() {
    if (this.state.failed) {
      return <Text accessibilityLiveRegion="polite" style={styles.error}>{this.props.fallback}</Text>;
    }
    return this.props.children;
  }
}

function VoiceMemoComposerAvailable({
  audioModule,
  active = true,
  autoStartKey = null,
  disabled = false,
  maxDurationMilliseconds = MAX_DURATION_MS,
  maxSizeBytes = MAX_SIZE_BYTES,
  onChange,
  uploadProgress,
}: Props & { audioModule: ExpoAudioModule }) {
  const { t } = useTranslation();
  const recorder = audioModule.useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recordingRef = useRef<typeof recorder | null>(null);
  const draftRef = useRef<LocalVoiceMemoDraft | null>(null);
  const lastAutoStartKeyRef = useRef<Props["autoStartKey"]>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const operationInFlightRef = useRef(false);
  const stopInFlightRef = useRef(false);
  const startedAt = useRef(0);
  const [draft, setDraft] = useState<LocalVoiceMemoDraft | null>(null);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const restorePlaybackAudioMode = useCallback(async () => {
    try {
      await audioModule.setAudioModeAsync({
        allowsRecording: false,
        allowsBackgroundRecording: false,
        interruptionMode: "duckOthers",
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
    } catch (restoreError) {
      logVoiceRecorderFailure(createVoiceRecorderDiagnostic({
        platform: Platform.OS,
        permissionGranted: true,
        canAskAgain: true,
        audioPackageLoaded: true,
        recorderApiAvailable: true,
        audioModeConfigured: false,
        recorderCreated: true,
        recorderPrepared: false,
        failureStage: "configure-audio-mode",
      }, restoreError));
    }
  }, [audioModule]);

  const finishRecording = useCallback(async () => {
    const activeRecorder = recordingRef.current;
    if (!activeRecorder || stopInFlightRef.current) return;
    stopInFlightRef.current = true;
    operationInFlightRef.current = true;
    clearTimer();
    setRecording(false);
    try {
      const finalized = await finalizeVoiceRecorder(
        activeRecorder,
        Date.now() - startedAt.current,
      );
      const { durationMilliseconds, uri } = finalized;
      if (durationMilliseconds < 500) {
        await deleteLocalVoiceMemo(uri);
        throw new VoiceRecorderLifecycleError("stop-recorder", new Error("Recording was too short."));
      }
      const sizeBytes = await getLocalVoiceMemoSize(uri);
      if (sizeBytes < 1 || sizeBytes > maxSizeBytes) {
        await deleteLocalVoiceMemo(uri);
        throw new Error("voice_file_too_large");
      }
      const next: LocalVoiceMemoDraft = {
        uri,
        durationMilliseconds: Math.min(durationMilliseconds, maxDurationMilliseconds),
        sizeBytes,
        mimeType: "audio/mp4",
        previewed: false,
      };
      setDraft(next);
      draftRef.current = next;
      onChange(next);
    } catch (nextError) {
      const failureStage = getVoiceRecorderFailureStage(nextError, "stop-recorder");
      logVoiceRecorderFailure(createVoiceRecorderDiagnostic({
        platform: Platform.OS,
        permissionGranted: true,
        canAskAgain: true,
        audioPackageLoaded: true,
        recorderApiAvailable: true,
        audioModeConfigured: true,
        recorderCreated: true,
        recorderPrepared: true,
        failureStage,
      }, nextError));
      setError(
        getErrorCode(nextError).includes("large")
          ? t("voiceMemo.fileTooLarge")
          : t("voiceMemo.saveRecordingError"),
      );
    } finally {
      recordingRef.current = null;
      stopInFlightRef.current = false;
      operationInFlightRef.current = false;
      await restorePlaybackAudioMode();
    }
  }, [clearTimer, maxDurationMilliseconds, maxSizeBytes, onChange, restorePlaybackAudioMode, t]);

  const startRecording = useCallback(async () => {
    if (!active || disabled || recordingRef.current || operationInFlightRef.current) return;
    operationInFlightRef.current = true;
    setStarting(true);
    setError(null);
    let permissionGranted = false;
    let canAskAgain = false;
    let audioModeConfigured = false;
    let recorderPrepared = false;
    try {
      await stopVoicePlayback();
      const permission = await ensureVoiceRecordingPermissionDetails(audioModule);
      permissionGranted = permission.permissionGranted;
      canAskAgain = permission.canAskAgain;
      if (permission.outcome === "settings") {
        Alert.alert(
          t("voiceMemo.permissionRequiredTitle"),
          t("voiceMemo.permissionRequiredBody"),
          [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("voiceMemo.openSettings"),
              onPress: () => {
                void Linking.openSettings().catch(() => setError(t("voiceMemo.permissionProblem")));
              },
            },
          ],
        );
        setError(t("voiceMemo.permissionProblem"));
        return;
      }
      if (permission.outcome !== "granted") {
        logVoiceRecorderFailure(createVoiceRecorderDiagnostic({
          platform: Platform.OS,
          permissionGranted,
          canAskAgain,
          audioPackageLoaded: true,
          recorderApiAvailable: true,
          audioModeConfigured: false,
          recorderCreated: true,
          recorderPrepared: false,
          failureStage: "permission",
        }));
        setError(t("voiceMemo.permissionProblem"));
        return;
      }
      await prepareAndStartVoiceRecorder({
        recorder,
        configureAudioMode: async () => {
          await audioModule.setAudioModeAsync({
            allowsRecording: true,
            allowsBackgroundRecording: false,
            interruptionMode: "doNotMix",
            playsInSilentMode: true,
            shouldPlayInBackground: false,
            shouldRouteThroughEarpiece: false,
          });
          audioModeConfigured = true;
        },
      });
      recorderPrepared = true;
      recordingRef.current = recorder;
      startedAt.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        const nextElapsed = Date.now() - startedAt.current;
        setElapsed(nextElapsed);
        if (nextElapsed >= maxDurationMilliseconds && !stopInFlightRef.current) {
          setError(t("voiceMemo.limitReached", { seconds: Math.floor(maxDurationMilliseconds / 1000) }));
          void finishRecording();
        }
      }, 250);
    } catch (nextError) {
      try {
        recorderPrepared = recorder.getStatus().canRecord;
      } catch {
        recorderPrepared = false;
      }
      const failureStage = getVoiceRecorderFailureStage(nextError, "unknown");
      logVoiceRecorderFailure(createVoiceRecorderDiagnostic({
        platform: Platform.OS,
        permissionGranted,
        canAskAgain,
        audioPackageLoaded: true,
        recorderApiAvailable: true,
        audioModeConfigured,
        recorderCreated: true,
        recorderPrepared,
        failureStage,
      }, nextError));
      await resetPreparedVoiceRecorder(recorder).catch(() => undefined);
      await restorePlaybackAudioMode();
      recordingRef.current = null;
      setRecording(false);
      setError(t("voiceMemo.startRecordingError"));
    } finally {
      operationInFlightRef.current = false;
      setStarting(false);
    }
  }, [active, audioModule, disabled, finishRecording, maxDurationMilliseconds, recorder, restorePlaybackAudioMode, t]);

  useEffect(() => {
    if (autoStartKey == null || lastAutoStartKeyRef.current === autoStartKey) return;
    lastAutoStartKeyRef.current = autoStartKey;
    if (!active || disabled || draftRef.current || recordingRef.current) return;
    void startRecording();
  }, [active, autoStartKey, disabled, startRecording]);

  const cancelRecording = useCallback(async () => {
    const activeRecorder = recordingRef.current;
    if (!activeRecorder || stopInFlightRef.current) return;
    stopInFlightRef.current = true;
    operationInFlightRef.current = true;
    clearTimer();
    setRecording(false);
    setError(null);
    try {
      await activeRecorder.stop();
      const uri = activeRecorder.uri?.trim();
      if (uri) await deleteLocalVoiceMemo(uri);
    } catch (nextError) {
      logVoiceRecorderFailure(createVoiceRecorderDiagnostic({
        platform: Platform.OS,
        permissionGranted: true,
        canAskAgain: true,
        audioPackageLoaded: true,
        recorderApiAvailable: true,
        audioModeConfigured: true,
        recorderCreated: true,
        recorderPrepared: true,
        failureStage: "stop-recorder",
      }, nextError));
    } finally {
      recordingRef.current = null;
      stopInFlightRef.current = false;
      operationInFlightRef.current = false;
      onChange(null);
      await restorePlaybackAudioMode();
    }
  }, [clearTimer, onChange, restorePlaybackAudioMode]);

  const removeDraft = useCallback(async () => {
    if (draft?.uri) await deleteLocalVoiceMemo(draft.uri);
    setDraft(null);
    draftRef.current = null;
    onChange(null);
  }, [draft, onChange]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && recordingRef.current) void cancelRecording();
    });
    return () => subscription.remove();
  }, [cancelRecording]);

  useEffect(() => {
    if (!active && recordingRef.current) void finishRecording();
  }, [active, finishRecording]);

  useEffect(() => () => {
    clearTimer();
    if (recordingRef.current) {
      const abandonedRecorder = recordingRef.current;
      recordingRef.current = null;
      void resetPreparedVoiceRecorder(abandonedRecorder)
        .then(async () => {
          const abandonedUri = abandonedRecorder.uri?.trim();
          if (abandonedUri) await deleteLocalVoiceMemo(abandonedUri);
        })
        .catch(() => undefined)
        .finally(restorePlaybackAudioMode);
    } else {
      void restorePlaybackAudioMode();
    }
    if (draftRef.current?.uri) void deleteLocalVoiceMemo(draftRef.current.uri);
  }, [clearTimer, restorePlaybackAudioMode]);

  return (
    <View style={styles.container}>
      <Text style={styles.help}>{t("voiceMemo.help", { seconds: Math.floor(maxDurationMilliseconds / 1000) })}</Text>
      {recording ? (
        <View accessibilityLabel={`${t("voiceMemo.recording")} ${formatTime(elapsed, maxDurationMilliseconds)}`} style={styles.recordingRow}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>{t("voiceMemo.recording")} {formatTime(elapsed, maxDurationMilliseconds)}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={finishRecording} style={styles.primaryButton}>
            <Text style={styles.primaryText}>{t("voiceMemo.stop")}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={cancelRecording} style={styles.outlineButton}>
            <Trash2 color={Colors.primary} size={17} />
            <Text style={styles.outlineText}>{t("common.cancel")}</Text>
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
            source={{ kind: "local-draft", uri: draft.uri }}
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
        <TouchableOpacity accessibilityLabel={t("voiceMemo.recordAccessibility")} accessibilityRole="button" disabled={disabled || !active || starting} onPress={startRecording} style={[styles.primaryButton, (disabled || !active || starting) && styles.disabled]}>
          {starting ? <ActivityIndicator color={Colors.surface} size="small" /> : <Mic color={Colors.surface} size={18} />}
          <Text style={styles.primaryText}>{t("voiceMemo.record")}</Text>
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

function formatTime(milliseconds: number, maxDurationMilliseconds = MAX_DURATION_MS) {
  const seconds = Math.min(Math.floor(maxDurationMilliseconds / 1000), Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function getErrorCode(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

function getVoiceRecorderFailureStage(
  error: unknown,
  fallback: VoiceRecorderFailureStage,
) {
  return error instanceof VoiceRecorderLifecycleError ? error.stage : fallback;
}

function logVoiceRecorderFailure(diagnostic: ReturnType<typeof createVoiceRecorderDiagnostic>) {
  if (__DEV__) console.warn("[VoiceMemoRecorder] lifecycle failure", diagnostic);
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
