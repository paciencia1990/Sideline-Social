import React, { useEffect, useRef, useState } from "react";
import {
  type AccessibilityActionEvent,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { ImageIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Typography } from "@/constants/theme";
import {
  type StoredFriendChatImage,
} from "@/services/chatService";
import {
  clearFriendChatImageCacheForMessages,
  loadFriendChatImageMedia,
} from "@/services/friendChatImageCacheService";
import { startDevelopmentPerformanceTrace } from "@/utils/performanceDiagnostics";

type Props = {
  active: boolean;
  conversationId: string;
  image: StoredFriendChatImage;
  loadMedia: boolean;
  messageId: string;
  onLongPress: () => void;
  onOpen: () => void;
  onSelect: () => void;
  onUnavailable: () => void;
  selectionMode: boolean;
};

const LONG_PRESS_TAP_GUARD_MS = 700;

export function FriendChatImageMessage({
  active,
  conversationId,
  image,
  loadMedia,
  messageId,
  onLongPress,
  onOpen,
  onSelect,
  onUnavailable,
  selectionMode,
}: Props) {
  const { t } = useTranslation();
  const lastLongPressAtRef = useRef(0);
  const onUnavailableRef = useRef(onUnavailable);
  const decodeTraceRef = useRef<(() => number) | null>(null);
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => { onUnavailableRef.current = onUnavailable; }, [onUnavailable]);

  useEffect(() => {
    if (!loadMedia || thumbnailUri) return;
    const controller = new AbortController();
    setError(false);
    void loadFriendChatImageMedia({
      conversationId,
      expectedSizeBytes: image.thumbnailSizeBytes,
      mediaProfileVersion: image.mediaProfileVersion,
      messageId,
      signal: controller.signal,
      storagePath: image.thumbnailPath,
      variant: "thumbnail",
    })
      .then((uri) => {
        if (controller.signal.aborted) return;
        decodeTraceRef.current = startDevelopmentPerformanceTrace("friend-chat.image-thumbnail-visible");
        setThumbnailUri(uri);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted || (loadError instanceof Error && loadError.name === "AbortError")) return;
        setError(true);
        onUnavailableRef.current();
      });
    return () => controller.abort();
  }, [conversationId, image.mediaProfileVersion, image.thumbnailPath, image.thumbnailSizeBytes, loadMedia, messageId, retryKey, thumbnailUri]);

  const retry = () => {
    setError(false);
    setThumbnailUri(null);
    void clearFriendChatImageCacheForMessages([messageId]).finally(() => setRetryKey((value) => value + 1));
  };

  const handlePress = () => {
    if (!active || Date.now() - lastLongPressAtRef.current < LONG_PRESS_TAP_GUARD_MS) return;
    if (selectionMode) onSelect();
    else onOpen();
  };

  const handleLongPress = () => {
    if (!active) return;
    lastLongPressAtRef.current = Date.now();
    onLongPress();
  };

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (!active) return;
    if (event.nativeEvent.actionName === "viewPhoto") onOpen();
    if (event.nativeEvent.actionName === "selectPhoto") onSelect();
    if (event.nativeEvent.actionName === "reactToPhoto" || event.nativeEvent.actionName === "morePhotoActions") {
      handleLongPress();
    }
  };

  if (error) {
    return (
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        accessible
        style={[styles.thumbnailFrame, { aspectRatio: image.thumbnailWidth / image.thumbnailHeight }, styles.errorState]}
      >
        <Text style={styles.error}>{t("chat.imageUnavailable")}</Text>
        <Pressable accessibilityLabel={t("common.retry")} accessibilityRole="button" onPress={retry} style={styles.retryButton}>
          <Text style={styles.retryText}>{t("common.retry")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityActions={active
        ? [
          { label: t("chat.viewPhoto"), name: "viewPhoto" },
          { label: t("chat.selectMessage"), name: "selectPhoto" },
          { label: t("chat.reactToPhoto"), name: "reactToPhoto" },
          { label: t("chat.morePhotoActions"), name: "morePhotoActions" },
        ]
        : undefined}
      accessibilityHint={active ? t("chat.photoMessageAccessibilityHint") : undefined}
      accessibilityLabel={t("chat.photoMessageAccessibility")}
      accessibilityRole="imagebutton"
      delayLongPress={360}
      onAccessibilityAction={handleAccessibilityAction}
      onLongPress={handleLongPress}
      onPress={handlePress}
      style={[styles.thumbnailFrame, { aspectRatio: image.thumbnailWidth / image.thumbnailHeight }]}
    >
      {thumbnailUri ? (
        <Image
          accessibilityIgnoresInvertColors
          cachePolicy="memory"
          contentFit="cover"
          onDisplay={() => {
            decodeTraceRef.current?.();
            decodeTraceRef.current = null;
          }}
          onError={() => {
            setThumbnailUri(null);
            setError(true);
            onUnavailableRef.current();
          }}
          source={{ uri: thumbnailUri }}
          style={styles.thumbnail}
        />
      ) : (
        <View style={styles.loading}>
          <ImageIcon color={Colors.accentGreen} size={28} />
          <ActivityIndicator accessibilityLabel={t("chat.imageLoading")} color={Colors.primary} size="small" />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  error: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13, textAlign: "center" },
  errorState: { alignItems: "center", gap: 8, justifyContent: "center", padding: 12 },
  loading: { alignItems: "center", flex: 1, gap: 8, justifyContent: "center" },
  retryButton: { alignItems: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  retryText: { color: Colors.communicationLink, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  thumbnail: { height: "100%", width: "100%" },
  thumbnailFrame: {
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: Radius.card,
    borderWidth: 1,
    overflow: "hidden",
    width: "100%",
  },
});
