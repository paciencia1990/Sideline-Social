import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/config/firebase";

export interface SquadDetail {
  squadId: string;
  name: string;
  sport: string;
  venueName: string;
  activeMemberCount: number;
  lastActivityAt: Date | null;
}

export interface Challenge {
  challengeId: string;
  title: string;
  title_es: string;
  description: string;
  description_es: string;
  type: string;
  starsReward: number;
  weekStart: Date;
  weekEnd: Date;
  isActive: boolean;
}

export interface ConnectionPrompt {
  promptId: string;
  promptText: string;
  promptText_es: string;
  weekOf: Date;
  isActive: boolean;
}

export interface ActivityItem {
  activityId: string;
  type: "join_squad" | "earn_badge" | "complete_challenge" | "play_game" | "new_friend" | "create_squad";
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  squadId: string | null;
  message: string;
  message_es: string;
  createdAt: Date;
}

export interface LiveSquadData {
  squadId: string;
  name: string;
  venueName: string;
  activeMemberCount: number;
  memberAvatars: { userId: string; displayName: string; avatarUrl: string | null }[];
}

export interface UserChallengeProgress {
  status: "accepted" | "complete" | null;
}

type FirestoreDate =
  | Date
  | number
  | {
      toDate?: () => Date;
      toMillis?: () => number;
    }
  | null
  | undefined;

function tsToDate(value: FirestoreDate): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.toMillis === "function") return new Date(value.toMillis());
  return null;
}

function chunkArray<T>(items: T[], size = 30): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function docToSquadDetail(squadDoc: QueryDocumentSnapshot<DocumentData>): SquadDetail {
  const data = squadDoc.data();

  return {
    squadId: squadDoc.id,
    name: (data.name as string) ?? "",
    sport: (data.sport as string) ?? "",
    venueName: (data.venueName as string) ?? "",
    activeMemberCount: (data.activeMemberCount as number) ?? 0,
    lastActivityAt: tsToDate(data.lastActivityAt as FirestoreDate),
  };
}

function docToActivity(activityDoc: QueryDocumentSnapshot<DocumentData>): ActivityItem {
  const data = activityDoc.data();

  return {
    activityId: activityDoc.id,
    type: (data.type as ActivityItem["type"]) ?? "join_squad",
    userId: (data.userId as string) ?? "",
    displayName: (data.displayName as string) ?? "",
    avatarUrl: (data.avatarUrl as string | null) ?? null,
    squadId: (data.squadId as string | null) ?? null,
    message: (data.message as string) ?? "",
    message_es: (data.message_es as string) ?? "",
    createdAt: tsToDate(data.createdAt as FirestoreDate) ?? new Date(),
  };
}

export async function fetchUserSquadsDetail(squadIds: string[]): Promise<SquadDetail[]> {
  if (squadIds.length === 0) return [];

  try {
    const chunks = chunkArray(squadIds);
    const squadsRef = collection(db, "squads");
    const snapshots = await Promise.all(
      chunks.map((chunk) => getDocs(query(squadsRef, where("squadId", "in", chunk))))
    );

    return snapshots.flatMap((snapshot) => snapshot.docs.map(docToSquadDetail));
  } catch (error) {
    console.warn("[HomeFeedService] fetchUserSquadsDetail error:", error);
    return [];
  }
}

export async function fetchActiveChallenge(): Promise<Challenge | null> {
  try {
    const snapshot = await getDocs(
      query(collection(db, "challenges"), where("isActive", "==", true), limit(1))
    );

    if (snapshot.empty) return null;

    const challengeDoc = snapshot.docs[0];
    const data = challengeDoc.data();

    return {
      challengeId: challengeDoc.id,
      title: (data.title as string) ?? "",
      title_es: (data.title_es as string) ?? "",
      description: (data.description as string) ?? "",
      description_es: (data.description_es as string) ?? "",
      type: (data.type as string) ?? "",
      starsReward: (data.starsReward as number) ?? 0,
      weekStart: tsToDate(data.weekStart as FirestoreDate) ?? new Date(),
      weekEnd: tsToDate(data.weekEnd as FirestoreDate) ?? new Date(),
      isActive: (data.isActive as boolean) ?? false,
    };
  } catch (error) {
    console.warn("[HomeFeedService] fetchActiveChallenge error:", error);
    return null;
  }
}

export async function fetchConnectionPrompt(): Promise<ConnectionPrompt | null> {
  try {
    const snapshot = await getDocs(
      query(collection(db, "connectionPrompts"), where("isActive", "==", true), limit(1))
    );

    if (snapshot.empty) return null;

    const promptDoc = snapshot.docs[0];
    const data = promptDoc.data();

    return {
      promptId: promptDoc.id,
      promptText: (data.promptText as string) ?? "",
      promptText_es: (data.promptText_es as string) ?? "",
      weekOf: tsToDate(data.weekOf as FirestoreDate) ?? new Date(),
      isActive: (data.isActive as boolean) ?? false,
    };
  } catch (error) {
    console.warn("[HomeFeedService] fetchConnectionPrompt error:", error);
    return null;
  }
}

export function subscribeToActivityFeed(
  squadIds: string[],
  friendIds: string[],
  callback: (activities: ActivityItem[]) => void
): () => void {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const squadItems = new Map<string, ActivityItem>();
  const friendItems = new Map<string, ActivityItem>();
  const squadChunkItemIds = new Map<number, Set<string>>();
  const friendChunkItemIds = new Map<number, Set<string>>();
  const unsubscribers: Unsubscribe[] = [];

  function merge() {
    const combined = new Map<string, ActivityItem>();
    squadItems.forEach((item, id) => combined.set(id, item));
    friendItems.forEach((item, id) => combined.set(id, item));

    callback(
      Array.from(combined.values())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 30)
    );
  }

  function replaceChunkItems(
    target: Map<string, ActivityItem>,
    chunkItemIds: Map<number, Set<string>>,
    chunkIndex: number,
    docs: QueryDocumentSnapshot<DocumentData>[]
  ) {
    chunkItemIds.get(chunkIndex)?.forEach((activityId) => target.delete(activityId));

    const nextIds = new Set<string>();
    docs.forEach((activityDoc) => {
      const item = docToActivity(activityDoc);
      target.set(item.activityId, item);
      nextIds.add(item.activityId);
    });

    chunkItemIds.set(chunkIndex, nextIds);
    merge();
  }

  try {
    chunkArray(squadIds).forEach((chunk, chunkIndex) => {
      const unsubscribe = onSnapshot(
        query(
          collection(db, "activity"),
          where("squadId", "in", chunk),
          where("createdAt", ">=", sevenDaysAgo),
          orderBy("createdAt", "desc"),
          limit(30)
        ),
        (snapshot) => replaceChunkItems(squadItems, squadChunkItemIds, chunkIndex, snapshot.docs),
        (error) => console.warn("[HomeFeedService] squadActivity listener error:", error)
      );

      unsubscribers.push(unsubscribe);
    });

    chunkArray(friendIds).forEach((chunk, chunkIndex) => {
      const unsubscribe = onSnapshot(
        query(
          collection(db, "activity"),
          where("userId", "in", chunk),
          where("createdAt", ">=", sevenDaysAgo),
          orderBy("createdAt", "desc"),
          limit(30)
        ),
        (snapshot) => replaceChunkItems(friendItems, friendChunkItemIds, chunkIndex, snapshot.docs),
        (error) => console.warn("[HomeFeedService] friendActivity listener error:", error)
      );

      unsubscribers.push(unsubscribe);
    });

    if (squadIds.length === 0 && friendIds.length === 0) {
      callback([]);
    }
  } catch (error) {
    console.warn("[HomeFeedService] subscribeToActivityFeed setup error:", error);
    callback([]);
  }

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

export function subscribeLiveSquadCard(
  squadIds: string[],
  callback: (liveSquad: LiveSquadData | null) => void
): () => void {
  if (squadIds.length === 0) {
    callback(null);
    return () => {};
  }

  const allSquads = new Map<string, LiveSquadData>();
  const unsubscribers: Unsubscribe[] = [];

  function emitBest() {
    const winner = Array.from(allSquads.values()).reduce<LiveSquadData | null>((best, squad) => {
      if (!best) return squad;
      return squad.activeMemberCount > best.activeMemberCount ? squad : best;
    }, null);

    callback(winner && winner.activeMemberCount > 0 ? winner : null);
  }

  try {
    chunkArray(squadIds).forEach((chunk) => {
      const unsubscribe = onSnapshot(
        query(
          collection(db, "squads"),
          where("squadId", "in", chunk),
          where("activeMemberCount", ">", 0)
        ),
        async (snapshot) => {
          chunk.forEach((squadId) => allSquads.delete(squadId));

          for (const squadDoc of snapshot.docs) {
            const data = squadDoc.data();
            const memberIds = ((data.memberIds as string[]) ?? []).slice(0, 5);

            let memberAvatars: LiveSquadData["memberAvatars"] = [];
            try {
              const memberDocs = await Promise.all(
                memberIds.map((userId) => getDoc(doc(db, "users", userId)))
              );

              memberAvatars = memberDocs.flatMap((memberDoc) => {
                if (!memberDoc.exists()) return [];

                const memberData = memberDoc.data();
                return [
                  {
                    userId: memberDoc.id,
                    displayName: (memberData.displayName as string) ?? "",
                    avatarUrl: (memberData.photoURL as string | null) ?? null,
                  },
                ];
              });
            } catch (error) {
              console.warn("[HomeFeedService] member preview lookup error:", error);
            }

            allSquads.set(squadDoc.id, {
              squadId: squadDoc.id,
              name: (data.name as string) ?? "",
              venueName: (data.venueName as string) ?? "",
              activeMemberCount: (data.activeMemberCount as number) ?? 0,
              memberAvatars,
            });
          }

          emitBest();
        },
        (error) => console.warn("[HomeFeedService] subscribeLiveSquadCard error:", error)
      );

      unsubscribers.push(unsubscribe);
    });
  } catch (error) {
    console.warn("[HomeFeedService] subscribeLiveSquadCard setup error:", error);
    callback(null);
  }

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

export async function fetchUnreadNotificationCount(userId: string): Promise<number> {
  try {
    const snapshot = await getDocs(
      query(
        collection(db, "userNotifications", userId, "notifications"),
        where("isRead", "==", false)
      )
    );

    return snapshot.size;
  } catch (error) {
    console.warn("[HomeFeedService] fetchUnreadNotificationCount error:", error);
    return 0;
  }
}

export async function updateChallengeStatus(
  userId: string,
  challengeId: string,
  status: "accepted" | "complete"
): Promise<void> {
  try {
    const progressId = `${userId}__${challengeId}`;
    await setDoc(
      doc(db, "userChallengeProgress", progressId),
      {
        userId,
        challengeId,
        status,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.warn("[HomeFeedService] updateChallengeStatus error:", error);
    throw error;
  }
}

export async function fetchUserFriendIds(userId: string): Promise<string[]> {
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    if (!userDoc.exists()) return [];

    const data = userDoc.data();
    return (data.friendIds as string[]) ?? [];
  } catch (error) {
    console.warn("[HomeFeedService] fetchUserFriendIds error:", error);
    return [];
  }
}
