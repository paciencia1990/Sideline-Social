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

export type ScreenPoint = {
  x: number;
  y: number;
};

export type TranslationBounds = {
  maximumX: number;
  maximumY: number;
  minimumX: number;
  minimumY: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  "worklet";
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeZero(value: number) {
  "worklet";
  return value === 0 ? 0 : value;
}

function getAxisTranslationBounds(
  viewportLength: number,
  imageOffset: number,
  imageLength: number,
  scale: number,
) {
  "worklet";
  const viewportCenter = viewportLength / 2;
  const transformedStart = viewportCenter + (imageOffset - viewportCenter) * scale;
  const transformedEnd = viewportCenter + (imageOffset + imageLength - viewportCenter) * scale;

  if (imageLength * scale >= viewportLength) {
    return {
      maximum: normalizeZero(-transformedStart),
      minimum: normalizeZero(viewportLength - transformedEnd),
    };
  }

  const centeredTranslation = normalizeZero(viewportCenter - (transformedStart + transformedEnd) / 2);
  return {
    maximum: centeredTranslation,
    minimum: centeredTranslation,
  };
}

export function getViewportCenter(viewport: SceneSize) {
  "worklet";
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

export function createSpotDifferenceResetTransform(): TransformSnapshot {
  "worklet";
  return { scale: 1, translateX: 0, translateY: 0 };
}

export function calculateContainedImageLayout(
  viewport: SceneSize,
  source: SceneSize,
): ImageRect | null {
  "worklet";
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    return null;
  }

  const baseImageScale = Math.min(viewport.width / source.width, viewport.height / source.height);
  const width = source.width * baseImageScale;
  const height = source.height * baseImageScale;

  return {
    width,
    height,
    offsetX: (viewport.width - width) / 2,
    offsetY: (viewport.height - height) / 2,
  };
}

export function normalizedPointToScreenPoint(
  point: NormalizedPoint,
  viewport: SceneSize,
  imageRect: ImageRect,
  transform: TransformSnapshot,
): ScreenPoint | null {
  "worklet";
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.x > 1 ||
    point.y < 0 ||
    point.y > 1 ||
    imageRect.width <= 0 ||
    imageRect.height <= 0 ||
    !Number.isFinite(transform.scale) ||
    transform.scale <= 0
  ) {
    return null;
  }

  const center = getViewportCenter(viewport);
  const imageX = imageRect.offsetX + point.x * imageRect.width;
  const imageY = imageRect.offsetY + point.y * imageRect.height;

  return {
    x: center.x + (imageX - center.x) * transform.scale + transform.translateX,
    y: center.y + (imageY - center.y) * transform.scale + transform.translateY,
  };
}

export function screenPointToSourcePoint(
  locationX: number,
  locationY: number,
  viewport: SceneSize,
  imageRect: ImageRect,
  transform: TransformSnapshot,
): NormalizedPoint | null {
  "worklet";
  if (
    imageRect.width <= 0 ||
    imageRect.height <= 0 ||
    !Number.isFinite(transform.scale) ||
    transform.scale <= 0
  ) {
    return null;
  }

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

export function scaleSpotDifferenceTransformAroundFocalPoint(
  transform: TransformSnapshot,
  focalPoint: ScreenPoint,
  viewport: SceneSize,
  nextScale: number,
  minimumScale: number,
  maximumScale: number,
): TransformSnapshot {
  "worklet";
  const startScale = clamp(
    Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : minimumScale,
    minimumScale,
    maximumScale,
  );
  const boundedScale = clamp(nextScale, minimumScale, maximumScale);
  const center = getViewportCenter(viewport);
  const focalX = Number.isFinite(focalPoint.x) ? focalPoint.x : center.x;
  const focalY = Number.isFinite(focalPoint.y) ? focalPoint.y : center.y;
  const ratio = boundedScale / startScale;

  return {
    scale: boundedScale,
    translateX: focalX - center.x - ratio * (focalX - center.x - transform.translateX),
    translateY: focalY - center.y - ratio * (focalY - center.y - transform.translateY),
  };
}

export function getSpotDifferenceTranslationBounds(
  viewport: SceneSize,
  imageRect: ImageRect | null,
  scale: number,
): TranslationBounds {
  "worklet";
  if (
    !imageRect ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    imageRect.width <= 0 ||
    imageRect.height <= 0 ||
    !Number.isFinite(scale) ||
    scale <= 0
  ) {
    return {
      maximumX: 0,
      maximumY: 0,
      minimumX: 0,
      minimumY: 0,
    };
  }

  const horizontal = getAxisTranslationBounds(
    viewport.width,
    imageRect.offsetX,
    imageRect.width,
    scale,
  );
  const vertical = getAxisTranslationBounds(
    viewport.height,
    imageRect.offsetY,
    imageRect.height,
    scale,
  );

  return {
    maximumX: horizontal.maximum,
    maximumY: vertical.maximum,
    minimumX: horizontal.minimum,
    minimumY: vertical.minimum,
  };
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

  const bounds = getSpotDifferenceTranslationBounds(viewport, imageRect, nextScale);

  return {
    scale: nextScale,
    translateX: clamp(transform.translateX, bounds.minimumX, bounds.maximumX),
    translateY: clamp(transform.translateY, bounds.minimumY, bounds.maximumY),
  };
}
