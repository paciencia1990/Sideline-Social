import { collection, getDocs, limit, orderBy, query, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import { db } from "@/config/firebase";

export type LeaderboardTierKey = "bronze" | "silver" | "gold" | "platinum" | "legend";

export interface LeaderboardUser {
  id: string;
  displayName: string;
  sidelineStars: number;
  avatarUrl?: string | null;
  tier: LeaderboardTierKey;
}

export const LEADERBOARD_TIERS: {
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

const DEFAULT_LIMIT = 50;

export async function fetchLeaderboardUsers(maxUsers = DEFAULT_LIMIT): Promise<LeaderboardUser[]> {
  try {
    const usersRef = collection(db, "users");
    const rankedSnapshot = await getDocs(query(usersRef, orderBy("sidelineStars", "desc"), limit(maxUsers)));

    if (!rankedSnapshot.empty) {
      return normalizeLeaderboardDocs(rankedSnapshot.docs);
    }

    const fallbackSnapshot = await getDocs(query(usersRef, limit(maxUsers)));
    return normalizeLeaderboardDocs(fallbackSnapshot.docs);
  } catch (error) {
    console.warn("[LeaderboardService] fetchLeaderboardUsers error:", error);
    throw error;
  }
}

export function getLeaderboardTier(sidelineStars: number): LeaderboardTierKey {
  return LEADERBOARD_TIERS.reduce<LeaderboardTierKey>((currentTier, tier) => {
    return sidelineStars >= tier.minStars ? tier.key : currentTier;
  }, "bronze");
}

export function getLeaderboardTierColor(tierKey: LeaderboardTierKey): string {
  return LEADERBOARD_TIERS.find((tier) => tier.key === tierKey)?.color ?? LEADERBOARD_TIERS[0].color;
}

function normalizeLeaderboardDocs(docs: QueryDocumentSnapshot<DocumentData>[]): LeaderboardUser[] {
  return docs
    .map(docToLeaderboardUser)
    .sort((a, b) => b.sidelineStars - a.sidelineStars)
    .map((user) => ({ ...user, tier: getLeaderboardTier(user.sidelineStars) }));
}

function docToLeaderboardUser(userDoc: QueryDocumentSnapshot<DocumentData>): LeaderboardUser {
  const data = userDoc.data();
  const sidelineStars = readNumber(data.sidelineStars);
  const displayName = readDisplayName(data);

  return {
    id: userDoc.id,
    displayName,
    sidelineStars,
    avatarUrl: readNullableString(data.photoURL ?? data.avatarUrl),
    tier: getLeaderboardTier(sidelineStars),
  };
}

function readDisplayName(data: DocumentData): string {
  const displayName = readNullableString(data.displayName);
  if (displayName) return displayName;

  const firstName = readNullableString(data.firstName);
  const lastName = readNullableString(data.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;

  const email = readNullableString(data.email);
  if (email) return email.split("@")[0] || "Sideline Parent";

  return "Sideline Parent";
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

