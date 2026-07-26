import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Pause, Play } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { auth } from "@/config/firebase";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { getVoiceMemoDownloadUrl } from "@/services/teamPrivateMessageService";
import { isTeamVoiceAudioAvailable } from "@/services/teamVoiceAudioCapability";
import { activateVoicePlayback, releaseVoicePlayback } from "@/services/voiceMemoAudioService";
import {
  invalidateVoicePlaybackSource,
  playVoiceSourceWithOneRefresh,
  probeVoicePlaybackUrl,
  setVoicePlaybackAuthorizationContext,
  voicePlaybackSourceIdentity,
  type VoicePlaybackFailureStage,
  type VoicePlaybackSource,
} from "@/utils/voicePlaybackCore";

type Props = {
  durationMilliseconds: number;
  isOwnMessage?: boolean;
  onPreviewed?: () => void;
  source: VoicePlaybackSource;
};

type ExpoAudioModule = typeof import("expo-audio");

export function VoiceMemoPlayer(props: Props) {
  const { t } = useTranslation();
  const audioAvailable = isTeamVoiceAudioAvailable();
  const [audioModule, setAudioModule] = useState<ExpoAudioModule | null>(null);

  useEffect(() => {
    if (!audioAvailable) return;
    let mounted = true;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Deferred loading protects older native clients without expo-audio.
    Promise.resolve().then(() => require("expo-audio") as ExpoAudioModule).then((module) => {
      if (mounted) setAudioModule(module);
    }).catch(() => {
      if (mounted) setAudioModule(null);
    });
    return () => { mounted = false; };
  }, [audioAvailable]);

  if (!audioAvailable) return <VoiceMemoUnavailable text={t("voiceMemo.updatedBuildRequired")} />;
  if (!audioModule) {
    return (
      <View style={styles.moduleLoading}>
        <ActivityIndicator accessibilityLabel={t("voiceMemo.loading")} color={Colors.primary} size="small" />
        <Text style={styles.status}>{t("voiceMemo.loading")}</Text>
      </View>
    );
  }
  return <VoiceMemoPlayerAvailable {...props} audioModule={audioModule} />;
}

export function VoiceMemoUnavailable({ text }: { text?: string }) {
  const { t } = useTranslation();
  return (
    <Text accessibilityLiveRegion="polite" style={styles.unavailable}>
      {text ?? t("voiceMemo.playbackUnavailable")}
    </Text>
  );
}

function VoiceMemoPlayerAvailable({
  audioModule,
  durationMilliseconds,
  isOwnMessage = false,
  onPreviewed,
  source: inputSource,
}: Props & { audioModule: ExpoAudioModule }) {
  const { t } = useTranslation();
  const sourceKind = inputSource.kind;
  const localUri = inputSource.kind === "local-draft" ? inputSource.uri : "";
  const messageId = inputSource.kind === "persisted-message" ? inputSource.messageId : "";
  const messageKind = inputSource.kind === "persisted-message" ? inputSource.messageKind : "privateMessage";
  const storagePath = inputSource.kind === "persisted-message" ? inputSource.storagePath : "";
  const source = useMemo<VoicePlaybackSource>(() => sourceKind === "local-draft"
    ? { kind: "local-draft", uri: localUri }
    : {
      kind: "persisted-message",
      messageId,
      messageKind,
      storagePath,
    }, [
    localUri,
    messageId,
    messageKind,
    sourceKind,
    storagePath,
  ]);
  const playerRef = useRef<import("expo-audio").AudioPlayer | null>(null);
  const statusSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const cancelPendingLoadRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);
  const readyRef = useRef(false);
  const operationInFlightRef = useRef(false);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const disposePlayer = useCallback(async () => {
    cancelPendingLoadRef.current?.();
    cancelPendingLoadRef.current = null;
    const player = playerRef.current;
    playerRef.current = null;
    readyRef.current = false;
    statusSubscriptionRef.current?.remove();
    statusSubscriptionRef.current = null;
    if (player) {
      try { player.pause(); } catch {}
      try { player.remove(); } catch {}
    }
  }, []);

  const stop = useCallback(async () => {
    generationRef.current += 1;
    await disposePlayer();
    setPlaying(false);
    setPosition(0);
    releaseVoicePlayback(stop);
  }, [disposePlayer]);

  useFocusEffect(useCallback(() => () => { void stop(); }, [stop]));
  useEffect(() => {
    setError(false);
    setPosition(0);
    invalidateVoicePlaybackSource(source);
    void stop();
    return () => {
      invalidateVoicePlaybackSource(source);
      void stop();
    };
  }, [source, stop]);

  const onStatus = useCallback((
    status: import("expo-audio").AudioStatus,
    player: import("expo-audio").AudioPlayer,
    generation: number,
  ) => {
    if (playerRef.current !== player || generationRef.current !== generation) return;
    if (status.error) {
      if (readyRef.current) {
        invalidateVoicePlaybackSource(source);
        logPlaybackResult({
          durationMilliseconds,
          failureStage: "player-play",
          isOwnMessage,
          playerReady: true,
          playerReportedError: true,
          playerReportedLoaded: true,
          playerSourceAssigned: true,
          playCalled: true,
          playbackUrlRequested: source.kind === "persisted-message",
          playbackUrlHasExpiration: source.kind === "persisted-message",
          playbackUrlReceived: source.kind === "persisted-message",
          remoteResponseAccepted: source.kind === "persisted-message",
          replaceCalled: true,
          source,
        }, status.error);
        setError(true);
        void stop();
      }
      return;
    }
    if (!status.isLoaded) return;
    setPosition(status.currentTime * 1000);
    setPlaying(status.playing);
    if (status.didJustFinish) {
      onPreviewed?.();
      void stop();
    }
  }, [durationMilliseconds, isOwnMessage, onPreviewed, source, stop]);

  const createReadyPlayer = useCallback(async (
    playbackUri: string,
    diagnostics: VoicePlaybackDiagnostics,
    generation: number,
  ) => {
    diagnostics.failureStage = "player-create";
    await audioModule.setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: "duckOthers",
      playsInSilentMode: true,
    });
    const player = audioModule.createAudioPlayer(null, { updateInterval: 250 });
    if (generationRef.current !== generation) {
      player.remove();
      throw new Error("voice_playback_superseded");
    }
    playerRef.current = player;
    diagnostics.failureStage = "player-replace";

    let settleReady: (() => void) | null = null;
    let settleError: ((error: Error) => void) | null = null;
    let settled = false;
    const ready = new Promise<void>((resolve, reject) => {
      settleReady = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      settleError = (nextError) => {
        if (settled) return;
        settled = true;
        reject(nextError);
      };
    });
    const cancelLoad = () => settleError?.(new Error("voice_playback_superseded"));
    cancelPendingLoadRef.current = cancelLoad;
    const handleStatus = (status: import("expo-audio").AudioStatus) => {
      if (playerRef.current !== player || generationRef.current !== generation) return;
      onStatus(status, player, generation);
      if (status.error) {
        diagnostics.playerReportedError = true;
        diagnostics.failureStage = "player-load-error";
        settleError?.(new Error("voice_player_load_failed"));
      }
      else if (status.isLoaded) settleReady?.();
    };
    statusSubscriptionRef.current = player.addListener("playbackStatusUpdate", handleStatus);
    diagnostics.replaceCalled = true;
    player.replace({ uri: playbackUri });
    diagnostics.playerSourceAssigned = true;
    diagnostics.failureStage = "player-load-timeout";
    handleStatus(player.currentStatus);
    const timeout = setTimeout(() => settleError?.(new Error("voice_player_load_timeout")), 30_000);
    try {
      await ready;
    } finally {
      clearTimeout(timeout);
      if (cancelPendingLoadRef.current === cancelLoad) cancelPendingLoadRef.current = null;
    }

    if (playerRef.current !== player || generationRef.current !== generation) {
      throw new Error("voice_playback_superseded");
    }
    diagnostics.playerReady = true;
    diagnostics.playerReportedLoaded = true;
    diagnostics.failureStage = "player-play";
    readyRef.current = true;
    player.play();
    diagnostics.playCalled = true;
    diagnostics.failureStage = undefined;
  }, [audioModule, onStatus]);

  const toggle = useCallback(async () => {
    if (loading || operationInFlightRef.current) return;
    setError(false);
    if (playerRef.current && playing) {
      playerRef.current.pause();
      return;
    }
    operationInFlightRef.current = true;
    if (playerRef.current && readyRef.current) {
      try {
        if (position >= durationMilliseconds - 100) await playerRef.current.seekTo(0);
        playerRef.current.play();
        operationInFlightRef.current = false;
        return;
      } catch {
        await disposePlayer();
      }
    }

    const diagnostics: VoicePlaybackDiagnostics = {
      failureStage: source.kind === "persisted-message" ? "request-playback-url" : "player-create",
      isOwnMessage,
      playerReady: false,
      playerReportedError: false,
      playerReportedLoaded: false,
      playerSourceAssigned: false,
      playCalled: false,
      playbackUrlHasExpiration: false,
      playbackUrlReceived: false,
      playbackUrlRequested: false,
      remoteResponseAccepted: false,
      replaceCalled: false,
    };
    try {
      setLoading(true);
      setVoicePlaybackAuthorizationContext(auth.currentUser?.uid ?? null);
      await activateVoicePlayback(stop, voicePlaybackSourceIdentity(source));
      const generation = ++generationRef.current;
      await playVoiceSourceWithOneRefresh({
        beforeRetry: disposePlayer,
        onSignedUrlRequest: () => {
          diagnostics.failureStage = "request-playback-url";
          diagnostics.playbackUrlRequested = true;
        },
        onSignedUrlResolved: () => {
          diagnostics.playbackUrlHasExpiration = true;
          diagnostics.playbackUrlReceived = true;
        },
        playUri: async (playbackUri) => {
          if (__DEV__ && source.kind === "persisted-message") {
            diagnostics.failureStage = "playback-url-response";
            await probeVoicePlaybackUrl(playbackUri);
            diagnostics.remoteResponseAccepted = true;
          }
          await createReadyPlayer(playbackUri, diagnostics, generation);
        },
        requestSignedUrl: ({ messageId, messageKind, storagePath }) =>
          getVoiceMemoDownloadUrl({ messageId, messageKind, storagePath }),
        shouldRetry: (nextError) => !isPlaybackCancellation(nextError),
        source,
      });
      logPlaybackResult({ ...diagnostics, durationMilliseconds, source });
    } catch (nextError) {
      if (!isPlaybackCancellation(nextError)) {
        diagnostics.failureStage = classifyPlaybackFailure(nextError, diagnostics.failureStage);
        logPlaybackResult({ ...diagnostics, durationMilliseconds, source }, nextError);
        setError(true);
      }
      await stop();
    } finally {
      setLoading(false);
      operationInFlightRef.current = false;
    }
  }, [createReadyPlayer, disposePlayer, durationMilliseconds, isOwnMessage, loading, playing, position, source, stop]);

  const total = Math.max(durationMilliseconds, 1);
  return (
    <View style={styles.container}>
      <View style={styles.playbackRow}>
        <TouchableOpacity
          accessibilityLabel={playing ? t("voiceMemo.pause") : error ? t("voiceMemo.tryAgain") : t("voiceMemo.play")}
          accessibilityRole="button"
          accessibilityState={{ busy: loading }}
          disabled={loading}
          onPress={toggle}
          style={[styles.button, loading && styles.buttonDisabled]}
        >
          {loading
            ? <ActivityIndicator color={Colors.surface} size="small" />
            : playing
              ? <Pause accessible={false} color={Colors.surface} size={18} />
              : <Play accessible={false} color={Colors.surface} size={18} />}
        </TouchableOpacity>
        <View style={styles.copy}>
          <View style={styles.track}>
            <View style={[styles.progress, { width: `${Math.min(100, position / total * 100)}%` }]} />
          </View>
          <Text numberOfLines={1} style={styles.time}>
            {formatTime(position)} / {formatTime(durationMilliseconds)}
          </Text>
        </View>
      </View>
      {loading ? <Text accessibilityLiveRegion="polite" style={styles.status}>{t("voiceMemo.loading")}</Text> : null}
      {error ? (
        <View style={styles.errorRow}>
          <Text accessibilityLiveRegion="polite" style={styles.error}>{t("voiceMemo.playbackUnavailable")}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={toggle} style={styles.retryButton}>
            <Text style={styles.retryText}>{t("voiceMemo.tryAgain")}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

type VoicePlaybackDiagnostics = {
  failureStage?: VoicePlaybackFailureStage;
  isOwnMessage: boolean;
  playerReady: boolean;
  playerReportedError: boolean;
  playerReportedLoaded: boolean;
  playerSourceAssigned: boolean;
  playCalled: boolean;
  playbackUrlHasExpiration: boolean;
  playbackUrlReceived: boolean;
  playbackUrlRequested: boolean;
  remoteResponseAccepted: boolean;
  replaceCalled: boolean;
};

function logPlaybackResult(
  input: VoicePlaybackDiagnostics & { durationMilliseconds: number; source: VoicePlaybackSource },
  error?: unknown,
) {
  if (!__DEV__) return;
  const details = {
    failureStage: error ? input.failureStage ?? "unknown" : undefined,
    hasDuration: Number.isFinite(input.durationMilliseconds) && input.durationMilliseconds > 0,
    hasMessageId: input.source.kind === "persisted-message" && Boolean(input.source.messageId),
    hasMimeType: true,
    hasStoragePath: input.source.kind === "persisted-message" && Boolean(input.source.storagePath),
    isOwnMessage: input.isOwnMessage,
    messageType: "voice",
    playCalled: input.playCalled,
    playerReady: input.playerReady,
    playerReportedError: input.playerReportedError,
    playerReportedLoaded: input.playerReportedLoaded,
    playerSourceAssigned: input.playerSourceAssigned,
    playbackUrlHasExpiration: input.playbackUrlHasExpiration,
    playbackUrlReceived: input.playbackUrlReceived,
    playbackUrlRequested: input.playbackUrlRequested,
    remoteResponseAccepted: input.remoteResponseAccepted,
    replaceCalled: input.replaceCalled,
    sourceKind: input.source.kind,
    errorName: error instanceof Error ? error.name : undefined,
    sanitizedError: error ? sanitizePlaybackError(error) : undefined,
  };
  if (error) console.warn("[VoiceMemoPlayer] playback failed", details);
  else console.info("[VoiceMemoPlayer] playback started", details);
}

function sanitizePlaybackError(error: unknown) {
  if (error instanceof Error && /^voice_[a-z_]+$/u.test(error.message)) return error.message;
  if (typeof error === "object" && error && "code" in error) {
    const code = String(error.code).replace(/[^a-z0-9_/-]/giu, "").slice(0, 80);
    return code || "service-error";
  }
  return "native-playback-error";
}

function classifyPlaybackFailure(
  error: unknown,
  fallback: VoicePlaybackFailureStage | undefined,
): VoicePlaybackFailureStage {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const details = typeof error === "object" && error && "details" in error && error.details && typeof error.details === "object"
    ? error.details as Record<string, unknown>
    : null;
  const reason = typeof details?.reason === "string" ? details.reason : "";
  const message = error instanceof Error ? error.message : "";
  if (
    code.includes("permission-denied") ||
    code.includes("not-found") ||
    reason.includes("authorized") ||
    reason.includes("participant") ||
    reason.includes("unavailable")
  ) return "playback-url-authorization";
  if (message === "expired_voice_playback_url") return "expired-url";
  if (message === "voice_remote_unsupported_format") return "unsupported-format";
  if (message.startsWith("voice_remote_")) return "remote-http";
  if (message === "voice_player_load_failed") return "player-load-error";
  if (message === "voice_player_load_timeout") return "player-load-timeout";
  if (message === "invalid_voice_playback_response" || message === "invalid_voice_playback_url") {
    return "request-playback-url";
  }
  return fallback ?? "unknown";
}

function isPlaybackCancellation(error: unknown) {
  return error instanceof Error && error.message === "voice_playback_superseded";
}

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  container: { alignSelf: "stretch", gap: Spacing.xs, minWidth: 0, width: "100%" },
  playbackRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, minHeight: 48, minWidth: 0, width: "100%" },
  button: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: 22, flexShrink: 0, height: 44, justifyContent: "center", width: 44 },
  buttonDisabled: { opacity: 0.8 },
  copy: { flex: 1, gap: 4, minWidth: 0 },
  track: { backgroundColor: Colors.secondary, borderRadius: Radius.button, height: 6, overflow: "hidden", width: "100%" },
  progress: { backgroundColor: Colors.primary, height: 6 },
  time: { color: Colors.textPrimary, flexShrink: 0, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 18 },
  moduleLoading: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, minHeight: 48, width: "100%" },
  status: { color: Colors.textPrimary, flexShrink: 1, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 18 },
  errorRow: { alignItems: "flex-start", gap: Spacing.xs, width: "100%" },
  error: { color: Colors.primary, flexShrink: 1, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 18 },
  retryButton: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center", paddingHorizontal: Spacing.xs },
  retryText: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 13, lineHeight: 18 },
  unavailable: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 18, width: "100%" },
});
