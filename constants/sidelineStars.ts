export type LeaderboardTierKey = "bronze" | "silver" | "gold" | "platinum" | "legend";

export const LEADERBOARD_TIERS: readonly {
  key: LeaderboardTierKey;
  minStars: number;
  color: string;
}[] = [
  { key: "bronze", minStars: 0, color: "#CD7F32" },
  { key: "silver", minStars: 500, color: "#A8A9AD" },
  { key: "gold", minStars: 1500, color: "#E8A84C" },
  { key: "platinum", minStars: 3000, color: "#8AA3B2" },
  { key: "legend", minStars: 5000, color: "#C7463B" },
];

export function getLeaderboardTierColor(tierKey: LeaderboardTierKey): string {
  return LEADERBOARD_TIERS.find((tier) => tier.key === tierKey)?.color ?? LEADERBOARD_TIERS[0].color;
}
