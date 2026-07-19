import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Pause, Play } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { getVoiceMemoDownloadUrl } from "@/services/teamPrivateMessageService";
import { isTeamVoiceAudioAvailable } from "@/services/teamVoiceAudioCapability";
import { activateVoicePlayback, releaseVoicePlayback } from "@/services/voiceMemoAudioService";

type Props = {
  durationMilliseconds: number;
  storagePath?: string;
  uri?: string;
  onPreviewed?: () => void;
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

  if (!audioAvailable) {
    return <Text accessibilityLiveRegion="polite" style={styles.unavailable}>{t("voiceMemo.updatedBuildRequired")}</Text>;
  }
  if (!audioModule) {
    return <ActivityIndicator accessibilityLabel={t("common.loading")} color={Colors.primary} size="small" />;
  }
  return <VoiceMemoPlayerAvailable {...props} audioModule={audioModule} />;
}

function VoiceMemoPlayerAvailable({ audioModule, durationMilliseconds, onPreviewed, storagePath, uri }: Props & { audioModule: ExpoAudioModule }) {
  const { t } = useTranslation();
  const playerRef = useRef<import("expo-audio").AudioPlayer | null>(null);
  const statusSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const cachedUrl = useRef<{ url: string; expiresAtMillis: number } | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const stop = useCallback(async () => {
    const player = playerRef.current;
    playerRef.current = null;
    statusSubscriptionRef.current?.remove();
    statusSubscriptionRef.current = null;
    setPlaying(false);
    setPosition(0);
    if (player) {
      try { player.pause(); } catch {}
      try { player.remove(); } catch {}
    }
    releaseVoicePlayback(stop);
  }, []);

  useFocusEffect(useCallback(() => () => { void stop(); }, [stop]));
  useEffect(() => () => { void stop(); }, [stop]);

  const resolveUri = useCallback(async () => {
    if (uri) return uri;
    if (!storagePath) throw new Error("missing_voice_path");
    if (cachedUrl.current && cachedUrl.current.expiresAtMillis > Date.now() + 15_000) return cachedUrl.current.url;
    cachedUrl.current = await getVoiceMemoDownloadUrl(storagePath);
    return cachedUrl.current.url;
  }, [storagePath, uri]);

  const onStatus = useCallback((status: import("expo-audio").AudioStatus) => {
    if (!status.isLoaded) return;
    setPosition(status.currentTime * 1000);
    setPlaying(status.playing);
    if (status.didJustFinish) {
      onPreviewed?.();
      void stop();
    }
  }, [onPreviewed, stop]);

  const toggle = useCallback(async () => {
    if (loading) return;
    setError(false);
    try {
      if (playerRef.current && playing) {
        playerRef.current.pause();
        return;
      }
      setLoading(true);
      await activateVoicePlayback(stop);
      if (!playerRef.current) {
        await audioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, interruptionMode: "duckOthers" });
        const player = audioModule.createAudioPlayer(await resolveUri(), { updateInterval: 250 });
        statusSubscriptionRef.current = player.addListener("playbackStatusUpdate", onStatus);
        playerRef.current = player;
        player.play();
      } else {
        if (position >= durationMilliseconds - 100) await playerRef.current.seekTo(0);
        playerRef.current.play();
      }
    } catch (nextError) {
      console.warn("[VoiceMemoPlayer] playback error", getErrorCode(nextError));
      setError(true);
      await stop();
    } finally {
      setLoading(false);
    }
  }, [audioModule, durationMilliseconds, loading, onStatus, playing, position, resolveUri, stop]);

  const total = Math.max(durationMilliseconds, 1);
  return (
    <View accessibilityLabel={t("voiceMemo.playerAccessibility")} style={styles.container}>
      <TouchableOpacity accessibilityLabel={playing ? t("voiceMemo.pause") : error ? t("voiceMemo.retry") : t("voiceMemo.play")} accessibilityRole="button" accessibilityState={{ busy: loading }} onPress={toggle} style={styles.button}>
        {loading ? <ActivityIndicator color={Colors.surface} size="small" /> : playing ? <Pause color={Colors.surface} size={18} /> : <Play color={Colors.surface} size={18} />}
      </TouchableOpacity>
      <View style={styles.copy}>
        <View style={styles.track}><View style={[styles.progress, { width: `${Math.min(100, position / total * 100)}%` }]} /></View>
        <Text style={styles.time}>{formatTime(position)} / {formatTime(durationMilliseconds)}</Text>
        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{t("voiceMemo.playbackError")} {t("voiceMemo.retry")}</Text> : null}
      </View>
    </View>
  );
}

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

const styles = StyleSheet.create({
  container: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, minHeight: 48 },
  button: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  copy: { flex: 1, gap: 4 },
  track: { backgroundColor: Colors.secondary, borderRadius: Radius.button, height: 6, overflow: "hidden" },
  progress: { backgroundColor: Colors.primary, height: 6 },
  time: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  unavailable: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 18 },
});
