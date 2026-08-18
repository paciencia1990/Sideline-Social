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
import { useTranslation } from "react-i18next";

import { Colors, Radius, Typography } from "@/constants/theme";
import {
  getFriendChatMediaDownloadUrl,
  type StoredFriendChatImage,
} from "@/services/chatService";

type Props = {
  active: boolean;
  image: StoredFriendChatImage;
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
  image,
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
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => { onUnavailableRef.current = onUnavailable; }, [onUnavailable]);

  useEffect(() => {
    let mounted = true;
    setError(false);
    setThumbnailUrl(null);
    void getFriendChatMediaDownloadUrl({ messageId, storagePath: image.thumbnailPath })
      .then((result) => {
        if (mounted) setThumbnailUrl(result.url);
      })
      .catch(() => {
        if (mounted) {
          setError(true);
          onUnavailableRef.current();
        }
      });
    return () => { mounted = false; };
  }, [image.thumbnailPath, messageId]);

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
    return <Text accessibilityLiveRegion="polite" style={styles.error}>{t("chat.imageUnavailable")}</Text>;
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
      style={styles.thumbnailFrame}
    >
      {thumbnailUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          cachePolicy="memory"
          contentFit="cover"
          source={{ uri: thumbnailUrl }}
          style={styles.thumbnail}
        />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator accessibilityLabel={t("chat.imageLoading")} color={Colors.primary} size="small" />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  loading: { alignItems: "center", aspectRatio: 1.25, justifyContent: "center" },
  thumbnail: { height: "100%", width: "100%" },
  thumbnailFrame: {
    aspectRatio: 1.25,
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: Radius.card,
    borderWidth: 1,
    overflow: "hidden",
    width: "100%",
  },
});
