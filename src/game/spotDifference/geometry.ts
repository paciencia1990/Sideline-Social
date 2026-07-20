export type SceneSize = {
  width: number;
  height: number;
};

export type ImageRect = SceneSize & {
  offsetX: number;
  offsetY: number;
};

export type TransformSnapshot = {
  scale: number;
  translateX: number;
  translateY: number;
};

export type NormalizedPoint = {
  x: number;
  y: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  "worklet";
  return Math.min(maximum, Math.max(minimum, value));
}

export function getViewportCenter(viewport: SceneSize) {
  "worklet";
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

export function screenPointToSourcePoint(
  locationX: number,
  locationY: number,
  viewport: SceneSize,
  imageRect: ImageRect,
  transform: TransformSnapshot,
): NormalizedPoint | null {
  "worklet";
  const center = getViewportCenter(viewport);
  const untransformedX = (locationX - center.x - transform.translateX) / transform.scale + center.x;
  const untransformedY = (locationY - center.y - transform.translateY) / transform.scale + center.y;
  const imageX = untransformedX - imageRect.offsetX;
  const imageY = untransformedY - imageRect.offsetY;

  if (imageX < 0 || imageY < 0 || imageX > imageRect.width || imageY > imageRect.height) {
    return null;
  }

  return { x: imageX / imageRect.width, y: imageY / imageRect.height };
}

export function clampSpotDifferenceTranslation(
  transform: TransformSnapshot,
  viewport: SceneSize,
  imageRect: ImageRect | null,
  minimumScale: number,
  maximumScale: number,
  zoomEpsilon: number,
): TransformSnapshot {
  "worklet";
  const nextScale = clamp(transform.scale, minimumScale, maximumScale);
  if (!imageRect || nextScale <= minimumScale + zoomEpsilon) {
    return { scale: minimumScale, translateX: 0, translateY: 0 };
  }

  const maxTranslateX = Math.max(0, (imageRect.width * nextScale - viewport.width) / 2);
  const maxTranslateY = Math.max(0, (imageRect.height * nextScale - viewport.height) / 2);

  return {
    scale: nextScale,
    translateX: clamp(transform.translateX, -maxTranslateX, maxTranslateX),
    translateY: clamp(transform.translateY, -maxTranslateY, maxTranslateY),
  };
}
