export type SidelineStarsTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'legend';

export type SupportedRewardGame = 'triviaBlitz' | 'spotDifferences' | 'bombDefusal';

export type GameRewardBreakdown = {
  completionStars: number;
  performanceStars: number;
  achievementStars: number;
};

export const WEEKLY_CHALLENGE_STARS = 5;
export const MAX_GAME_STARS = 15;
export const LEADERBOARD_RESPONSE_LIMIT = 50;

export const SIDELINE_STARS_TIERS: ReadonlyArray<{ key: SidelineStarsTier; minStars: number }> = [
  { key: 'bronze', minStars: 0 },
  { key: 'silver', minStars: 500 },
  { key: 'gold', minStars: 1500 },
  { key: 'platinum', minStars: 3000 },
  { key: 'legend', minStars: 5000 },
];

export function getSidelineStarsTier(value: unknown): SidelineStarsTier {
  const stars = normalizeStars(value);
  return SIDELINE_STARS_TIERS.reduce<SidelineStarsTier>(
    (tier, candidate) => stars >= candidate.minStars ? candidate.key : tier,
    'bronze',
  );
}

export function normalizeStars(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

export type RankableEntry = {
  userId: string;
  displayName: string | null;
  sidelineStars: number;
};

export function rankLeaderboardEntries<T extends RankableEntry>(entries: T[]): Array<T & { rank: number }> {
  const sorted = [...entries].sort((left, right) => {
    const starsDifference = normalizeStars(right.sidelineStars) - normalizeStars(left.sidelineStars);
    if (starsDifference !== 0) return starsDifference;
    const nameDifference = (left.displayName ?? '').localeCompare(right.displayName ?? '', 'en', { sensitivity: 'base' });
    return nameDifference !== 0 ? nameDifference : left.userId.localeCompare(right.userId);
  });

  let previousStars: number | null = null;
  let previousRank = 0;
  return sorted.map((entry, index) => {
    const stars = normalizeStars(entry.sidelineStars);
    const rank = previousStars === stars ? previousRank : index + 1;
    previousStars = stars;
    previousRank = rank;
    return { ...entry, sidelineStars: stars, rank };
  });
}

export function calculateTriviaReward(input: {
  completedAllQuestions: boolean;
  correctAnswers: number;
  questionCount: number;
}): GameRewardBreakdown | null {
  if (!input.completedAllQuestions || !isBoundedInteger(input.correctAnswers, 0, input.questionCount)) return null;
  return capBreakdown({
    completionStars: 5,
    performanceStars: Math.min(input.correctAnswers, 10),
    achievementStars: 0,
  });
}

export function calculateSpotDifferencesReward(input: {
  terminal: boolean;
  foundCount: number;
  totalDifferences: number;
}): GameRewardBreakdown | null {
  if (
    !input.terminal ||
    !isBoundedInteger(input.totalDifferences, 1, 10) ||
    !isBoundedInteger(input.foundCount, 0, input.totalDifferences)
  ) return null;
  return capBreakdown({
    completionStars: 5,
    performanceStars: Math.min(input.foundCount, 10),
    achievementStars: 0,
  });
}

export function calculateSpotTeamReward(input: {
  outcome: 'teamWin' | 'tie';
  playerTeamId: 'A' | 'B';
  winnerTeamId: 'A' | 'B' | null;
  perfectCompletion: boolean;
}): GameRewardBreakdown | null {
  if (
    (input.playerTeamId !== 'A' && input.playerTeamId !== 'B') ||
    (input.winnerTeamId !== null && input.winnerTeamId !== 'A' && input.winnerTeamId !== 'B') ||
    (input.outcome !== 'teamWin' && input.outcome !== 'tie')
  ) return null;

  const baseStars = input.outcome === 'tie'
    ? 6
    : input.winnerTeamId === input.playerTeamId
      ? 10
      : 3;
  return capBreakdown({
    completionStars: baseStars,
    performanceStars: 0,
    achievementStars: input.perfectCompletion ? 5 : 0,
  });
}

export function calculateBombDefusalReward(input: {
  outcome: 'defused' | 'exploded';
  firstAttemptCorrectStepCount: number;
  totalSteps: number;
}): GameRewardBreakdown | null {
  if (
    (input.outcome !== 'defused' && input.outcome !== 'exploded') ||
    !isBoundedInteger(input.totalSteps, 1, 20) ||
    !isBoundedInteger(input.firstAttemptCorrectStepCount, 0, input.totalSteps)
  ) return null;
  return capBreakdown({
    completionStars: input.outcome === 'defused' ? 5 : 0,
    performanceStars: Math.min(input.firstAttemptCorrectStepCount, 5),
    achievementStars: input.outcome === 'defused' ? 5 : 0,
  });
}

export function totalBreakdown(breakdown: GameRewardBreakdown): number {
  return breakdown.completionStars + breakdown.performanceStars + breakdown.achievementStars;
}

export function gameRewardId(gameType: SupportedRewardGame, sessionId: string, userId: string): string {
  return `game_${gameType}_${sessionId}_${userId}`;
}

function capBreakdown(breakdown: GameRewardBreakdown): GameRewardBreakdown {
  const total = totalBreakdown(breakdown);
  if (total <= MAX_GAME_STARS) return breakdown;
  return { ...breakdown, performanceStars: Math.max(0, breakdown.performanceStars - (total - MAX_GAME_STARS)) };
}

function isBoundedInteger(value: number, minimum: number, maximum: number) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}
