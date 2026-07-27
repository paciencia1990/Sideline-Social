import scene001Data from "../../../assets/games/spot-the-difference/scene_001.json";
import scene002Data from "../../../assets/games/spot-the-difference/scene_002.json";
import scene003Data from "../../../assets/games/spot-the-difference/scene_003.json";
import scene004Data from "../../../assets/games/spot-the-difference/scene_004.json";
import scene005Data from "../../../assets/games/spot-the-difference/scene_005.json";
import scene006Data from "../../../assets/games/spot-the-difference/scene_006.json";
import scene007Data from "../../../assets/games/spot-the-difference/scene_007.json";
import scene008Data from "../../../assets/games/spot-the-difference/scene_008.json";
import scene009Data from "../../../assets/games/spot-the-difference/scene_009.json";
import scene010Data from "../../../assets/games/spot-the-difference/scene_010.json";
import scene011Data from "../../../assets/games/spot-the-difference/scene_011.json";
import scene012Data from "../../../assets/games/spot-the-difference/scene_012.json";
import scene013Data from "../../../assets/games/spot-the-difference/scene_013.json";
import scene014Data from "../../../assets/games/spot-the-difference/scene_014.json";
import scene015Data from "../../../assets/games/spot-the-difference/scene_015.json";
import scene016Data from "../../../assets/games/spot-the-difference/scene_016.json";
import scene017Data from "../../../assets/games/spot-the-difference/scene_017.json";
import scene018Data from "../../../assets/games/spot-the-difference/scene_018.json";
import scene019Data from "../../../assets/games/spot-the-difference/scene_019.json";
import scene020Data from "../../../assets/games/spot-the-difference/scene_020.json";
import scene021Data from "../../../assets/games/spot-the-difference/scene_021.json";

export type SpotDifferencePoint = {
  id: string;
  x: number;
  y: number;
  radius: number;
  label?: string;
};

export type SpotDifferenceScene = {
  id: string;
  title: string;
  imageA: number;
  imageB: number;
  sourceWidth: number;
  sourceHeight: number;
  differences: SpotDifferencePoint[];
  validationWarnings: string[];
};

type RawDifferencePoint = {
  id?: string;
  x?: number;
  y?: number;
  radius?: number;
  width?: number;
  height?: number;
  label?: string;
};

type RawSceneData = RawDifferencePoint[] | {
  sceneId?: string;
  imageWidth?: number;
  imageHeight?: number;
  differences?: RawDifferencePoint[];
};

type SceneDefinition = {
  id: string;
  title: string;
  imageA: number;
  imageB: number;
  sourceWidth?: number;
  sourceHeight?: number;
  data: RawSceneData;
};

const EXPECTED_DIFFERENCES = 10;
const DEFAULT_SOURCE_SIZE = 1024;
const DEFAULT_RADIUS = 0.07;

const sceneDefinitions: SceneDefinition[] = [
  {
    id: "scene_001",
    title: "Scene 1",
    imageA: require("../../../assets/games/spot-the-difference/scene_001_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_001_B.webp"),
    data: scene001Data,
  },
  {
    id: "scene_002",
    title: "Scene 2",
    imageA: require("../../../assets/games/spot-the-difference/scene_002_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_002_B.webp"),
    data: scene002Data,
  },
  {
    id: "scene_003",
    title: "Scene 3",
    imageA: require("../../../assets/games/spot-the-difference/scene_003_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_003_B.webp"),
    data: scene003Data,
  },
  {
    id: "scene_004",
    title: "Scene 4",
    imageA: require("../../../assets/games/spot-the-difference/scene_004_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_004_B.webp"),
    data: scene004Data,
  },
  {
    id: "scene_005",
    title: "Scene 5",
    imageA: require("../../../assets/games/spot-the-difference/scene_005_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_005_B.webp"),
    data: scene005Data,
  },
  {
    id: "scene_006",
    title: "Scene 6",
    imageA: require("../../../assets/games/spot-the-difference/scene_006_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_006_B.webp"),
    data: scene006Data,
  },
  {
    id: "scene_007",
    title: "Scene 7",
    imageA: require("../../../assets/games/spot-the-difference/scene_007_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_007_B.webp"),
    data: scene007Data,
  },
  {
    id: "scene_008",
    title: "Scene 8",
    imageA: require("../../../assets/games/spot-the-difference/scene_008_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_008_B.webp"),
    data: scene008Data,
  },
  {
    id: "scene_009",
    title: "Scene 9",
    imageA: require("../../../assets/games/spot-the-difference/scene_009_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_009_B.webp"),
    data: scene009Data,
  },
  {
    id: "scene_010",
    title: "Scene 10",
    imageA: require("../../../assets/games/spot-the-difference/scene_010_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_010_B.webp"),
    data: scene010Data,
  },
  {
    id: "scene_011",
    title: "Scene 11",
    imageA: require("../../../assets/games/spot-the-difference/scene_011_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_011_B.webp"),
    data: scene011Data,
  },
  {
    id: "scene_012",
    title: "Scene 12",
    imageA: require("../../../assets/games/spot-the-difference/scene_012_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_012_B.webp"),
    data: scene012Data,
  },
  {
    id: "scene_013",
    title: "Scene 13",
    imageA: require("../../../assets/games/spot-the-difference/scene_013_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_013_B.webp"),
    data: scene013Data,
  },
  {
    id: "scene_014",
    title: "Scene 14",
    imageA: require("../../../assets/games/spot-the-difference/scene_014_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_014_B.webp"),
    data: scene014Data,
  },
  {
    id: "scene_015",
    title: "Scene 15",
    imageA: require("../../../assets/games/spot-the-difference/scene_015_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_015_B.webp"),
    data: scene015Data,
  },
  {
    id: "scene_016",
    title: "Scene 16",
    imageA: require("../../../assets/games/spot-the-difference/scene_016_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_016_B.webp"),
    data: scene016Data,
  },
  {
    id: "scene_017",
    title: "Scene 17",
    imageA: require("../../../assets/games/spot-the-difference/scene_017_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_017_B.webp"),
    data: scene017Data,
  },
  {
    id: "scene_018",
    title: "Scene 18",
    imageA: require("../../../assets/games/spot-the-difference/scene_018_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_018_B.webp"),
    data: scene018Data,
  },
  {
    id: "scene_019",
    title: "Scene 19",
    imageA: require("../../../assets/games/spot-the-difference/scene_019_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_019_B.webp"),
    data: scene019Data,
  },
  {
    id: "scene_020",
    title: "Scene 20",
    imageA: require("../../../assets/games/spot-the-difference/scene_020_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_020_B.webp"),
    data: scene020Data,
  },
  {
    id: "scene_021",
    title: "Scene 21",
    imageA: require("../../../assets/games/spot-the-difference/scene_021_A.webp"),
    imageB: require("../../../assets/games/spot-the-difference/scene_021_B.webp"),
    data: scene021Data,
  },
];

export const spotDifferenceScenes: SpotDifferenceScene[] = sceneDefinitions.map(createScene);
export const playableSpotDifferenceScenes = spotDifferenceScenes.filter((scene) => scene.validationWarnings.length === 0);

warnForInvalidScenes(spotDifferenceScenes);

function createScene(definition: SceneDefinition): SpotDifferenceScene {
  const rawDifferences = Array.isArray(definition.data) ? definition.data : definition.data.differences ?? [];
  const sourceWidth = !Array.isArray(definition.data) && definition.data.imageWidth ? definition.data.imageWidth : definition.sourceWidth ?? DEFAULT_SOURCE_SIZE;
  const sourceHeight = !Array.isArray(definition.data) && definition.data.imageHeight ? definition.data.imageHeight : definition.sourceHeight ?? DEFAULT_SOURCE_SIZE;
  const differences = rawDifferences.map((point, index) => normalizePoint(point, index, sourceWidth, sourceHeight));
  const validationWarnings = validateScene(definition.id, differences);

  if (!Array.isArray(definition.data) && definition.data.sceneId && definition.data.sceneId !== definition.id) {
    validationWarnings.push(`sceneId mismatch: JSON says ${definition.data.sceneId}`);
  }

  return {
    id: definition.id,
    title: definition.title,
    imageA: definition.imageA,
    imageB: definition.imageB,
    sourceWidth,
    sourceHeight,
    differences,
    validationWarnings,
  };
}

function normalizePoint(point: RawDifferencePoint, index: number, sourceWidth: number, sourceHeight: number): SpotDifferencePoint {
  const x = normalizeCoordinate(point.x, sourceWidth);
  const y = normalizeCoordinate(point.y, sourceHeight);
  const radius = normalizeRadius(point.radius, point.width, point.height, sourceWidth, sourceHeight);

  return {
    id: point.id ?? `difference_${String(index + 1).padStart(2, "0")}`,
    x,
    y,
    radius,
    label: point.label,
  };
}

function normalizeCoordinate(value: number | undefined, sourceSize: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return -1;
  }

  return value > 1 ? value / sourceSize : value;
}

function normalizeRadius(radius: number | undefined, width: number | undefined, height: number | undefined, sourceWidth: number, sourceHeight: number) {
  if (typeof radius === "number" && !Number.isNaN(radius)) {
    return radius > 1 ? radius / Math.max(sourceWidth, sourceHeight) : radius;
  }

  const normalizedWidth = normalizeSize(width, sourceWidth);
  const normalizedHeight = normalizeSize(height, sourceHeight);
  return Math.max(normalizedWidth, normalizedHeight, DEFAULT_RADIUS) / 2;
}

function normalizeSize(value: number | undefined, sourceSize: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return value > 1 ? value / sourceSize : value;
}

function validateScene(sceneId: string, differences: SpotDifferencePoint[]) {
  const warnings: string[] = [];
  if (differences.length !== EXPECTED_DIFFERENCES) {
    warnings.push(`expected ${EXPECTED_DIFFERENCES} differences but found ${differences.length}`);
  }

  const ids = new Set<string>();
  const locations = new Set<string>();
  differences.forEach((difference) => {
    if (ids.has(difference.id)) {
      warnings.push(`duplicate difference id: ${difference.id}`);
    }
    ids.add(difference.id);

    const locationKey = `${difference.x.toFixed(4)}:${difference.y.toFixed(4)}`;
    if (locations.has(locationKey)) {
      warnings.push(`duplicate difference location: ${locationKey}`);
    }
    locations.add(locationKey);

    if (difference.x < 0 || difference.x > 1 || difference.y < 0 || difference.y > 1) {
      warnings.push(`coordinate outside image bounds: ${difference.id}`);
    }

    if (difference.radius <= 0 || difference.radius > 1) {
      warnings.push(`invalid radius for ${difference.id}`);
    }
  });

  return Array.from(new Set(warnings.map((warning) => `${sceneId}: ${warning}`)));
}

function warnForInvalidScenes(scenes: SpotDifferenceScene[]) {
  if (!__DEV__) {
    return;
  }

  scenes.forEach((scene) => {
    scene.validationWarnings.forEach((warning) => console.warn(`[SpotDifferenceScenes] ${warning}`));
  });
}
