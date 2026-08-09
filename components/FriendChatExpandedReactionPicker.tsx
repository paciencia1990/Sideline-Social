import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";

type ReactionCategory = {
  key: string;
  label: string;
  options: readonly string[];
};

type Props = {
  categories: ReactionCategory[];
  onDismiss: () => void;
  onReact: (emoji: string) => void;
  selectedEmoji?: string | null;
  visible: boolean;
};

export function FriendChatExpandedReactionPicker({
  categories,
  onDismiss,
  onReact,
  selectedEmoji = null,
  visible,
}: Props) {
  const { t } = useTranslation();
  return (
    <Modal
      animationType="slide"
      onRequestClose={onDismiss}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel={t("chat.dismissReactionTray")} accessibilityRole="button" onPress={onDismiss} style={styles.backdropDismiss} />
        <View accessibilityLabel={t("chat.expandedReactionPicker")} accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>{t("chat.moreReactions")}</Text>
            <TouchableOpacity accessibilityLabel={t("common.close")} accessibilityRole="button" onPress={onDismiss} style={styles.close}>
              <X color={Colors.textHeading} size={22} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            {categories.map((category) => (
              <View key={category.key} style={styles.category}>
                <Text style={styles.categoryTitle}>{category.label}</Text>
                <View style={styles.grid}>
                  {category.options.map((emoji) => {
                    const selected = emoji === selectedEmoji;
                    return (
                      <TouchableOpacity
                        accessibilityLabel={selected ? t("chat.removeReaction", { emoji }) : t("chat.reactWith", { emoji })}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        key={emoji}
                        onPress={() => onReact(emoji)}
                        style={[styles.emojiButton, selected && styles.emojiButtonSelected]}
                      >
                        <Text style={styles.emoji}>{emoji}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(47, 65, 86, 0.18)", flex: 1, justifyContent: "flex-end" },
  backdropDismiss: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  category: { gap: Spacing.xs },
  categoryTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  close: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  content: { gap: Spacing.md, paddingBottom: Spacing.xl },
  emoji: { fontSize: 25, lineHeight: 31 },
  emojiButton: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  emojiButtonSelected: { backgroundColor: Colors.background, borderColor: Colors.accentGold, borderWidth: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  header: { alignItems: "center", flexDirection: "row", minHeight: 48 },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    gap: Spacing.md,
    maxHeight: "78%",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    ...Shadow.card,
  },
  title: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodyBold, fontSize: 18 },
});
