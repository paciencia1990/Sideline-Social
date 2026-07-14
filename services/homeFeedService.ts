import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import { getPublicUserProfiles } from "@/services/publicProfileService";
import { getSafeProfileName } from "@/utils/friendPrivacy";

export interface SquadDetail {
  squadId: string;
  name: string;
  sport: string;
  venueName: string;
  activeMemberCount: number;
  lastActivityAt: Date | null;
}

export interface ConnectionPrompt {
  promptId: string;
  promptText: string;
  promptText_es: string;
  weekOf: Date;
  isActive: boolean;
}

export interface LiveSquadData {
  squadId: string;
  name: string;
  venueName: string;
  activeMemberCount: number;
  memberAvatars: { userId: string; displayName: string; avatarUrl: string | null }[];
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
              const publicProfiles = await getPublicUserProfiles(memberIds);
              memberAvatars = publicProfiles.map((profile) => ({
                userId: profile.userId,
                displayName: getSafeProfileName(profile.displayName),
                avatarUrl: null,
              }));
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
