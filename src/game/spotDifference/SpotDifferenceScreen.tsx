import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  type GestureEvent,
  type HandlerStateChangeEvent,
  PanGestureHandler,
  PinchGestureHandler,
  State,
  TapGestureHandler,
  type PanGestureHandlerEventPayload,
  type PinchGestureHandlerEventPayload,
  type TapGestureHandlerEventPayload,
} from "react-native-gesture-handler";
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

type TransformSnapshot = {
  scale: number;
  translateX: number;
  translateY: number;
};

type NormalizedPoint = {
  x: number;
  y: number;
};

type PinchGestureEvent = GestureEvent<PinchGestureHandlerEventPayload>;
type PinchStateEvent = HandlerStateChangeEvent<PinchGestureHandlerEventPayload>;
type PanGestureEvent = GestureEvent<PanGestureHandlerEventPayload>;
type PanStateEvent = HandlerStateChangeEvent<PanGestureHandlerEventPayload>;
type TapStateEvent = HandlerStateChangeEvent<TapGestureHandlerEventPayload>;

type ZoomControls = {
  animatedStyle: {
    transform: ({ translateX: Animated.Value } | { translateY: Animated.Value } | { scale: Animated.Value })[];
  };
  isZoomed: boolean;
  onDoubleTap: (event: TapStateEvent) => void;
  onPanGesture: (event: PanGestureEvent) => void;
  onPanStateChange: (event: PanStateEvent) => void;
  onPinchGesture: (event: PinchGestureEvent) => void;
  onPinchStateChange: (event: PinchStateEvent) => void;
  resetView: () => void;
  transformRef: React.MutableRefObject<TransformSnapshot>;
};

const ROUND_SECONDS = 90;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2;
const PAN_MIN_DISTANCE = 8;
const ZOOM_EPSILON = 0.01;
const RESET_THRESHOLD = 1.02;

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
  const imageRect = currentScene ? calculateContainedImageLayout(sceneSize, currentScene) : null;
  const zoomControls = useSpotDifferenceZoom(currentScene, sceneSize, imageRect);

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

  const handleChangedImageTap = useCallback((event: TapStateEvent) => {
    if (event.nativeEvent.state !== State.ACTIVE || isComplete || !currentScene || !imageRect) {
      return;
    }

    const tap = screenPointToSourcePoint(
      event.nativeEvent.x,
      event.nativeEvent.y,
      sceneSize,
      imageRect,
      zoomControls.transformRef.current,
    );
    if (!tap) {
      setFeedback(t("spot.missed"));
      return;
    }

    const match = currentScene.differences.find((zone) => isInsideDifference(tap, zone));
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
  }, [currentScene, foundSet, imageRect, isComplete, sceneSize, t, zoomControls.transformRef]);

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
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} scrollEnabled={!zoomControls.isZoomed}>
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
        <Text style={styles.zoomHint}>Pinch to zoom. Drag to move. Tap the changed image to select a difference.</Text>

        <View style={styles.zoomToolbar}>
          <TouchableOpacity
            accessibilityLabel="Reset Spot the Difference zoom view"
            activeOpacity={0.82}
            disabled={!zoomControls.isZoomed}
            onPress={zoomControls.resetView}
            style={[styles.resetButton, !zoomControls.isZoomed && styles.resetButtonDisabled]}
          >
            <Text style={[styles.resetButtonText, !zoomControls.isZoomed && styles.resetButtonTextDisabled]}>Reset View</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.scenesWrap}>
          <SceneCard scene={currentScene} title={t("spot.original")} variant="original" foundSet={foundSet} imageRect={imageRect} zoomControls={zoomControls} />
          <SceneCard
            scene={currentScene}
            title={t("spot.changed")}
            variant="changed"
            foundSet={foundSet}
            imageRect={imageRect}
            onLayout={(size) => setSceneSize(size)}
            onTap={handleChangedImageTap}
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

function useSpotDifferenceZoom(scene: SpotDifferenceScene | null, viewport: SceneSize, imageRect: ImageRect | null): ZoomControls {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const viewportRef = useRef<SceneSize>(viewport);
  const imageRectRef = useRef<ImageRect | null>(imageRect);
  const transformRef = useRef<TransformSnapshot>({ scale: 1, translateX: 0, translateY: 0 });
  const pinchStartRef = useRef<TransformSnapshot>({ scale: 1, translateX: 0, translateY: 0 });
  const panStartRef = useRef<TransformSnapshot>({ scale: 1, translateX: 0, translateY: 0 });
  const [isZoomed, setIsZoomed] = useState(false);

  useEffect(() => {
    viewportRef.current = viewport;
    imageRectRef.current = imageRect;
  }, [imageRect, viewport]);

  const setTransform = useCallback((next: TransformSnapshot, options?: { animated?: boolean; clamp?: boolean; updateZoomState?: boolean }) => {
    const shouldClamp = options?.clamp ?? true;
    const committed = shouldClamp ? clampTranslation(next, viewportRef.current, imageRectRef.current) : {
      scale: clamp(next.scale, MIN_ZOOM, MAX_ZOOM),
      translateX: next.translateX,
      translateY: next.translateY,
    };
    transformRef.current = committed;

    if (options?.updateZoomState ?? true) {
      setIsZoomed(committed.scale > MIN_ZOOM + ZOOM_EPSILON);
    }

    if (options?.animated) {
      Animated.parallel([
        Animated.timing(scale, { duration: 180, toValue: committed.scale, useNativeDriver: true }),
        Animated.timing(translateX, { duration: 180, toValue: committed.translateX, useNativeDriver: true }),
        Animated.timing(translateY, { duration: 180, toValue: committed.translateY, useNativeDriver: true }),
      ]).start();
      return;
    }

    scale.setValue(committed.scale);
    translateX.setValue(committed.translateX);
    translateY.setValue(committed.translateY);
  }, [scale, translateX, translateY]);

  const resetView = useCallback(() => {
    const reset = { scale: MIN_ZOOM, translateX: 0, translateY: 0 };
    pinchStartRef.current = reset;
    panStartRef.current = reset;
    setTransform(reset, { animated: true, updateZoomState: true });
  }, [setTransform]);

  useEffect(() => {
    resetView();
  }, [resetView, scene?.id]);

  useEffect(() => {
    setTransform(transformRef.current, { animated: true, updateZoomState: true });
  }, [imageRect?.height, imageRect?.offsetX, imageRect?.offsetY, imageRect?.width, setTransform, viewport.height, viewport.width]);

  const onPinchStateChange = useCallback((event: PinchStateEvent) => {
    if (event.nativeEvent.state === State.BEGAN) {
      pinchStartRef.current = transformRef.current;
      return;
    }

    if (event.nativeEvent.state === State.END || event.nativeEvent.state === State.CANCELLED || event.nativeEvent.state === State.FAILED) {
      const current = transformRef.current;
      if (current.scale <= RESET_THRESHOLD) {
        resetView();
        return;
      }

      const bounded = clampTranslation(current, viewportRef.current, imageRectRef.current);
      pinchStartRef.current = bounded;
      panStartRef.current = bounded;
      setTransform(bounded, { animated: true, updateZoomState: true });
    }
  }, [resetView, setTransform]);

  const onPinchGesture = useCallback((event: PinchGestureEvent) => {
    if (!imageRectRef.current) {
      return;
    }

    const start = pinchStartRef.current;
    const nextScale = clamp(start.scale * event.nativeEvent.scale, MIN_ZOOM, MAX_ZOOM);
    const center = getViewportCenter(viewportRef.current);
    const focalX = event.nativeEvent.focalX || center.x;
    const focalY = event.nativeEvent.focalY || center.y;
    const ratio = nextScale / start.scale;
    const translateXNext = focalX - center.x - ratio * (focalX - center.x - start.translateX);
    const translateYNext = focalY - center.y - ratio * (focalY - center.y - start.translateY);

    setTransform(
      { scale: nextScale, translateX: translateXNext, translateY: translateYNext },
      { clamp: false, updateZoomState: false },
    );
  }, [setTransform]);

  const onPanStateChange = useCallback((event: PanStateEvent) => {
    if (event.nativeEvent.state === State.BEGAN) {
      panStartRef.current = transformRef.current;
      return;
    }

    if (event.nativeEvent.state === State.END || event.nativeEvent.state === State.CANCELLED || event.nativeEvent.state === State.FAILED) {
      const bounded = clampTranslation(transformRef.current, viewportRef.current, imageRectRef.current);
      panStartRef.current = bounded;
      pinchStartRef.current = bounded;
      setTransform(bounded, { animated: true, updateZoomState: true });
    }
  }, [setTransform]);

  const onPanGesture = useCallback((event: PanGestureEvent) => {
    const start = panStartRef.current;
    if (start.scale <= MIN_ZOOM + ZOOM_EPSILON) {
      return;
    }

    setTransform({
      scale: start.scale,
      translateX: start.translateX + event.nativeEvent.translationX,
      translateY: start.translateY + event.nativeEvent.translationY,
    }, { updateZoomState: false });
  }, [setTransform]);

  const onDoubleTap = useCallback((event: TapStateEvent) => {
    if (event.nativeEvent.state !== State.ACTIVE || !imageRectRef.current) {
      return;
    }

    const current = transformRef.current;
    if (current.scale > MIN_ZOOM + ZOOM_EPSILON) {
      resetView();
      return;
    }

    const center = getViewportCenter(viewportRef.current);
    const nextScale = DOUBLE_TAP_ZOOM;
    const translateXNext = event.nativeEvent.x - center.x - nextScale * (event.nativeEvent.x - center.x);
    const translateYNext = event.nativeEvent.y - center.y - nextScale * (event.nativeEvent.y - center.y);
    const next = clampTranslation({ scale: nextScale, translateX: translateXNext, translateY: translateYNext }, viewportRef.current, imageRectRef.current);
    pinchStartRef.current = next;
    panStartRef.current = next;
    setTransform(next, { animated: true, updateZoomState: true });
  }, [resetView, setTransform]);

  return {
    animatedStyle: {
      transform: [{ translateX }, { translateY }, { scale }],
    },
    isZoomed,
    onDoubleTap,
    onPanGesture,
    onPanStateChange,
    onPinchGesture,
    onPinchStateChange,
    resetView,
    transformRef,
  };
}

function SceneCard({
  foundSet,
  imageRect,
  onLayout,
  onTap,
  scene,
  title,
  variant,
  zoomControls,
}: {
  foundSet: Set<string>;
  imageRect: ImageRect | null;
  onLayout?: (size: SceneSize) => void;
  onTap?: (event: TapStateEvent) => void;
  scene: SpotDifferenceScene;
  title: string;
  variant: "original" | "changed";
  zoomControls: ZoomControls;
}) {
  const pinchRef = useRef(null);
  const panRef = useRef(null);
  const doubleTapRef = useRef(null);

  const viewport = (
    <View
      style={[styles.scene, { aspectRatio: scene.sourceWidth / scene.sourceHeight }]}
      onLayout={(event) => {
        const { height, width } = event.nativeEvent.layout;
        onLayout?.({ height, width });
      }}
    >
      <Animated.View style={[styles.transformedSceneContent, zoomControls.animatedStyle]}>
        <Image source={variant === "original" ? scene.imageA : scene.imageB} style={styles.sceneImage} resizeMode="contain" />
        {imageRect ? scene.differences.map((zone) => (
          foundSet.has(zone.id) ? <FoundMarker key={zone.id} zone={zone} imageRect={imageRect} /> : null
        )) : null}
      </Animated.View>
    </View>
  );

  return (
    <View style={styles.sceneCard}>
      <Text style={styles.sceneTitle}>{title}</Text>
      <PinchGestureHandler
        ref={pinchRef}
        simultaneousHandlers={panRef}
        onGestureEvent={zoomControls.onPinchGesture}
        onHandlerStateChange={zoomControls.onPinchStateChange}
      >
        <Animated.View>
          <PanGestureHandler
            ref={panRef}
            enabled={zoomControls.isZoomed}
            minDist={PAN_MIN_DISTANCE}
            simultaneousHandlers={pinchRef}
            onGestureEvent={zoomControls.onPanGesture}
            onHandlerStateChange={zoomControls.onPanStateChange}
          >
            <Animated.View>
              <TapGestureHandler ref={doubleTapRef} numberOfTaps={2} onHandlerStateChange={zoomControls.onDoubleTap}>
                <Animated.View>
                  {onTap ? (
                    <TapGestureHandler numberOfTaps={1} waitFor={doubleTapRef} onHandlerStateChange={onTap}>
                      <Animated.View>{viewport}</Animated.View>
                    </TapGestureHandler>
                  ) : viewport}
                </Animated.View>
              </TapGestureHandler>
            </Animated.View>
          </PanGestureHandler>
        </Animated.View>
      </PinchGestureHandler>
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

function screenPointToSourcePoint(
  locationX: number,
  locationY: number,
  viewport: SceneSize,
  imageRect: ImageRect,
  transform: TransformSnapshot,
): NormalizedPoint | null {
  const center = getViewportCenter(viewport);
  const untransformedX = (locationX - center.x - transform.translateX) / transform.scale + center.x;
  const untransformedY = (locationY - center.y - transform.translateY) / transform.scale + center.y;
  const imageX = untransformedX - imageRect.offsetX;
  const imageY = untransformedY - imageRect.offsetY;

  if (imageX < 0 || imageY < 0 || imageX > imageRect.width || imageY > imageRect.height) {
    return null;
  }

  return {
    x: imageX / imageRect.width,
    y: imageY / imageRect.height,
  };
}

function isInsideDifference(tap: NormalizedPoint, zone: SpotDifferencePoint) {
  const distance = Math.hypot(tap.x - zone.x, tap.y - zone.y);
  return distance <= zone.radius;
}

function clampTranslation(transform: TransformSnapshot, viewport: SceneSize, imageRect: ImageRect | null): TransformSnapshot {
  const nextScale = clamp(transform.scale, MIN_ZOOM, MAX_ZOOM);
  if (!imageRect || nextScale <= MIN_ZOOM + ZOOM_EPSILON) {
    return { scale: MIN_ZOOM, translateX: 0, translateY: 0 };
  }

  const maxTranslateX = Math.max(0, (imageRect.width * nextScale - viewport.width) / 2);
  const maxTranslateY = Math.max(0, (imageRect.height * nextScale - viewport.height) / 2);

  return {
    scale: nextScale,
    translateX: clamp(transform.translateX, -maxTranslateX, maxTranslateX),
    translateY: clamp(transform.translateY, -maxTranslateY, maxTranslateY),
  };
}

function getViewportCenter(viewport: SceneSize) {
  return {
    x: viewport.width / 2,
    y: viewport.height / 2,
  };
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
  zoomToolbar: {
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
  resetButtonDisabled: {
    borderColor: Colors.secondary,
    opacity: 0.55,
  },
  resetButtonText: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
  },
  resetButtonTextDisabled: {
    color: Colors.textPrimary,
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
  scene: {
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  transformedSceneContent: {
    ...StyleSheet.absoluteFillObject,
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