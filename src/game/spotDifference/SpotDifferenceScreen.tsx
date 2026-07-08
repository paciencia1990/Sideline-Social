import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  GestureResponderEvent,
  Image,
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
import {
  playableSpotDifferenceScenes,
  spotDifferenceScenes,
  type SpotDifferencePoint,
  type SpotDifferenceScene,
} from "@/src/game/spotDifference/spotDifferenceScenes";

type SceneSize = {
  width: number;
  height: number;
};

type ImageRect = {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

const ROUND_SECONDS = 90;

export default function SpotDifferenceScreen() {
  const { t } = useTranslation();
  const [usedSceneIds, setUsedSceneIds] = useState<string[]>([]);
  const [currentScene, setCurrentScene] = useState<SpotDifferenceScene | null>(() => selectNextScene([]));
  const [foundIds, setFoundIds] = useState<string[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const [feedback, setFeedback] = useState(t("spot.instructions"));
  const [sceneSize, setSceneSize] = useState<SceneSize>({ width: 0, height: 0 });

  const foundSet = useMemo(() => new Set(foundIds), [foundIds]);
  const differences = currentScene?.differences ?? [];
  const isComplete = currentScene ? foundIds.length === differences.length : false;
  const elapsedSeconds = ROUND_SECONDS - secondsLeft;
  const imageRect = currentScene ? getContainedImageRect(sceneSize, currentScene) : null;

  useEffect(() => {
    if (isComplete || secondsLeft <= 0 || !currentScene) {
      return;
    }

    const timer = setTimeout(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [currentScene, isComplete, secondsLeft]);

  const resetGame = useCallback(() => {
    const nextUsedIds = currentScene ? [...usedSceneIds, currentScene.id] : usedSceneIds;
    const nextScene = selectNextScene(nextUsedIds);

    setFoundIds([]);
    setSecondsLeft(ROUND_SECONDS);
    setFeedback(t("spot.instructions"));
    setCurrentScene(nextScene);
    setUsedSceneIds(nextScene && nextUsedIds.length < playableSpotDifferenceScenes.length ? nextUsedIds : []);
  }, [currentScene, t, usedSceneIds]);

  const handleScenePress = useCallback((event: GestureResponderEvent) => {
    if (isComplete || !currentScene || !imageRect) {
      return;
    }

    const tap = toNormalizedImagePoint(event.nativeEvent.locationX, event.nativeEvent.locationY, imageRect);
    if (!tap) {
      setFeedback(t("spot.missed"));
      return;
    }

    const match = currentScene.differences.find((zone) => isInsideDifference(tap.x, tap.y, zone));
    if (!match) {
      setFeedback(t("spot.missed"));
      return;
    }

    if (foundSet.has(match.id)) {
      setFeedback(t("spot.alreadyFound"));
      return;
    }

    setFoundIds((current) => [...current, match.id]);
    setFeedback(t("spot.found", { label: match.label ?? match.id.replace("difference_", "#") }));
  }, [currentScene, foundSet, imageRect, isComplete, t]);

  if (!currentScene) {
    return (
      <ScreenWrapper>
        <View style={styles.emptyState}>
          <Text style={styles.resultTitle}>Spot the Difference</Text>
          <Text style={styles.resultText}>No valid Spot the Difference scenes are available. Check the scene JSON files in development logs.</Text>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.kicker}>{t("games.spotDifference.title")}</Text>
          <Text style={styles.title}>{currentScene.title}</Text>
          <Text style={styles.subtitle}>{t("spot.subtitle")}</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{t("spot.progress", { found: foundIds.length, total: differences.length })}</Text>
            <Text style={styles.statLabel}>{t("spot.progressLabel")}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{secondsLeft}s</Text>
            <Text style={styles.statLabel}>{t("spot.timer")}</Text>
          </View>
        </View>

        <Text style={styles.instructions}>{feedback}</Text>

        <View style={styles.scenesWrap}>
          <SceneCard scene={currentScene} title={t("spot.original")} variant="original" foundSet={foundSet} imageRect={imageRect} />
          <SceneCard
            scene={currentScene}
            title={t("spot.changed")}
            variant="changed"
            foundSet={foundSet}
            imageRect={imageRect}
            onLayout={(size) => setSceneSize(size)}
            onPress={handleScenePress}
          />
        </View>

        {__DEV__ && currentScene.validationWarnings.length > 0 ? (
          <View style={styles.devPanel}>
            {currentScene.validationWarnings.map((warning) => (
              <Text key={warning} style={styles.devText}>{warning}</Text>
            ))}
          </View>
        ) : null}

        {isComplete ? (
          <View style={styles.resultPanel}>
            <Text style={styles.resultTitle}>{t("spot.completeTitle")}</Text>
            <Text style={styles.resultText}>{t("spot.completeBody", { seconds: elapsedSeconds })}</Text>
            <GameEndActions onPlayAgain={resetGame} lobbyRoute="/(games)/spot-the-difference/Lobby" />
          </View>
        ) : secondsLeft <= 0 ? (
          <View style={styles.resultPanel}>
            <Text style={styles.resultTitle}>{t("spot.timeUpTitle")}</Text>
            <Text style={styles.resultText}>{t("spot.timeUpBody", { found: foundIds.length, total: differences.length })}</Text>
            <GameEndActions onPlayAgain={resetGame} lobbyRoute="/(games)/spot-the-difference/Lobby" />
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function SceneCard({
  foundSet,
  imageRect,
  onLayout,
  onPress,
  scene,
  title,
  variant,
}: {
  foundSet: Set<string>;
  imageRect: ImageRect | null;
  onLayout?: (size: SceneSize) => void;
  onPress?: (event: GestureResponderEvent) => void;
  scene: SpotDifferenceScene;
  title: string;
  variant: "original" | "changed";
}) {
  const image = (
    <View
      style={[styles.scene, { aspectRatio: scene.sourceWidth / scene.sourceHeight }]}
      onLayout={(event) => {
        const { height, width } = event.nativeEvent.layout;
        onLayout?.({ height, width });
      }}
    >
      <Image source={variant === "original" ? scene.imageA : scene.imageB} style={styles.sceneImage} resizeMode="contain" />
      {imageRect ? scene.differences.map((zone) => (
        foundSet.has(zone.id) ? <FoundMarker key={zone.id} zone={zone} imageRect={imageRect} /> : null
      )) : null}
    </View>
  );

  return (
    <View style={styles.sceneCard}>
      <Text style={styles.sceneTitle}>{title}</Text>
      {onPress ? (
        <Pressable onPress={onPress} style={styles.scenePressable}>
          {image}
        </Pressable>
      ) : (
        image
      )}
    </View>
  );
}

function FoundMarker({ imageRect, zone }: { imageRect: ImageRect; zone: SpotDifferencePoint }) {
  const radius = zone.radius * Math.min(imageRect.width, imageRect.height);
  const centerX = imageRect.offsetX + zone.x * imageRect.width;
  const centerY = imageRect.offsetY + zone.y * imageRect.height;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.foundMarker,
        {
          borderRadius: radius,
          height: radius * 2,
          left: centerX - radius,
          top: centerY - radius,
          width: radius * 2,
        },
      ]}
    >
      <Text style={styles.foundMarkerText}>OK</Text>
    </View>
  );
}

function selectNextScene(usedSceneIds: string[]) {
  const availableScenes = playableSpotDifferenceScenes.length > 0 ? playableSpotDifferenceScenes : spotDifferenceScenes.filter((scene) => scene.differences.length > 0);
  const unusedScenes = availableScenes.filter((scene) => !usedSceneIds.includes(scene.id));
  const scenePool = unusedScenes.length > 0 ? unusedScenes : availableScenes;

  if (scenePool.length === 0) {
    return null;
  }

  return scenePool[Math.floor(Math.random() * scenePool.length)];
}

function getContainedImageRect(container: SceneSize, scene: SpotDifferenceScene): ImageRect | null {
  if (!container.width || !container.height) {
    return null;
  }

  const scale = Math.min(container.width / scene.sourceWidth, container.height / scene.sourceHeight);
  const width = scene.sourceWidth * scale;
  const height = scene.sourceHeight * scale;

  return {
    width,
    height,
    offsetX: (container.width - width) / 2,
    offsetY: (container.height - height) / 2,
  };
}

function toNormalizedImagePoint(locationX: number, locationY: number, imageRect: ImageRect) {
  const imageX = locationX - imageRect.offsetX;
  const imageY = locationY - imageRect.offsetY;

  if (imageX < 0 || imageY < 0 || imageX > imageRect.width || imageY > imageRect.height) {
    return null;
  }

  return {
    x: imageX / imageRect.width,
    y: imageY / imageRect.height,
  };
}

function isInsideDifference(tapX: number, tapY: number, zone: SpotDifferencePoint) {
  const distance = Math.hypot(tapX - zone.x, tapY - zone.y);
  return distance <= zone.radius;
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.md,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  emptyState: {
    alignItems: "center",
    flex: 1,
    gap: Spacing.md,
    justifyContent: "center",
    padding: Spacing.xl,
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
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  sceneImage: {
    height: "100%",
    width: "100%",
  },
  foundMarker: {
    alignItems: "center",
    borderColor: Colors.primary,
    borderWidth: 3,
    justifyContent: "center",
    position: "absolute",
  },
  foundMarkerText: {
    color: Colors.primary,
    fontFamily: Typography.bodyBold,
    fontSize: 11,
  },
  devPanel: {
    backgroundColor: Colors.surface,
    borderColor: Colors.primary,
    borderRadius: Radius.card,
    borderWidth: 1,
    gap: 4,
    padding: Spacing.md,
  },
  devText: {
    color: Colors.primary,
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
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