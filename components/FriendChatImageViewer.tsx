import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Image } from "expo-image";
import { ArrowLeft, Download, Forward, MoreHorizontal } from "lucide-react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { Colors, Spacing, Typography } from "@/constants/theme";
import {
  getFriendChatMediaDownloadUrl,
  type FriendChatMessage,
} from "@/services/chatService";

type Props = {
  message: FriendChatMessage | null;
  onBack: () => void;
  onForward: () => void;
  onMore: () => void;
  onSave: () => void;
  onUnavailable: () => void;
  saving: boolean;
  senderName: string;
  visible: boolean;
};

const MAX_SCALE = 4;

export function FriendChatImageViewer({
  message,
  onBack,
  onForward,
  onMore,
  onSave,
  onUnavailable,
  saving,
  senderName,
  visible,
}: Props) {
  const { i18n, t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const onUnavailableRef = useRef(onUnavailable);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const viewportWidth = useSharedValue(0);
  const viewportHeight = useSharedValue(0);

  useEffect(() => { onUnavailableRef.current = onUnavailable; }, [onUnavailable]);

  const resetView = useCallback(() => {
    scale.value = withTiming(1);
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedScale.value = 1;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY]);

  useEffect(() => {
    if (!visible || !message?.image || message.status !== "active") {
      setFullUrl(null);
      setUnavailable(false);
      resetView();
      return;
    }
    let mounted = true;
    setFullUrl(null);
    setUnavailable(false);
    resetView();
    void getFriendChatMediaDownloadUrl({ messageId: message.messageId, storagePath: message.image.fullPath })
      .then((result) => {
        if (mounted) setFullUrl(result.url);
      })
      .catch(() => {
        if (!mounted) return;
        setUnavailable(true);
        onUnavailableRef.current();
      });
    return () => { mounted = false; };
  }, [message?.image, message?.messageId, message?.status, resetView, visible]);

  const timestamp = useMemo(() => message?.createdAt
    ? new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
      dateStyle: "full",
      timeStyle: "short",
    }).format(message.createdAt)
    : t("chat.messageDateUnavailable"), [i18n.language, i18n.resolvedLanguage, message?.createdAt, t]);

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      const nextScale = Math.max(1, Math.min(MAX_SCALE, savedScale.value * event.scale));
      scale.value = nextScale;
      translateX.value = clampTranslation(savedTranslateX.value, viewportWidth.value, nextScale);
      translateY.value = clampTranslation(savedTranslateY.value, viewportHeight.value, nextScale);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .onUpdate((event) => {
      if (scale.value <= 1) return;
      translateX.value = clampTranslation(savedTranslateX.value + event.translationX, viewportWidth.value, scale.value);
      translateY.value = clampTranslation(savedTranslateY.value + event.translationY, viewportHeight.value, scale.value);
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const onViewportLayout = (event: LayoutChangeEvent) => {
    viewportWidth.value = event.nativeEvent.layout.width;
    viewportHeight.value = event.nativeEvent.layout.height;
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onBack}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent={false}
      visible={visible}
    >
      <View accessibilityViewIsModal style={styles.viewer}>
        <View style={[styles.header, { paddingTop: insets.top }]}> 
          <TouchableOpacity
            accessibilityHint={t("chat.closePhotoViewerHint")}
            accessibilityLabel={t("chat.closePhotoViewer")}
            accessibilityRole="button"
            onPress={onBack}
            style={styles.actionButton}
          >
            <ArrowLeft color={Colors.surface} size={24} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={styles.sender}>{senderName}</Text>
            <Text numberOfLines={2} style={styles.timestamp}>{timestamp}</Text>
          </View>
          <TouchableOpacity
            accessibilityLabel={saving ? t("chat.savingPhoto") : t("chat.savePhoto")}
            accessibilityRole="button"
            accessibilityState={{ busy: saving, disabled: saving || unavailable }}
            disabled={saving || unavailable}
            onPress={onSave}
            style={styles.actionButton}
          >
            {saving ? <ActivityIndicator color={Colors.surface} size="small" /> : <Download color={Colors.surface} size={22} />}
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel={t("chat.forwardPhoto")}
            accessibilityRole="button"
            accessibilityState={{ disabled: unavailable }}
            disabled={unavailable}
            onPress={onForward}
            style={styles.actionButton}
          >
            <Forward color={Colors.surface} size={22} />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel={t("chat.morePhotoActions")}
            accessibilityRole="button"
            onPress={onMore}
            style={styles.actionButton}
          >
            <MoreHorizontal color={Colors.surface} size={24} />
          </TouchableOpacity>
        </View>
        <View onLayout={onViewportLayout} style={[styles.viewport, { paddingBottom: insets.bottom }]}> 
          {unavailable ? (
            <View style={styles.center}>
              <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.unavailableTitle}>{t("chat.imageUnavailable")}</Text>
              <TouchableOpacity accessibilityRole="button" onPress={onBack} style={styles.unavailableButton}>
                <Text style={styles.unavailableButtonText}>{t("common.back")}</Text>
              </TouchableOpacity>
            </View>
          ) : fullUrl && message?.image ? (
            <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
              <Animated.View style={[styles.imageFrame, imageStyle]}>
                <Image
                  accessibilityIgnoresInvertColors
                  accessibilityLabel={t("chat.fullScreenPhotoAccessibility", { sender: senderName, timestamp })}
                  cachePolicy="memory"
                  contentFit="contain"
                  onError={() => {
                    setUnavailable(true);
                    onUnavailableRef.current();
                  }}
                  source={{ uri: fullUrl }}
                  style={styles.image}
                />
              </Animated.View>
            </GestureDetector>
          ) : (
            <ActivityIndicator accessibilityLabel={t("chat.imageLoading")} color={Colors.surface} size="large" />
          )}
        </View>
      </View>
    </Modal>
  );
}

function clampTranslation(value: number, viewport: number, scale: number) {
  "worklet";
  const limit = Math.max(0, (viewport * scale - viewport) / 2);
  return Math.max(-limit, Math.min(limit, value));
}

const styles = StyleSheet.create({
  actionButton: { alignItems: "center", height: 48, justifyContent: "center", width: 44 },
  center: { alignItems: "center", gap: Spacing.md, padding: Spacing.xl },
  header: { alignItems: "center", backgroundColor: "rgba(20, 26, 34, 0.96)", flexDirection: "row", minHeight: 64, paddingHorizontal: Spacing.xs },
  headerCopy: { flex: 1, minWidth: 0, paddingHorizontal: Spacing.xs },
  image: { height: "100%", width: "100%" },
  imageFrame: { height: "100%", width: "100%" },
  sender: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 15 },
  timestamp: { color: Colors.surface, fontFamily: Typography.bodyRegular, fontSize: 11, lineHeight: 15, opacity: 0.8 },
  unavailableButton: { alignItems: "center", borderColor: Colors.surface, borderRadius: 6, borderWidth: 1, minHeight: 44, justifyContent: "center", paddingHorizontal: Spacing.lg },
  unavailableButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold },
  unavailableTitle: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 16, textAlign: "center" },
  viewer: { backgroundColor: "#101820", flex: 1 },
  viewport: { alignItems: "center", flex: 1, justifyContent: "center", overflow: "hidden" },
});
