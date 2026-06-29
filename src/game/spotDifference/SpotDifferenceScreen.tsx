import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  GestureResponderEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { GameEndActions } from "@/components/GameEndActions";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";

type DifferenceZone = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

type SpotDifferencePuzzle = {
  id: string;
  titleKey: string;
  differences: DifferenceZone[];
};

type SceneSize = {
  width: number;
  height: number;
};

const ROUND_SECONDS = 90;

const PUZZLE: SpotDifferencePuzzle = {
  id: "sideline-warmup",
  titleKey: "spot.puzzleTitle",
  differences: [
    { id: "sun", x: 76, y: 8, width: 16, height: 16, label: "spot.differences.sun" },
    { id: "score", x: 42, y: 13, width: 18, height: 13, label: "spot.differences.score" },
    { id: "ball", x: 59, y: 67, width: 16, height: 14, label: "spot.differences.ball" },
    { id: "bottle", x: 15, y: 61, width: 13, height: 22, label: "spot.differences.bottle" },
    { id: "cone", x: 75, y: 50, width: 13, height: 19, label: "spot.differences.cone" },
  ],
};

export default function SpotDifferenceScreen() {
  const { t } = useTranslation();
  const [foundIds, setFoundIds] = useState<string[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const [feedback, setFeedback] = useState(t("spot.instructions"));
  const [sceneSize, setSceneSize] = useState<SceneSize>({ width: 0, height: 0 });

  const foundSet = useMemo(() => new Set(foundIds), [foundIds]);
  const isComplete = foundIds.length === PUZZLE.differences.length;
  const elapsedSeconds = ROUND_SECONDS - secondsLeft;

  useEffect(() => {
    if (isComplete || secondsLeft <= 0) {
      return;
    }

    const timer = setTimeout(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [isComplete, secondsLeft]);

  const resetGame = useCallback(() => {
    setFoundIds([]);
    setSecondsLeft(ROUND_SECONDS);
    setFeedback(t("spot.instructions"));
  }, [t]);

  const handleScenePress = useCallback((event: GestureResponderEvent) => {
    if (isComplete || !sceneSize.width || !sceneSize.height) {
      return;
    }

    const tapX = (event.nativeEvent.locationX / sceneSize.width) * 100;
    const tapY = (event.nativeEvent.locationY / sceneSize.height) * 100;
    const match = PUZZLE.differences.find((zone) => {
      return tapX >= zone.x && tapX <= zone.x + zone.width && tapY >= zone.y && tapY <= zone.y + zone.height;
    });

    if (!match) {
      setFeedback(t("spot.missed"));
      return;
    }

    if (foundSet.has(match.id)) {
      setFeedback(t("spot.alreadyFound"));
      return;
    }

    setFoundIds((current) => [...current, match.id]);
    setFeedback(t("spot.found", { label: t(match.label) }));
  }, [foundSet, isComplete, sceneSize.height, sceneSize.width, t]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.kicker}>{t("games.spotDifference.title")}</Text>
          <Text style={styles.title}>{t(PUZZLE.titleKey)}</Text>
          <Text style={styles.subtitle}>{t("spot.subtitle")}</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{t("spot.progress", { found: foundIds.length, total: PUZZLE.differences.length })}</Text>
            <Text style={styles.statLabel}>{t("spot.progressLabel")}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{secondsLeft}s</Text>
            <Text style={styles.statLabel}>{t("spot.timer")}</Text>
          </View>
        </View>

        <Text style={styles.instructions}>{feedback}</Text>

        <View style={styles.scenesWrap}>
          <SceneCard title={t("spot.original")} variant="original" foundSet={foundSet} />
          <SceneCard
            title={t("spot.changed")}
            variant="changed"
            foundSet={foundSet}
            onLayout={(size) => setSceneSize(size)}
            onPress={handleScenePress}
          />
        </View>

        {isComplete ? (
          <View style={styles.resultPanel}>
            <Text style={styles.resultTitle}>{t("spot.completeTitle")}</Text>
            <Text style={styles.resultText}>{t("spot.completeBody", { seconds: elapsedSeconds })}</Text>
            <GameEndActions onPlayAgain={resetGame} lobbyRoute="/(games)/spot-the-difference/Lobby" />
          </View>
        ) : secondsLeft <= 0 ? (
          <View style={styles.resultPanel}>
            <Text style={styles.resultTitle}>{t("spot.timeUpTitle")}</Text>
            <Text style={styles.resultText}>{t("spot.timeUpBody", { found: foundIds.length, total: PUZZLE.differences.length })}</Text>
            <GameEndActions onPlayAgain={resetGame} lobbyRoute="/(games)/spot-the-difference/Lobby" />
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function SceneCard({
  foundSet,
  onLayout,
  onPress,
  title,
  variant,
}: {
  foundSet: Set<string>;
  onLayout?: (size: SceneSize) => void;
  onPress?: (event: GestureResponderEvent) => void;
  title: string;
  variant: "original" | "changed";
}) {
  const scene = (
    <View
      style={styles.scene}
      onLayout={(event) => {
        const { height, width } = event.nativeEvent.layout;
        onLayout?.({ height, width });
      }}
    >
      {/* TODO: Swap this built-in scalable scene for final Spot the Difference artwork when assets are available. */}
      <View style={styles.sky} />
      {variant === "original" ? <View style={styles.sun} /> : null}
      <View style={styles.field} />
      <View style={styles.sideline} />
      <View style={styles.cloudLeft} />
      <View style={styles.cloudRight} />
      <View style={styles.scoreboard}>
        <Text style={styles.scoreText}>{variant === "original" ? "2-1" : "3-1"}</Text>
      </View>
      <View style={styles.bleachers}>
        <View style={styles.bleacherRow} />
        <View style={styles.bleacherRow} />
        <View style={styles.bleacherRow} />
      </View>
      <View style={[styles.player, styles.playerOne]} />
      <View style={[styles.player, styles.playerTwo]} />
      <View style={[styles.ball, variant === "original" ? styles.ballOriginal : styles.ballChanged]} />
      {variant === "changed" ? <View style={styles.waterBottle} /> : null}
      {variant === "changed" ? <View style={styles.cone} /> : null}
      {PUZZLE.differences.map((zone) => (
        foundSet.has(zone.id) ? <FoundMarker key={zone.id} zone={zone} /> : null
      ))}
    </View>
  );

  return (
    <View style={styles.sceneCard}>
      <Text style={styles.sceneTitle}>{title}</Text>
      {onPress ? (
        <Pressable onPress={onPress} style={styles.scenePressable}>
          {scene}
        </Pressable>
      ) : (
        scene
      )}
    </View>
  );
}

function FoundMarker({ zone }: { zone: DifferenceZone }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.foundMarker,
        {
          height: `${zone.height}%`,
          left: `${zone.x}%`,
          top: `${zone.y}%`,
          width: `${zone.width}%`,
        },
      ]}
    >
      <Text style={styles.foundMarkerText}>OK</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.md,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  header: {
    alignItems: "center",
    gap: Spacing.xs,
  },
  kicker: {
    color: Colors.primary,
    fontFamily: Typography.bodyBold,
    fontSize: 12,
    textTransform: "uppercase",
  },
  title: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 30,
    textAlign: "center",
  },
  subtitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    lineHeight: 21,
    textAlign: "center",
  },
  statsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  statCard: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: Radius.card,
    borderWidth: 1,
    flex: 1,
    padding: Spacing.md,
    ...Shadow.card,
  },
  statValue: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 18,
  },
  statLabel: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    marginTop: 2,
  },
  instructions: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    lineHeight: 21,
    textAlign: "center",
  },
  scenesWrap: {
    gap: Spacing.md,
  },
  sceneCard: {
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: Radius.card,
    borderWidth: 1,
    gap: Spacing.sm,
    padding: Spacing.sm,
    ...Shadow.card,
  },
  sceneTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    textAlign: "center",
  },
  scenePressable: {
    borderRadius: Radius.sm,
  },
  scene: {
    aspectRatio: 1.62,
    backgroundColor: "#BFDCEC",
    borderRadius: Radius.sm,
    minHeight: 205,
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  sky: {
    backgroundColor: "#BFDCEC",
    height: "56%",
    width: "100%",
  },
  sun: {
    backgroundColor: Colors.accentGold,
    borderRadius: 16,
    height: 32,
    position: "absolute",
    right: "10%",
    top: "7%",
    width: 32,
  },
  field: {
    backgroundColor: Colors.accentGreen,
    bottom: 0,
    height: "47%",
    left: 0,
    position: "absolute",
    right: 0,
  },
  sideline: {
    backgroundColor: Colors.surface,
    bottom: "23%",
    height: 4,
    left: "8%",
    position: "absolute",
    right: "8%",
  },
  cloudLeft: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    height: 28,
    left: "10%",
    opacity: 0.88,
    position: "absolute",
    top: "12%",
    width: 82,
  },
  cloudRight: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    height: 22,
    left: "25%",
    opacity: 0.85,
    position: "absolute",
    top: "20%",
    width: 58,
  },
  scoreboard: {
    alignItems: "center",
    backgroundColor: Colors.textHeading,
    borderColor: Colors.secondary,
    borderRadius: 4,
    borderWidth: 2,
    height: "13%",
    justifyContent: "center",
    left: "42%",
    position: "absolute",
    top: "12%",
    width: "18%",
  },
  scoreText: {
    color: Colors.surface,
    fontFamily: Typography.bodyBold,
    fontSize: 14,
  },
  bleachers: {
    gap: 5,
    left: "9%",
    position: "absolute",
    top: "38%",
    width: "28%",
  },
  bleacherRow: {
    backgroundColor: Colors.secondary,
    borderRadius: 3,
    height: 7,
  },
  player: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    height: 24,
    position: "absolute",
    width: 24,
  },
  playerOne: {
    bottom: "28%",
    left: "42%",
  },
  playerTwo: {
    bottom: "34%",
    right: "22%",
  },
  ball: {
    backgroundColor: Colors.surface,
    borderColor: Colors.textHeading,
    borderRadius: 9,
    borderWidth: 2,
    height: 18,
    position: "absolute",
    width: 18,
  },
  ballOriginal: {
    bottom: "18%",
    left: "50%",
  },
  ballChanged: {
    bottom: "24%",
    left: "63%",
  },
  waterBottle: {
    backgroundColor: "#2563EB",
    borderRadius: 4,
    bottom: "17%",
    height: 36,
    left: "18%",
    position: "absolute",
    width: 14,
  },
  cone: {
    borderBottomColor: Colors.primary,
    borderBottomWidth: 36,
    borderLeftColor: "transparent",
    borderLeftWidth: 15,
    borderRightColor: "transparent",
    borderRightWidth: 15,
    bottom: "30%",
    height: 0,
    position: "absolute",
    right: "12%",
    width: 0,
  },
  foundMarker: {
    alignItems: "center",
    borderColor: Colors.primary,
    borderRadius: 999,
    borderWidth: 3,
    justifyContent: "center",
    position: "absolute",
  },
  foundMarkerText: {
    color: Colors.primary,
    fontFamily: Typography.bodyBold,
    fontSize: 11,
  },
  resultPanel: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: Radius.card,
    borderWidth: 1,
    gap: Spacing.md,
    padding: Spacing.lg,
    ...Shadow.card,
  },
  resultTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 25,
    textAlign: "center",
  },
  resultText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    lineHeight: 21,
    textAlign: "center",
  },
});