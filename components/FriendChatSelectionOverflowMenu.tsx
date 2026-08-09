import React, { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import type { FriendChatReactionTrayAnchor } from "@/components/FriendChatReactionTray";

export type FriendChatOverflowAction = {
  destructive?: boolean;
  disabled?: boolean;
  id: string;
  label: string;
  onPress: () => void;
};

type Props = {
  actions: FriendChatOverflowAction[];
  anchor: FriendChatReactionTrayAnchor | null;
  dismissLabel: string;
  onDismiss: () => void;
  visible: boolean;
};

const MENU_WIDTH = 216;
const EDGE_PADDING = 8;

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function FriendChatSelectionOverflowMenu({ actions, anchor, dismissLabel, onDismiss, visible }: Props) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [height, setHeight] = useState(48);
  const position = useMemo(() => {
    const horizontalInset = EDGE_PADDING + Math.max(insets.left, insets.right);
    const topBase = anchor ? anchor.y + anchor.height + Spacing.xs : insets.top + EDGE_PADDING;
    return {
      left: clamp(anchor ? anchor.x + anchor.width - MENU_WIDTH : window.width - MENU_WIDTH - horizontalInset, horizontalInset, window.width - horizontalInset - MENU_WIDTH),
      top: clamp(topBase, insets.top + EDGE_PADDING, window.height - insets.bottom - EDGE_PADDING - height),
    };
  }, [anchor, height, insets.bottom, insets.left, insets.right, insets.top, window.height, window.width]);

  return (
    <Modal animationType="fade" onRequestClose={onDismiss} presentationStyle="overFullScreen" transparent visible={visible && Boolean(anchor)}>
      <View pointerEvents="box-none" style={styles.root}>
        <Pressable accessibilityLabel={dismissLabel} accessibilityRole="button" onPress={onDismiss} style={styles.backdrop} />
        <View onLayout={(event) => setHeight(event.nativeEvent.layout.height)} style={[styles.menu, { left: position.left, top: position.top }]}>
          {actions.map((action) => (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: action.disabled }}
              disabled={action.disabled}
              key={action.id}
              onPress={() => {
                onDismiss();
                action.onPress();
              }}
              style={[styles.action, action.disabled && styles.disabled]}
            >
              <Text style={[styles.actionText, action.destructive && styles.destructiveText]}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  action: { justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.md },
  actionText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  backdrop: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  destructiveText: { color: Colors.primary },
  disabled: { opacity: 0.45 },
  menu: {
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    overflow: "hidden",
    position: "absolute",
    width: MENU_WIDTH,
    ...Shadow.card,
  },
  root: { flex: 1 },
});
