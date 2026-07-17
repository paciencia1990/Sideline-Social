import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Audio, type AVPlaybackStatus } from "expo-av";
import { useFocusEffect } from "expo-router";
import { Pause, Play } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { getVoiceMemoDownloadUrl } from "@/services/teamPrivateMessageService";
import { activateVoicePlayback, releaseVoicePlayback } from "@/services/voiceMemoAudioService";

type Props = {
  durationMilliseconds: number;
  storagePath?: string;
  uri?: string;
  onPreviewed?: () => void;
};

export function VoiceMemoPlayer({ durationMilliseconds, onPreviewed, storagePath, uri }: Props) {
  const { t } = useTranslation();
  const soundRef = useRef<Audio.Sound | null>(null);
  const cachedUrl = useRef<{ url: string; expiresAtMillis: number } | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const stop = useCallback(async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    setPlaying(false);
    setPosition(0);
    if (sound) {
      try { await sound.stopAsync(); } catch {}
      try { await sound.unloadAsync(); } catch {}
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

  const onStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPosition(status.positionMillis);
    setPlaying(status.isPlaying);
    if (status.didJustFinish) {
      onPreviewed?.();
      void stop();
    }
  }, [onPreviewed, stop]);

  const toggle = useCallback(async () => {
    if (loading) return;
    setError(false);
    try {
      if (soundRef.current && playing) {
        await soundRef.current.pauseAsync();
        return;
      }
      setLoading(true);
      await activateVoicePlayback(stop);
      if (!soundRef.current) {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, shouldDuckAndroid: true });
        const created = await Audio.Sound.createAsync({ uri: await resolveUri() }, { shouldPlay: true }, onStatus);
        soundRef.current = created.sound;
      } else {
        if (position >= durationMilliseconds - 100) await soundRef.current.replayAsync();
        else await soundRef.current.playAsync();
      }
    } catch (nextError) {
      console.warn("[VoiceMemoPlayer] playback error", getErrorCode(nextError));
      setError(true);
      await stop();
    } finally {
      setLoading(false);
    }
  }, [durationMilliseconds, loading, onStatus, playing, position, resolveUri, stop]);

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
});
