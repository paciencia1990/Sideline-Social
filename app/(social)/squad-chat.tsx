import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MessageSquare } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { useAuth } from "@/context/AuthContext";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { getOrCreateSquadChat } from "@/services/chatService";
import { fetchSquadDetail } from "@/services/squadService";

export default function SquadChatScreen() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const { squadId } = useLocalSearchParams<{ squadId?: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const openSquadChat = useCallback(async () => {
    if (!squadId) {
      setError(t("chat.missingSquad"));
      setLoading(false);
      return;
    }

    if (!user?.uid) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const squad = await fetchSquadDetail(squadId);
      const chatId = await getOrCreateSquadChat(squadId, squad?.name, squad?.memberIds ?? []);
      router.replace({ pathname: "/(social)/chat/[chatId]", params: { chatId } });
    } catch (nextError) {
      console.warn("[SquadChatScreen] open squad chat error:", nextError);
      setError(nextError instanceof Error ? nextError.message : t("chat.errorBody"));
      setLoading(false);
    }
  }, [squadId, t, user?.uid]);

  useEffect(() => {
    if (authLoading) return;
    void openSquadChat();
  }, [authLoading, openSquadChat]);

  if (authLoading || loading) {
    return (
      <ScreenWrapper>
        <View style={styles.centeredState}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.stateText}>{t("chat.openingSquadChat")}</Text>
        </View>
      </ScreenWrapper>
    );
  }

  if (!user?.uid) {
    return (
      <ScreenWrapper>
        <View style={styles.centeredState}>
          <MessageSquare size={42} color={Colors.primary} />
          <Text style={styles.title}>{t("chat.squadChats")}</Text>
          <Text style={styles.stateText}>{t("chat.signInRequired")}</Text>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <View style={styles.centeredState}>
        <MessageSquare size={42} color={Colors.primary} />
        <Text style={styles.title}>{t("chat.squadChats")}</Text>
        <Card style={styles.errorCard}>
          <Text style={styles.stateText}>{error ?? t("chat.errorBody")}</Text>
        </Card>
        <TouchableOpacity accessibilityRole="button" activeOpacity={0.82} onPress={openSquadChat} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{t("chat.retry")}</Text>
        </TouchableOpacity>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  centeredState: {
    alignItems: "center",
    flex: 1,
    gap: Spacing.md,
    justifyContent: "center",
    padding: Spacing.xl,
  },
  title: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 28,
    textAlign: "center",
  },
  stateText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  errorCard: {
    width: "100%",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  primaryButtonText: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
});
