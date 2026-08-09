import { SPOT_DIFFERENCE_SCENE_DATA } from './spotDifferenceSceneData';

export const EXPECTED_SPOT_DIFFERENCES = 10;
export const SPOT_TEAM_IDS = ['A', 'B'] as const;

export type SpotTeamId = typeof SPOT_TEAM_IDS[number];

export type SpotDifferencePoint = {
  id: string;
  x: number;
  y: number;
  radius: number;
};

export type SpotDifferenceSceneDefinition = {
  id: string;
  differences: SpotDifferencePoint[];
};

export type SpotTeamTotals = Record<SpotTeamId, number>;

export type SpotRoundResult = {
  outcome: 'teamWin' | 'tie';
  winnerTeamId: SpotTeamId | null;
  completedByTeamId: SpotTeamId | null;
  teamTotals: SpotTeamTotals;
  perfectTeamIds: SpotTeamId[];
  totalDifferences: number;
};

type RawSpotDifferencePoint = {
  id?: string;
  x?: number;
  y?: number;
  radius?: number;
  width?: number;
  height?: number;
};

const DEFAULT_SOURCE_SIZE = 1024;
const DEFAULT_RADIUS = 0.07;

export function isSpotTeamId(value: unknown): value is SpotTeamId {
  return value === 'A' || value === 'B';
}

export function normalizeSpotTeamId(value: unknown): SpotTeamId | null {
  return isSpotTeamId(value) ? value : null;
}

export function teamForSpotJoinIndex(index: number): SpotTeamId {
  return Math.max(0, Math.floor(index)) % 2 === 0 ? 'A' : 'B';
}

export function teamForSpotJoinOrder(joinOrder: number): SpotTeamId {
  return teamForSpotJoinIndex(Math.max(1, Math.floor(joinOrder)) - 1);
}

export function listCanonicalSpotScenes(): SpotDifferenceSceneDefinition[] {
  return Object.keys(SPOT_DIFFERENCE_SCENE_DATA)
    .sort()
    .map((sceneId) => getCanonicalSpotScene(sceneId))
    .filter((scene): scene is SpotDifferenceSceneDefinition => scene != null);
}

export function getCanonicalSpotScene(sceneId: string): SpotDifferenceSceneDefinition | null {
  const id = normalizeSpotSceneId(sceneId);
  const sceneData = SPOT_DIFFERENCE_SCENE_DATA as Record<string, readonly RawSpotDifferencePoint[]>;
  const raw = id ? sceneData[id] : undefined;
  if (!id || !Array.isArray(raw)) return null;
  return {
    id,
    differences: raw.map((point, index) => normalizeSpotPoint(point, index)),
  };
}

export function findCanonicalSpotDifference(
  sceneId: string,
  tap: { x: number; y: number },
): SpotDifferencePoint | null {
  if (!isNormalizedCoordinate(tap.x) || !isNormalizedCoordinate(tap.y)) return null;
  const scene = getCanonicalSpotScene(sceneId);
  if (!scene || scene.differences.length !== EXPECTED_SPOT_DIFFERENCES) return null;
  return scene.differences.find((difference) => {
    const distance = Math.hypot(tap.x - difference.x, tap.y - difference.y);
    return distance <= difference.radius;
  }) ?? null;
}

export function validateCanonicalSpotScenes() {
  return listCanonicalSpotScenes().flatMap((scene) => {
    const warnings: string[] = [];
    if (scene.differences.length !== EXPECTED_SPOT_DIFFERENCES) {
      warnings.push(`${scene.id}: expected ${EXPECTED_SPOT_DIFFERENCES} differences but found ${scene.differences.length}`);
    }

    const ids = new Set<string>();
    const locations = new Set<string>();
    scene.differences.forEach((difference) => {
      if (ids.has(difference.id)) warnings.push(`${scene.id}: duplicate difference id ${difference.id}`);
      ids.add(difference.id);

      const locationKey = `${difference.x.toFixed(4)}:${difference.y.toFixed(4)}`;
      if (locations.has(locationKey)) warnings.push(`${scene.id}: duplicate difference location ${locationKey}`);
      locations.add(locationKey);

      if (!isNormalizedCoordinate(difference.x) || !isNormalizedCoordinate(difference.y)) {
        warnings.push(`${scene.id}: coordinate outside image bounds ${difference.id}`);
      }
      if (!Number.isFinite(difference.radius) || difference.radius <= 0 || difference.radius > 1) {
        warnings.push(`${scene.id}: invalid radius ${difference.id}`);
      }
    });
    return warnings;
  });
}

export function resolveSpotRoundResult(input: {
  teamTotals: Partial<Record<SpotTeamId, number>>;
  completionTimes?: Partial<Record<SpotTeamId, number | null>>;
  totalDifferences?: number;
}): SpotRoundResult {
  const totalDifferences = normalizeExpectedTotal(input.totalDifferences);
  const teamTotals: SpotTeamTotals = {
    A: clampInteger(input.teamTotals.A, 0, totalDifferences),
    B: clampInteger(input.teamTotals.B, 0, totalDifferences),
  };
  const perfectTeamIds = SPOT_TEAM_IDS.filter((teamId) => teamTotals[teamId] >= totalDifferences);

  if (perfectTeamIds.length > 0) {
    const orderedPerfectTeams = [...perfectTeamIds].sort((left, right) => {
      const leftTime = readCompletionTime(input.completionTimes?.[left]);
      const rightTime = readCompletionTime(input.completionTimes?.[right]);
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.localeCompare(right);
    });
    const earliestTime = readCompletionTime(input.completionTimes?.[orderedPerfectTeams[0]]);
    const tiedPerfectTeams = orderedPerfectTeams.filter((teamId) => (
      readCompletionTime(input.completionTimes?.[teamId]) === earliestTime
    ));
    if (tiedPerfectTeams.length > 1) {
      return {
        outcome: 'tie',
        winnerTeamId: null,
        completedByTeamId: null,
        teamTotals,
        perfectTeamIds,
        totalDifferences,
      };
    }

    const winnerTeamId = orderedPerfectTeams[0];
    return {
      outcome: 'teamWin',
      winnerTeamId,
      completedByTeamId: winnerTeamId,
      teamTotals,
      perfectTeamIds,
      totalDifferences,
    };
  }

  if (teamTotals.A === teamTotals.B) {
    return {
      outcome: 'tie',
      winnerTeamId: null,
      completedByTeamId: null,
      teamTotals,
      perfectTeamIds,
      totalDifferences,
    };
  }

  const winnerTeamId = teamTotals.A > teamTotals.B ? 'A' : 'B';
  return {
    outcome: 'teamWin',
    winnerTeamId,
    completedByTeamId: null,
    teamTotals,
    perfectTeamIds,
    totalDifferences,
  };
}

function normalizeSpotSceneId(value: string) {
  const sceneId = typeof value === 'string' ? value.trim() : '';
  return /^scene_\d{3}$/.test(sceneId) ? sceneId : null;
}

function normalizeSpotPoint(
  point: RawSpotDifferencePoint,
  index: number,
): SpotDifferencePoint {
  return {
    id: typeof point.id === 'string' && /^difference_(?:0[1-9]|10)$/.test(point.id)
      ? point.id
      : `difference_${String(index + 1).padStart(2, '0')}`,
    x: normalizeCoordinate(point.x),
    y: normalizeCoordinate(point.y),
    radius: normalizeRadius(point.radius, point.width, point.height),
  };
}

function normalizeCoordinate(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) return -1;
  return value > 1 ? value / DEFAULT_SOURCE_SIZE : value;
}

function normalizeRadius(radius: unknown, width: unknown, height: unknown) {
  if (typeof radius === 'number' && !Number.isNaN(radius)) {
    return radius > 1 ? radius / DEFAULT_SOURCE_SIZE : radius;
  }
  const normalizedWidth = typeof width === 'number' && !Number.isNaN(width)
    ? width > 1 ? width / DEFAULT_SOURCE_SIZE : width
    : 0;
  const normalizedHeight = typeof height === 'number' && !Number.isNaN(height)
    ? height > 1 ? height / DEFAULT_SOURCE_SIZE : height
    : 0;
  return Math.max(normalizedWidth, normalizedHeight, DEFAULT_RADIUS) / 2;
}

function isNormalizedCoordinate(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function normalizeExpectedTotal(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : EXPECTED_SPOT_DIFFERENCES;
}

function clampInteger(value: unknown, minimum: number, maximum: number) {
  if (!Number.isInteger(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function readCompletionTime(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : Number.MAX_SAFE_INTEGER;
}
