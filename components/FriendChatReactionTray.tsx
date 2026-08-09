import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { Plus } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Shadow, Spacing } from "@/constants/theme";

export type FriendChatReactionTrayAnchor = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type Props = {
  anchor: FriendChatReactionTrayAnchor | null;
  onDismiss: () => void;
  onMore: () => void;
  onReact: (emoji: string) => void;
  options: readonly string[];
  selectedEmoji?: string | null;
  submitting?: boolean;
  visible: boolean;
};

const EDGE_PADDING = 8;
const TRAY_GAP = 8;
const ESTIMATED_TRAY = { height: 58, width: 338 };

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function FriendChatReactionTray({
  anchor,
  onDismiss,
  onMore,
  onReact,
  options,
  selectedEmoji = null,
  submitting = false,
  visible,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [traySize, setTraySize] = useState(ESTIMATED_TRAY);

  const position = useMemo(() => {
    if (!anchor) return { left: EDGE_PADDING, top: EDGE_PADDING, width: ESTIMATED_TRAY.width };
    const horizontalInset = EDGE_PADDING + Math.max(insets.left, insets.right);
    const availableWidth = Math.max(0, window.width - horizontalInset * 2);
    const width = Math.min(ESTIMATED_TRAY.width, availableWidth);
    const measuredWidth = Math.min(traySize.width || width, width);
    const measuredHeight = traySize.height || ESTIMATED_TRAY.height;
    const minTop = insets.top + EDGE_PADDING;
    const maxTop = window.height - insets.bottom - EDGE_PADDING - measuredHeight;
    const topPreferred = anchor.y - measuredHeight - TRAY_GAP;
    const topFallback = anchor.y + anchor.height + TRAY_GAP;
    const hasRoomAbove = topPreferred >= minTop;
    const top = clamp(hasRoomAbove ? topPreferred : topFallback, minTop, maxTop);
    const left = clamp(anchor.x + anchor.width / 2 - measuredWidth / 2, horizontalInset, window.width - horizontalInset - measuredWidth);
    return { left, top, width };
  }, [anchor, insets.bottom, insets.left, insets.right, insets.top, traySize.height, traySize.width, window.height, window.width]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      presentationStyle="overFullScreen"
      transparent
      visible={visible && Boolean(anchor)}
    >
      <View pointerEvents="box-none" style={styles.modalRoot}>
        <Pressable
          accessibilityLabel={t("chat.dismissReactionTray")}
          accessibilityRole="button"
          onPress={onDismiss}
          style={styles.backdrop}
        />
        <View
          accessibilityLabel={selectedEmoji
            ? t("chat.reactionTrayWithSelection", { emoji: selectedEmoji })
            : t("chat.reactionTray")}
          accessibilityViewIsModal
          onLayout={(event) => {
            const { height, width } = event.nativeEvent.layout;
            setTraySize({ height, width });
          }}
          style={[styles.tray, { left: position.left, maxWidth: position.width, top: position.top }]}
        >
          {options.map((emoji) => {
            const selected = selectedEmoji === emoji;
            return (
              <TouchableOpacity
                accessibilityHint={selected ? t("chat.selectedReactionHint") : undefined}
                accessibilityLabel={selected ? t("chat.removeReaction", { emoji }) : t("chat.reactWith", { emoji })}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: submitting }}
                disabled={submitting}
                key={emoji}
                onPress={() => onReact(emoji)}
                style={[styles.reactionButton, selected && styles.reactionButtonSelected]}
              >
                <Text style={styles.emoji}>{emoji}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            accessibilityLabel={t("chat.moreReactions")}
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting }}
            disabled={submitting}
            onPress={onMore}
            style={styles.moreButton}
          >
            {submitting ? (
              <ActivityIndicator color={Colors.textHeading} size="small" />
            ) : (
              <Plus accessible={false} color={Colors.textHeading} size={20} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  emoji: { fontSize: 24, lineHeight: 30 },
  modalRoot: { flex: 1 },
  moreButton: {
    alignItems: "center",
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: 21,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    minHeight: 42,
    minWidth: 42,
    width: 42,
  },
  reactionButton: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: 21,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    minHeight: 42,
    minWidth: 42,
    width: 42,
  },
  reactionButtonSelected: {
    backgroundColor: Colors.background,
    borderColor: Colors.accentGold,
    borderWidth: 2,
  },
  tray: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: Radius.card,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    padding: Spacing.xs,
    position: "absolute",
    ...Shadow.card,
  },
});
