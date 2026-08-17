import React, { useEffect, useRef, useState } from "react";
import {
  type AccessibilityActionEvent,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getFriendChatMediaDownloadUrl,
  type StoredFriendChatImage,
} from "@/services/chatService";

type Props = {
  active: boolean;
  image: StoredFriendChatImage;
  messageId: string;
  onForward: () => void;
  onLongPress: () => void;
  onSave: () => void;
  onSelect: () => void;
  onUnavailable: () => void;
  saving: boolean;
  selectionMode: boolean;
};

const LONG_PRESS_TAP_GUARD_MS = 700;

export function FriendChatImageMessage({
  active,
  image,
  messageId,
  onForward,
  onLongPress,
  onSave,
  onSelect,
  onUnavailable,
  saving,
  selectionMode,
}: Props) {
  const { t } = useTranslation();
  const lastLongPressAtRef = useRef(0);
  const onUnavailableRef = useRef(onUnavailable);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [actionMenuVisible, setActionMenuVisible] = useState(false);
  const [openingActions, setOpeningActions] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
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

  useEffect(() => {
    if (active) return;
    setActionMenuVisible(false);
    setViewerVisible(false);
    setFullUrl(null);
  }, [active]);

  const ensureFullImageAccess = async () => {
    try {
      const result = await getFriendChatMediaDownloadUrl({ messageId, storagePath: image.fullPath });
      setFullUrl(result.url);
      return true;
    } catch {
      setError(true);
      onUnavailableRef.current();
      return false;
    }
  };

  const openActionMenu = async () => {
    if (!active || !thumbnailUrl || openingActions) return;
    setOpeningActions(true);
    const authorized = await ensureFullImageAccess();
    setOpeningActions(false);
    if (authorized) setActionMenuVisible(true);
  };

  const openViewer = async () => {
    setActionMenuVisible(false);
    if (await ensureFullImageAccess()) setViewerVisible(true);
  };

  const handlePress = () => {
    if (Date.now() - lastLongPressAtRef.current < LONG_PRESS_TAP_GUARD_MS) return;
    if (selectionMode) {
      onSelect();
      return;
    }
    void openActionMenu();
  };

  const handleLongPress = () => {
    if (!active) return;
    lastLongPressAtRef.current = Date.now();
    setActionMenuVisible(false);
    onLongPress();
  };

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (!active) return;
    if (event.nativeEvent.actionName === "viewPhoto") void openViewer();
    if (event.nativeEvent.actionName === "forwardPhoto") onForward();
    if (event.nativeEvent.actionName === "savePhoto" && !saving) onSave();
    if (event.nativeEvent.actionName === "reactToPhoto") handleLongPress();
    if (event.nativeEvent.actionName === "morePhotoActions") void openActionMenu();
  };

  if (error) {
    return <Text accessibilityLiveRegion="polite" style={styles.error}>{t("chat.imageUnavailable")}</Text>;
  }

  return (
    <>
      <Pressable
        accessibilityActions={active
          ? [
            { label: t("chat.viewPhoto"), name: "viewPhoto" },
            { label: t("chat.forwardPhoto"), name: "forwardPhoto" },
            { label: t("chat.savePhoto"), name: "savePhoto" },
            { label: t("chat.reactToPhoto"), name: "reactToPhoto" },
            { label: t("chat.morePhotoActions"), name: "morePhotoActions" },
          ]
          : undefined}
        accessibilityLabel={t("chat.photoMessageAccessibility")}
        accessibilityRole="imagebutton"
        accessibilityState={{ busy: openingActions || saving }}
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

      <Modal
        animationType="slide"
        onRequestClose={() => setActionMenuVisible(false)}
        presentationStyle="overFullScreen"
        transparent
        visible={actionMenuVisible}
      >
        <View style={styles.actionBackdrop}>
          <Pressable
            accessibilityLabel={t("chat.dismissPhotoActions")}
            accessibilityRole="button"
            onPress={() => setActionMenuVisible(false)}
            style={styles.actionBackdropDismiss}
          />
          <View accessibilityLabel={t("chat.photoActionsTitle")} accessibilityViewIsModal style={styles.actionSheet}>
            <Text accessibilityRole="header" style={styles.actionTitle}>{t("chat.photoActionsTitle")}</Text>
            <PhotoAction label={t("chat.viewPhoto")} onPress={() => { void openViewer(); }} />
            <PhotoAction label={t("chat.forwardPhoto")} onPress={() => { setActionMenuVisible(false); onForward(); }} />
            <PhotoAction disabled={saving} label={saving ? t("chat.savingPhoto") : t("chat.savePhoto")} onPress={() => { setActionMenuVisible(false); onSave(); }} />
            <PhotoAction label={t("common.cancel")} onPress={() => setActionMenuVisible(false)} />
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setViewerVisible(false)}
        presentationStyle="overFullScreen"
        transparent={false}
        visible={viewerVisible}
      >
        <View style={styles.viewer}>
          <View style={styles.viewerHeader}>
            <Text accessibilityRole="header" style={styles.viewerTitle}>{t("chat.photoPreview")}</Text>
            <TouchableOpacity
              accessibilityLabel={t("common.close")}
              accessibilityRole="button"
              onPress={() => setViewerVisible(false)}
              style={styles.closeButton}
            >
              <X color={Colors.surface} size={24} />
            </TouchableOpacity>
          </View>
          <ScrollView
            centerContent
            contentContainerStyle={styles.viewerContent}
            maximumZoomScale={3}
            minimumZoomScale={1}
          >
            {fullUrl ? (
              <Pressable accessibilityRole="image" style={styles.fullImageFrame}>
                <Image
                  accessibilityIgnoresInvertColors
                  cachePolicy="memory"
                  contentFit="contain"
                  source={{ uri: fullUrl }}
                  style={styles.fullImage}
                />
              </Pressable>
            ) : (
              <ActivityIndicator accessibilityLabel={t("chat.imageLoading")} color={Colors.surface} size="large" />
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function PhotoAction({ disabled = false, label, onPress }: { disabled?: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.action, disabled && styles.actionDisabled]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  action: { justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  actionBackdrop: { backgroundColor: "rgba(47, 65, 86, 0.18)", flex: 1, justifyContent: "flex-end" },
  actionBackdropDismiss: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  actionDisabled: { opacity: 0.45 },
  actionSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  actionText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 15 },
  actionTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 18, padding: Spacing.md },
  closeButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  fullImage: { height: "100%", width: "100%" },
  fullImageFrame: { height: "100%", width: "100%" },
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
  viewer: { backgroundColor: Colors.textHeading, flex: 1 },
  viewerContent: { alignItems: "center", flexGrow: 1, justifyContent: "center" },
  viewerHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  viewerTitle: { color: Colors.surface, fontFamily: Typography.bodyBold, fontSize: 17 },
});
