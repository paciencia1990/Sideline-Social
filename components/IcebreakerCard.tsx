import React, { useCallback, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, TouchableOpacity } from "react-native";
import { RefreshCw } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { icebreakerSessionRotation, type IcebreakerQuestion } from "@/constants/icebreakerQuestions";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";

export function IcebreakerCard() {
  const { t } = useTranslation();
  const [question, setQuestion] = useState<IcebreakerQuestion>(
    () => icebreakerSessionRotation.getCurrent(),
  );

  const showNextQuestion = useCallback(() => {
    const nextQuestion = icebreakerSessionRotation.next();
    setQuestion(nextQuestion);
    AccessibilityInfo.announceForAccessibility(t(nextQuestion.translationKey));
  }, [t]);

  return (
    <Card style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("icebreaker.heading")}
      </Text>
      <Text
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
        style={styles.question}
      >
        {t(question.translationKey)}
      </Text>
      <TouchableOpacity
        accessibilityHint={t("icebreaker.newQuestionHint")}
        accessibilityLabel={t("icebreaker.newQuestion")}
        accessibilityRole="button"
        activeOpacity={0.86}
        onPress={showNextQuestion}
        style={styles.button}
      >
        <RefreshCw
          accessibilityElementsHidden
          color={Colors.background}
          importantForAccessibility="no-hide-descendants"
          size={16}
        />
        <Text style={styles.buttonText}>{t("icebreaker.newQuestion")}</Text>
      </TouchableOpacity>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.textHeading,
    gap: Spacing.md,
  },
  heading: {
    color: Colors.background,
    fontFamily: Typography.bodyBold,
    fontSize: 12,
    letterSpacing: 1.8,
    lineHeight: 18,
    textTransform: "uppercase",
  },
  question: {
    color: Colors.background,
    flexShrink: 1,
    fontFamily: Typography.accent,
    fontSize: 24,
    lineHeight: 32,
  },
  button: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: Colors.background,
    borderRadius: Radius.button,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.sm,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  buttonText: {
    color: Colors.background,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
});