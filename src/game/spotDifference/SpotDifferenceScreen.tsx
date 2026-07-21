import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { GameEndActions } from "@/components/GameEndActions";
import { GameRewardSummary } from "@/components/GameRewardSummary";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useSquad } from "@/context/SquadContext";
import {
  createGameRewardSession,
  finalizeGameReward,
  recordGameSessionResult,
  type GameRewardResult,
} from "@/services/sidelineStarsService";
import { recordSpotDifferenceFound, updateGameJoinCodeStatus } from "@/services/gameJoinCodeService";
import { subscribeToSession } from "@/services/gameService";
import {
  playableSpotDifferenceScenes,
  spotDifferenceScenes,
  type SpotDifferencePoint,
  type SpotDifferenceScene,
} from "@/src/game/spotDifference/spotDifferenceScenes";
import {
  clampSpotDifferenceTranslation,
  screenPointToSourcePoint,
  type ImageRect,
  type NormalizedPoint,
  type SceneSize,
  type TransformSnapshot,
} from "@/src/game/spotDifference/geometry";

type ImageSide = "A" | "B";

type SceneLayouts = Record<ImageSide, SceneSize>;

type TapPoint = { x: number; y: number };
type NativeScrollGesture = ReturnType<typeof Gesture.Native>;

type ZoomControls = {
  animatedStyle: ReturnType<typeof useAnimatedStyle>;
  imageHeight: SharedValue<number>;
  imageOffsetX: SharedValue<number>;
  imageOffsetY: SharedValue<number>;
  imageWidth: SharedValue<number>;
  isZoomed: boolean;
  panStartTranslateX: SharedValue<number>;
  panStartTranslateY: SharedValue<number>;
  pinchStartScale: SharedValue<number>;
  pinchStartTranslateX: SharedValue<number>;
  pinchStartTranslateY: SharedValue<number>;
  resetView: (animated?: boolean) => void;
  roundEnded: SharedValue<boolean>;
  scale: SharedValue<number>;
  setZoomedFromGesture: (zoomed: boolean) => void;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  viewportHeight: SharedValue<number>;
  viewportWidth: SharedValue<number>;
};

const ROUND_SECONDS = 90;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const PAN_MIN_DISTANCE = 8;
const ZOOM_EPSILON = 0.01;
const RESET_THRESHOLD = 1.02;
const FOUND_MARKER_RADIUS_SCALE = 0.4;
const MIN_FOUND_MARKER_RADIUS = 10;
const MAX_FOUND_MARKER_RADIUS = 16;

export default function SpotDifferenceScreen() {
  const { t } = useTranslation();
  const { currentSquad } = useSquad();
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const requestedSessionId = normalizeRouteParam(params.sessionId);
  const [usedSceneIds, setUsedSceneIds] = useState<string[]>([]);
  const [currentScene, setCurrentScene] = useState<SpotDifferenceScene | null>(() => selectNextScene([]));
  const [foundIds, setFoundIds] = useState<string[]>([]);
  const [roundInstance, setRoundInstance] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const [feedback, setFeedback] = useState(t("spot.instructions"));
  const [rewardSessionId, setRewardSessionId] = useState("");
  const [rewardSetupAttempt, setRewardSetupAttempt] = useState(0);
  const [rewardResult, setRewardResult] = useState<GameRewardResult | null>(null);
  const [rewardLoading, setRewardLoading] = useState(false);
  const [rewardError, setRewardError] = useState<string | null>(null);
  const finalizedRewardKeyRef = useRef("");
  const lifecycleEndedRef = useRef("");
  const [sceneLayouts, setSceneLayouts] = useState<SceneLayouts>({
    A: { width: 0, height: 0 },
    B: { width: 0, height: 0 },
  });

  const foundSet = useMemo(() => new Set(foundIds), [foundIds]);
  const differences = currentScene?.differences ?? [];
  const isComplete = currentScene ? foundIds.length === differences.length : false;
  const elapsedSeconds = ROUND_SECONDS - secondsLeft;
  const imageRects = useMemo(() => ({
    A: currentScene ? calculateContainedImageLayout(sceneLayouts.A, currentScene) : null,
    B: currentScene ? calculateContainedImageLayout(sceneLayouts.B, currentScene) : null,
  }), [currentScene, sceneLayouts.A, sceneLayouts.B]);
  const zoomViewport = sceneLayouts.B.width && sceneLayouts.B.height ? sceneLayouts.B : sceneLayouts.A;
  const zoomImageRect = imageRects.B ?? imageRects.A;
  const zoomControls = useSpotDifferenceZoom(currentScene, zoomViewport, zoomImageRect, secondsLeft, foundIds.length, differences.length, roundInstance);
  const resetZoomView = zoomControls.resetView;
  const scrollGesture = useMemo(() => Gesture.Native(), []);

  useEffect(() => {
    if (!requestedSessionId) return;
    return subscribeToSession(requestedSessionId, (session) => {
      if (!session) return;
      const sceneId = typeof session.gameState?.sceneId === "string" ? session.gameState.sceneId : "";
      const sharedScene = spotDifferenceScenes.find((scene) => scene.id === sceneId) ?? null;
      if (sharedScene) setCurrentScene((current) => current?.id === sharedScene.id ? current : sharedScene);
      const sharedFoundIds = Array.isArray(session.gameState?.foundDifferenceIds)
        ? session.gameState.foundDifferenceIds.filter((value): value is string => typeof value === "string")
        : [];
      setFoundIds(sharedFoundIds);
      if (typeof session.startedAt === "number") {
        const remaining = Math.max(0, ROUND_SECONDS - Math.floor((Date.now() - session.startedAt) / 1000));
        setSecondsLeft((current) => Math.min(current, remaining));
      }
    });
  }, [requestedSessionId]);

  useFocusEffect(useCallback(() => () => {
    resetZoomView(false);
  }, [resetZoomView]));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") resetZoomView(false);
    });
    return () => subscription.remove();
  }, [resetZoomView]);

  useEffect(() => {
    let active = true;
    setRewardSessionId("");
    setRewardResult(null);
    setRewardError(null);
    finalizedRewardKeyRef.current = "";
    void createGameRewardSession({
      gameType: "spotDifferences",
      sessionId: roundInstance === 0 ? requestedSessionId || null : null,
      sourceSquadId: currentSquad?.squadId ?? null,
    }).then((created) => {
      if (active) setRewardSessionId(created.sessionId);
    }).catch(() => {
      if (active) setRewardError(t("rewards.awardError"));
    });
    return () => { active = false; };
  }, [currentSquad?.squadId, requestedSessionId, rewardSetupAttempt, roundInstance, t]);

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
    setRoundInstance((value) => value + 1);
    setSecondsLeft(ROUND_SECONDS);
    setFeedback(t("spot.instructions"));
    setCurrentScene(nextScene);
    setUsedSceneIds(nextScene && nextUsedIds.length < playableSpotDifferenceScenes.length ? nextUsedIds : []);
  }, [currentScene, t, usedSceneIds]);

  const awardCurrentResult = useCallback(async () => {
    if (!rewardSessionId || (!isComplete && secondsLeft > 0)) return;
    const rewardKey = `${rewardSessionId}:${isComplete ? "completed" : "timeExpired"}`;
    if (finalizedRewardKeyRef.current === rewardKey && rewardResult) return;
    finalizedRewardKeyRef.current = rewardKey;
    setRewardLoading(true);
    setRewardError(null);
    try {
      await recordGameSessionResult({
        gameType: "spotDifferences",
        sessionId: rewardSessionId,
        outcome: isComplete ? "completed" : "timeExpired",
        foundCount: foundIds.length,
        totalDifferences: differences.length,
      });
      setRewardResult(await finalizeGameReward("spotDifferences", rewardSessionId));
    } catch {
      finalizedRewardKeyRef.current = "";
      setRewardError(t("rewards.awardError"));
    } finally {
      setRewardLoading(false);
    }
  }, [differences.length, foundIds.length, isComplete, rewardResult, rewardSessionId, secondsLeft, t]);

  useEffect(() => {
    if (rewardSessionId && (isComplete || secondsLeft <= 0)) void awardCurrentResult();
  }, [awardCurrentResult, isComplete, rewardSessionId, secondsLeft]);

  useEffect(() => {
    if (!requestedSessionId || (!isComplete && secondsLeft > 0) || lifecycleEndedRef.current === requestedSessionId) return;
    lifecycleEndedRef.current = requestedSessionId;
    void updateGameJoinCodeStatus({
      gameType: "spotTheDifferences",
      sessionId: requestedSessionId,
      status: "ended",
    }).catch(() => undefined);
  }, [isComplete, requestedSessionId, secondsLeft]);

  const handlePlayAgain = useCallback(() => {
    if (requestedSessionId) {
      router.replace({ pathname: "/(games)/spot-the-difference/Lobby", params: { host: "1" } } as never);
      return;
    }
    resetGame();
  }, [requestedSessionId, resetGame]);

  const handleSceneLayout = useCallback((side: ImageSide, size: SceneSize) => {
    setSceneLayouts((current) => {
      const previous = current[side];
      if (previous.width === size.width && previous.height === size.height) {
        return current;
      }

      return { ...current, [side]: size };
    });
  }, []);

  const handleImageTap = useCallback((imageSide: ImageSide, point: TapPoint, transform: TransformSnapshot) => {
    if (isComplete || !currentScene) {
      return;
    }

    const localX = point.x;
    const localY = point.y;
    const viewport = sceneLayouts[imageSide];
    const imageRect = imageRects[imageSide];
    if (!imageRect) {
      return;
    }

    const tap = screenPointToSourcePoint(
      localX,
      localY,
      viewport,
      imageRect,
      transform,
    );
    if (!tap) {
      setFeedback(t("spot.missed"));
      return;
    }

    const match = findDifferenceAtPoint(currentScene.differences, tap);
    if (!match) {
      setFeedback(t("spot.missed"));
      return;
    }

    if (foundSet.has(match.id)) {
      setFeedback(t("spot.alreadyFound"));
      return;
    }

    setFoundIds((current) => [...current, match.id]);
    if (requestedSessionId) {
      void recordSpotDifferenceFound({ sessionId: requestedSessionId, differenceId: match.id }).catch(() => undefined);
    }
    setFeedback(t("spot.found", { label: match.label ?? match.id.replace("difference_", "#") }));
  }, [currentScene, foundSet, imageRects, isComplete, requestedSessionId, sceneLayouts, t]);

  if (!currentScene) {
    return (
      <ScreenWrapper>
        <View style={styles.emptyState}>
          <Text style={styles.resultTitle}>Spot the Differences</Text>
          <Text style={styles.resultText}>No valid Spot the Differences scenes are available. Check the scene JSON files in development logs.</Text>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <GestureDetector gesture={scrollGesture}>
        <ScrollView
          contentContainerStyle={styles.content}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
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
        <Text style={styles.zoomHint}>{t("spot.zoomHint")}</Text>

        {zoomControls.isZoomed ? (
          <View style={styles.resetToolbar}>
            <TouchableOpacity
              accessibilityLabel="Reset image view"
              activeOpacity={0.82}
              onPress={() => zoomControls.resetView()}
              style={styles.resetButton}
            >
              <Text style={styles.resetButtonText}>Reset View</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.scenesWrap}>
          <SceneCard
            scene={currentScene}
            title={t("spot.original")}
            variant="A"
            foundSet={foundSet}
            imageRect={imageRects.A}
            onLayout={(size) => handleSceneLayout("A", size)}
            onTap={handleImageTap}
            scrollGesture={scrollGesture}
            zoomControls={zoomControls}
          />
          <SceneCard
            scene={currentScene}
            title={t("spot.changed")}
            variant="B"
            foundSet={foundSet}
            imageRect={imageRects.B}
            onLayout={(size) => handleSceneLayout("B", size)}
            onTap={handleImageTap}
            scrollGesture={scrollGesture}
            zoomControls={zoomControls}
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
            <GameRewardSummary
              detailLines={[
                t("rewards.differencesFound", { found: foundIds.length, total: differences.length }),
                t("rewards.completionStars", { count: 5 }),
              ]}
              error={rewardError}
              loading={rewardLoading}
              onRetry={() => rewardSessionId ? void awardCurrentResult() : setRewardSetupAttempt((value) => value + 1)}
              result={rewardResult}
            />
            <GameEndActions onPlayAgain={handlePlayAgain} lobbyRoute="/(games)/spot-the-difference/Lobby" />
          </View>
        ) : secondsLeft <= 0 ? (
          <View style={styles.resultPanel}>
            <Text style={styles.resultTitle}>{t("spot.timeUpTitle")}</Text>
            <Text style={styles.resultText}>{t("spot.timeUpBody", { found: foundIds.length, total: differences.length })}</Text>
            <GameRewardSummary
              detailLines={[
                t("rewards.differencesFound", { found: foundIds.length, total: differences.length }),
                t("rewards.completionStars", { count: 5 }),
              ]}
              error={rewardError}
              loading={rewardLoading}
              onRetry={() => rewardSessionId ? void awardCurrentResult() : setRewardSetupAttempt((value) => value + 1)}
              result={rewardResult}
            />
            <GameEndActions onPlayAgain={handlePlayAgain} lobbyRoute="/(games)/spot-the-difference/Lobby" />
          </View>
        ) : null}
        </ScrollView>
      </GestureDetector>
    </ScreenWrapper>
  );
}

function normalizeRouteParam(value?: string | string[]) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? "";
}

function useSpotDifferenceZoom(scene: SpotDifferenceScene | null, viewport: SceneSize, imageRect: ImageRect | null, secondsLeft: number, foundCount: number, totalDifferences: number, roundInstance: number): ZoomControls {
  const scale = useSharedValue(MIN_ZOOM);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const pinchStartScale = useSharedValue(MIN_ZOOM);
  const pinchStartTranslateX = useSharedValue(0);
  const pinchStartTranslateY = useSharedValue(0);
  const panStartTranslateX = useSharedValue(0);
  const panStartTranslateY = useSharedValue(0);
  const viewportWidth = useSharedValue(viewport.width);
  const viewportHeight = useSharedValue(viewport.height);
  const imageWidth = useSharedValue(imageRect?.width ?? 0);
  const imageHeight = useSharedValue(imageRect?.height ?? 0);
  const imageOffsetX = useSharedValue(imageRect?.offsetX ?? 0);
  const imageOffsetY = useSharedValue(imageRect?.offsetY ?? 0);
  const roundEnded = useSharedValue(false);
  const automaticResetForRoundRef = useRef(false);
  const previousFoundCountRef = useRef(foundCount);
  const previousSecondsLeftRef = useRef(secondsLeft);
  const [isZoomed, setIsZoomed] = useState(false);

  const setZoomedFromGesture = useCallback((zoomed: boolean) => {
    setIsZoomed(zoomed);
  }, []);

  const resetView = useCallback((animated = true) => {
    cancelAnimation(scale);
    cancelAnimation(translateX);
    cancelAnimation(translateY);

    scale.value = animated ? withTiming(MIN_ZOOM, { duration: 180 }) : MIN_ZOOM;
    translateX.value = animated ? withTiming(0, { duration: 180 }) : 0;
    translateY.value = animated ? withTiming(0, { duration: 180 }) : 0;
    pinchStartScale.value = MIN_ZOOM;
    pinchStartTranslateX.value = 0;
    pinchStartTranslateY.value = 0;
    panStartTranslateX.value = 0;
    panStartTranslateY.value = 0;
    setIsZoomed(false);
  }, [panStartTranslateX, panStartTranslateY, pinchStartScale, pinchStartTranslateX, pinchStartTranslateY, scale, translateX, translateY]);

  useEffect(() => {
    automaticResetForRoundRef.current = false;
    previousFoundCountRef.current = 0;
    previousSecondsLeftRef.current = ROUND_SECONDS;
    roundEnded.value = false;
    resetView(false);
  }, [resetView, roundEnded, roundInstance, scene?.id]);

  const resetViewForRoundEnd = useCallback(() => {
    if (automaticResetForRoundRef.current) {
      return;
    }

    automaticResetForRoundRef.current = true;
    roundEnded.value = true;
    resetView(false);
  }, [resetView, roundEnded]);

  useEffect(() => {
    const timerJustExpired = previousSecondsLeftRef.current > 0 && secondsLeft === 0;
    const roundJustCompleted = totalDifferences > 0 && previousFoundCountRef.current < totalDifferences && foundCount >= totalDifferences;

    if (timerJustExpired || roundJustCompleted) {
      resetViewForRoundEnd();
    }

    previousFoundCountRef.current = foundCount;
    previousSecondsLeftRef.current = secondsLeft;
  }, [foundCount, resetViewForRoundEnd, secondsLeft, totalDifferences]);

  useEffect(() => {
    viewportWidth.value = viewport.width;
    viewportHeight.value = viewport.height;
    imageWidth.value = imageRect?.width ?? 0;
    imageHeight.value = imageRect?.height ?? 0;
    imageOffsetX.value = imageRect?.offsetX ?? 0;
    imageOffsetY.value = imageRect?.offsetY ?? 0;

    const bounded = clampSpotDifferenceTranslation(
      { scale: scale.value, translateX: translateX.value, translateY: translateY.value },
      viewport,
      imageRect,
      MIN_ZOOM,
      MAX_ZOOM,
      ZOOM_EPSILON,
    );
    scale.value = withTiming(bounded.scale, { duration: 180 });
    translateX.value = withTiming(bounded.translateX, { duration: 180 });
    translateY.value = withTiming(bounded.translateY, { duration: 180 });
    setIsZoomed(bounded.scale > MIN_ZOOM + ZOOM_EPSILON);
  }, [imageHeight, imageOffsetX, imageOffsetY, imageRect, imageWidth, scale, translateX, translateY, viewport, viewportHeight, viewportWidth]);

  useEffect(() => () => {
    cancelAnimation(scale);
    cancelAnimation(translateX);
    cancelAnimation(translateY);
    scale.value = MIN_ZOOM;
    translateX.value = 0;
    translateY.value = 0;
  }, [scale, translateX, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return {
    animatedStyle,
    imageHeight,
    imageOffsetX,
    imageOffsetY,
    imageWidth,
    isZoomed,
    panStartTranslateX,
    panStartTranslateY,
    pinchStartScale,
    pinchStartTranslateX,
    pinchStartTranslateY,
    resetView,
    roundEnded,
    scale,
    setZoomedFromGesture,
    translateX,
    translateY,
    viewportHeight,
    viewportWidth,
  };
}

function SceneCard({
  foundSet,
  imageRect,
  onLayout,
  onTap,
  scene,
  scrollGesture,
  title,
  variant,
  zoomControls,
}: {
  foundSet: Set<string>;
  imageRect: ImageRect | null;
  onLayout?: (size: SceneSize) => void;
  onTap: (imageSide: ImageSide, point: TapPoint, transform: TransformSnapshot) => void;
  scene: SpotDifferenceScene;
  scrollGesture: NativeScrollGesture;
  title: string;
  variant: ImageSide;
  zoomControls: ZoomControls;
}) {
  const {
    imageHeight,
    imageOffsetX,
    imageOffsetY,
    imageWidth,
    panStartTranslateX,
    panStartTranslateY,
    pinchStartScale,
    pinchStartTranslateX,
    pinchStartTranslateY,
    roundEnded,
    scale,
    setZoomedFromGesture,
    translateX,
    translateY,
    viewportHeight,
    viewportWidth,
  } = zoomControls;
  const panStartScale = useSharedValue(MIN_ZOOM);
  const panTouchStartX = useSharedValue(0);
  const panTouchStartY = useSharedValue(0);
  const tapBlockedByMultitouch = useSharedValue(false);
  const composedGesture = useMemo(() => {
    const settleTransform = () => {
      "worklet";
      if (roundEnded.value) return;

      if (scale.value <= RESET_THRESHOLD) {
        scale.value = withTiming(MIN_ZOOM, { duration: 180 });
        translateX.value = withTiming(0, { duration: 180 });
        translateY.value = withTiming(0, { duration: 180 });
        pinchStartScale.value = MIN_ZOOM;
        pinchStartTranslateX.value = 0;
        pinchStartTranslateY.value = 0;
        panStartTranslateX.value = 0;
        panStartTranslateY.value = 0;
        runOnJS(setZoomedFromGesture)(false);
        return;
      }

      const bounded = clampSpotDifferenceTranslation(
        { scale: scale.value, translateX: translateX.value, translateY: translateY.value },
        { width: viewportWidth.value, height: viewportHeight.value },
        imageWidth.value > 0 && imageHeight.value > 0 ? {
          width: imageWidth.value,
          height: imageHeight.value,
          offsetX: imageOffsetX.value,
          offsetY: imageOffsetY.value,
        } : null,
        MIN_ZOOM,
        MAX_ZOOM,
        ZOOM_EPSILON,
      );
      scale.value = withTiming(bounded.scale, { duration: 180 });
      translateX.value = withTiming(bounded.translateX, { duration: 180 });
      translateY.value = withTiming(bounded.translateY, { duration: 180 });
      pinchStartScale.value = bounded.scale;
      pinchStartTranslateX.value = bounded.translateX;
      pinchStartTranslateY.value = bounded.translateY;
      panStartTranslateX.value = bounded.translateX;
      panStartTranslateY.value = bounded.translateY;
      runOnJS(setZoomedFromGesture)(bounded.scale > MIN_ZOOM + ZOOM_EPSILON);
    };

    const pinch = Gesture.Pinch()
      .blocksExternalGesture(scrollGesture)
      .onBegin(() => {
        tapBlockedByMultitouch.value = true;
      })
      .onStart(() => {
        if (roundEnded.value) return;
        cancelAnimation(scale);
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        pinchStartScale.value = scale.value;
        pinchStartTranslateX.value = translateX.value;
        pinchStartTranslateY.value = translateY.value;
      })
      .onUpdate((event) => {
        if (roundEnded.value || imageWidth.value <= 0 || imageHeight.value <= 0) return;
        const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStartScale.value * event.scale));
        const centerX = viewportWidth.value / 2;
        const centerY = viewportHeight.value / 2;
        const focalX = Number.isFinite(event.focalX) ? event.focalX : centerX;
        const focalY = Number.isFinite(event.focalY) ? event.focalY : centerY;
        const ratio = nextScale / pinchStartScale.value;

        scale.value = nextScale;
        translateX.value = focalX - centerX - ratio * (focalX - centerX - pinchStartTranslateX.value);
        translateY.value = focalY - centerY - ratio * (focalY - centerY - pinchStartTranslateY.value);
      })
      .onFinalize(settleTransform);
    const pan = Gesture.Pan()
      .maxPointers(1)
      .manualActivation(true)
      .blocksExternalGesture(scrollGesture)
      .onTouchesDown((event, state) => {
        if (roundEnded.value || scale.value <= MIN_ZOOM + ZOOM_EPSILON) {
          state.fail();
          return;
        }
        const touch = event.allTouches[0];
        if (!touch) {
          state.fail();
          return;
        }
        panTouchStartX.value = touch.x;
        panTouchStartY.value = touch.y;
      })
      .onTouchesMove((event, state) => {
        if (scale.value <= MIN_ZOOM + ZOOM_EPSILON) {
          state.fail();
          return;
        }
        const touch = event.allTouches[0];
        if (!touch) return;
        const distance = Math.hypot(
          touch.x - panTouchStartX.value,
          touch.y - panTouchStartY.value,
        );
        if (distance >= PAN_MIN_DISTANCE) state.activate();
      })
      .onStart(() => {
        cancelAnimation(scale);
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        panStartScale.value = scale.value;
        panStartTranslateX.value = translateX.value;
        panStartTranslateY.value = translateY.value;
      })
      .onUpdate((event) => {
        if (roundEnded.value || panStartScale.value <= MIN_ZOOM + ZOOM_EPSILON) return;
        scale.value = panStartScale.value;
        translateX.value = panStartTranslateX.value + event.translationX;
        translateY.value = panStartTranslateY.value + event.translationY;
      })
      .onFinalize((_event, success) => {
        if (success) settleTransform();
      });
    const singleTap = Gesture.Tap()
      .maxDistance(PAN_MIN_DISTANCE)
      .maxDuration(300)
      .simultaneousWithExternalGesture(scrollGesture)
      .onTouchesDown((event) => {
        tapBlockedByMultitouch.value = event.allTouches.length > 1;
      })
      .onEnd((event, success) => {
        if (!success || roundEnded.value || tapBlockedByMultitouch.value) return;
        runOnJS(onTap)(
          variant,
          { x: event.x, y: event.y },
          { scale: scale.value, translateX: translateX.value, translateY: translateY.value },
        );
      });

    return Gesture.Simultaneous(pinch, pan, singleTap);
  }, [
    imageHeight,
    imageOffsetX,
    imageOffsetY,
    imageWidth,
    onTap,
    panStartScale,
    panStartTranslateX,
    panStartTranslateY,
    panTouchStartX,
    panTouchStartY,
    pinchStartScale,
    pinchStartTranslateX,
    pinchStartTranslateY,
    roundEnded,
    scale,
    scrollGesture,
    setZoomedFromGesture,
    tapBlockedByMultitouch,
    translateX,
    translateY,
    variant,
    viewportHeight,
    viewportWidth,
  ]);

  const viewport = (
    <View
      style={[styles.scene, { aspectRatio: scene.sourceWidth / scene.sourceHeight }]}
      onLayout={(event) => {
        const { height, width } = event.nativeEvent.layout;
        onLayout?.({ height, width });
      }}
    >
      <Animated.View style={[styles.transformedSceneContent, zoomControls.animatedStyle]}>
        <Image source={variant === "A" ? scene.imageA : scene.imageB} style={styles.sceneImage} resizeMode="contain" />
        {imageRect ? scene.differences.map((zone) => (
          foundSet.has(zone.id) ? <FoundMarker key={zone.id} zone={zone} imageRect={imageRect} /> : null
        )) : null}
      </Animated.View>
    </View>
  );

  return (
    <View style={styles.sceneCard}>
      <Text style={styles.sceneTitle}>{title}</Text>
      <GestureDetector gesture={composedGesture}>
        <Animated.View collapsable={false} style={styles.gestureLayer}>
          {viewport}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function FoundMarker({ imageRect, zone }: { imageRect: ImageRect; zone: SpotDifferencePoint }) {
  const hitRadius = zone.radius * Math.min(imageRect.width, imageRect.height);
  const radius = clamp(hitRadius * FOUND_MARKER_RADIUS_SCALE, MIN_FOUND_MARKER_RADIUS, MAX_FOUND_MARKER_RADIUS);
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
    />
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

function calculateContainedImageLayout(container: SceneSize, scene: SpotDifferenceScene): ImageRect | null {
  if (!container.width || !container.height) {
    return null;
  }

  const baseImageScale = Math.min(container.width / scene.sourceWidth, container.height / scene.sourceHeight);
  const width = scene.sourceWidth * baseImageScale;
  const height = scene.sourceHeight * baseImageScale;

  return {
    width,
    height,
    offsetX: (container.width - width) / 2,
    offsetY: (container.height - height) / 2,
  };
}

function findDifferenceAtPoint(differences: SpotDifferencePoint[], tap: NormalizedPoint) {
  return differences.find((zone) => isInsideDifference(tap, zone));
}

function isInsideDifference(tap: NormalizedPoint, zone: SpotDifferencePoint) {
  const distance = Math.hypot(tap.x - zone.x, tap.y - zone.y);
  return distance <= zone.radius;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
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
  zoomHint: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: -Spacing.sm,
    textAlign: "center",
  },
  resetToolbar: {
    alignItems: "flex-end",
  },
  resetButton: {
    alignItems: "center",
    borderColor: Colors.primary,
    borderRadius: Radius.button,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 112,
    paddingHorizontal: Spacing.md,
  },

  resetButtonText: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
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
  gestureLayer: {
    width: "100%",
  },
  scene: {
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  transformedSceneContent: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  sceneImage: {
    height: "100%",
    width: "100%",
  },
  foundMarker: {
    borderColor: Colors.primary,
    borderWidth: 2,
    position: "absolute",
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
