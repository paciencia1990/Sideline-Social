import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getFriendChatMediaDownloadUrl,
  type StoredFriendChatImage,
} from "@/services/chatService";

type Props = {
  image: StoredFriendChatImage;
  messageId: string;
};

export function FriendChatImageMessage({ image, messageId }: Props) {
  const { t } = useTranslation();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    setError(false);
    setThumbnailUrl(null);
    void getFriendChatMediaDownloadUrl({ messageId, storagePath: image.thumbnailPath })
      .then((result) => {
        if (mounted) setThumbnailUrl(result.url);
      })
      .catch(() => {
        if (mounted) setError(true);
      });
    return () => { mounted = false; };
  }, [image.thumbnailPath, messageId]);

  const openViewer = () => {
    setViewerVisible(true);
    if (fullUrl) return;
    void getFriendChatMediaDownloadUrl({ messageId, storagePath: image.fullPath })
      .then((result) => setFullUrl(result.url))
      .catch(() => setError(true));
  };

  if (error) {
    return <Text accessibilityLiveRegion="polite" style={styles.error}>{t("chat.imageUnavailable")}</Text>;
  }

  return (
    <>
      <TouchableOpacity
        accessibilityLabel={t("chat.openImageViewer")}
        accessibilityRole="imagebutton"
        onPress={openViewer}
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
      </TouchableOpacity>

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

const styles = StyleSheet.create({
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
