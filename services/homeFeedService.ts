/**
 * homeFeedService.ts
 * All Firestore operations for the Home Feed screen.
 * Follows the same dynamic-import pattern as squadService.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SquadDetail {
  squadId: string;
  name: string;
  sport: string; // emoji
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
  type: 'join_squad' | 'earn_badge' | 'complete_challenge' | 'play_game' | 'new_friend' | 'create_squad';
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
  status: 'accepted' | 'complete' | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tsToDate(val: any): Date | null {
  if (!val) return null;
  if (typeof val.toDate === 'function') return val.toDate();
  if (typeof val === 'number') return new Date(val);
  return null;
}

// ---------------------------------------------------------------------------
// fetchUserSquadsDetail
// ---------------------------------------------------------------------------

export async function fetchUserSquadsDetail(squadIds: string[]): Promise<SquadDetail[]> {
  if (squadIds.length === 0) return [];
  try {
    const firestore = (await import('@react-native-firebase/firestore')).default;
    const fs = firestore();

    // Firestore 'in' queries are limited to 30 elements — chunk if needed
    const chunks: string[][] = [];
    for (let i = 0; i < squadIds.length; i += 30) {
      chunks.push(squadIds.slice(i, i + 30));
    }

    const results: SquadDetail[] = [];
    for (const chunk of chunks) {
      const snap = await fs.collection('squads').where('squadId', 'in', chunk).get();
      for (const doc of snap.docs) {
        const d = doc.data() as Record<string, unknown>;
        results.push({
          squadId: doc.id,
          name: (d.name as string) ?? '',
          sport: (d.sport as string) ?? '',
          venueName: (d.venueName as string) ?? '',
          activeMemberCount: (d.activeMemberCount as number) ?? 0,
          lastActivityAt: tsToDate(d.lastActivityAt),
        });
      }
    }
    return results;
  } catch (err) {
    console.warn('[HomeFeedService] fetchUserSquadsDetail error:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// fetchActiveChallenge
// ---------------------------------------------------------------------------

export async function fetchActiveChallenge(): Promise<Challenge | null> {
  try {
    const firestore = (await import('@react-native-firebase/firestore')).default;
    const snap = await firestore()
      .collection('challenges')
      .where('isActive', '==', true)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const d = doc.data() as Record<string, unknown>;
    return {
      challengeId: doc.id,
      title: (d.title as string) ?? '',
      title_es: (d.title_es as string) ?? '',
      description: (d.description as string) ?? '',
      description_es: (d.description_es as string) ?? '',
      type: (d.type as string) ?? '',
      starsReward: (d.starsReward as number) ?? 0,
      weekStart: tsToDate(d.weekStart) ?? new Date(),
      weekEnd: tsToDate(d.weekEnd) ?? new Date(),
      isActive: (d.isActive as boolean) ?? false,
    };
  } catch (err) {
    console.warn('[HomeFeedService] fetchActiveChallenge error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// fetchConnectionPrompt
// ---------------------------------------------------------------------------

export async function fetchConnectionPrompt(): Promise<ConnectionPrompt | null> {
  try {
    const firestore = (await import('@react-native-firebase/firestore')).default;
    const snap = await firestore()
      .collection('connectionPrompts')
      .where('isActive', '==', true)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const d = doc.data() as Record<string, unknown>;
    return {
      promptId: doc.id,
      promptText: (d.promptText as string) ?? '',
      promptText_es: (d.promptText_es as string) ?? '',
      weekOf: tsToDate(d.weekOf) ?? new Date(),
      isActive: (d.isActive as boolean) ?? false,
    };
  } catch (err) {
    console.warn('[HomeFeedService] fetchConnectionPrompt error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// subscribeToActivityFeed
// ---------------------------------------------------------------------------

export function subscribeToActivityFeed(
  squadIds: string[],
  friendIds: string[],
  callback: (activities: ActivityItem[]) => void
): () => void {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // Shared state — two listeners merge results
  const squadItems = new Map<string, ActivityItem>();
  const friendItems = new Map<string, ActivityItem>();

  function merge() {
    const combined = new Map<string, ActivityItem>();
    squadItems.forEach((v, k) => combined.set(k, v));
    friendItems.forEach((v, k) => combined.set(k, v));
    const sorted = Array.from(combined.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 30);
    callback(sorted);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function docToActivity(doc: any): ActivityItem {
    const d = doc.data() as Record<string, unknown>;
    return {
      activityId: doc.id,
      type: (d.type as ActivityItem['type']) ?? 'join_squad',
      userId: (d.userId as string) ?? '',
      displayName: (d.displayName as string) ?? '',
      avatarUrl: (d.avatarUrl as string | null) ?? null,
      squadId: (d.squadId as string | null) ?? null,
      message: (d.message as string) ?? '',
      message_es: (d.message_es as string) ?? '',
      createdAt: tsToDate(d.createdAt) ?? new Date(),
    };
  }

  const unsubscribers: (() => void)[] = [];

  // We must start listeners asynchronously (dynamic import)
  let mounted = true;

  (async () => {
    try {
      const firestore = (await import('@react-native-firebase/firestore')).default;
      const fs = firestore();

      if (!mounted) return;

      // Listener 1: activity by squadId
      if (squadIds.length > 0) {
        // Chunk into groups of 30 for the 'in' filter limit
        const squadChunks: string[][] = [];
        for (let i = 0; i < squadIds.length; i += 30) {
          squadChunks.push(squadIds.slice(i, i + 30));
        }
        for (const chunk of squadChunks) {
          const unsub = fs
            .collection('activity')
            .where('squadId', 'in', chunk)
            .where('createdAt', '>=', sevenDaysAgo)
            .orderBy('createdAt', 'desc')
            .limit(30)
            .onSnapshot(
              (snap) => {
                snap.docs.forEach((doc) => {
                  const item = docToActivity(doc);
                  squadItems.set(item.activityId, item);
                });
                merge();
              },
              (err) => console.warn('[HomeFeedService] squadActivity listener error:', err)
            );
          if (mounted) unsubscribers.push(unsub);
          else unsub();
        }
      }

      // Listener 2: activity by userId (friends)
      if (friendIds.length > 0) {
        const friendChunks: string[][] = [];
        for (let i = 0; i < friendIds.length; i += 30) {
          friendChunks.push(friendIds.slice(i, i + 30));
        }
        for (const chunk of friendChunks) {
          const unsub = fs
            .collection('activity')
            .where('userId', 'in', chunk)
            .where('createdAt', '>=', sevenDaysAgo)
            .orderBy('createdAt', 'desc')
            .limit(30)
            .onSnapshot(
              (snap) => {
                snap.docs.forEach((doc) => {
                  const item = docToActivity(doc);
                  friendItems.set(item.activityId, item);
                });
                merge();
              },
              (err) => console.warn('[HomeFeedService] friendActivity listener error:', err)
            );
          if (mounted) unsubscribers.push(unsub);
          else unsub();
        }
      }

      // If both are empty, fire callback with empty array immediately
      if (squadIds.length === 0 && friendIds.length === 0) {
        callback([]);
      }
    } catch (err) {
      console.warn('[HomeFeedService] subscribeToActivityFeed setup error:', err);
      callback([]);
    }
  })();

  return () => {
    mounted = false;
    unsubscribers.forEach((u) => u());
  };
}

// ---------------------------------------------------------------------------
// subscribeLiveSquadCard
// ---------------------------------------------------------------------------

export function subscribeLiveSquadCard(
  squadIds: string[],
  callback: (liveSquad: LiveSquadData | null) => void
): () => void {
  if (squadIds.length === 0) {
    callback(null);
    return () => {};
  }

  let mounted = true;
  const unsubscribers: (() => void)[] = [];

  // Keep results per chunk keyed by squadId
  const allSquads = new Map<string, LiveSquadData>();

  function emitBest() {
    if (allSquads.size === 0) {
      callback(null);
      return;
    }
    const squads = Array.from(allSquads.values());
    const winner = squads.reduce<LiveSquadData | null>((best, s) => {
      if (!best) return s;
      return s.activeMemberCount > best.activeMemberCount ? s : best;
    }, null);
    callback(winner && (winner as LiveSquadData).activeMemberCount > 0 ? winner : null);
  }

  (async () => {
    try {
      const firestore = (await import('@react-native-firebase/firestore')).default;
      const fs = firestore();

      if (!mounted) return;

      const chunks: string[][] = [];
      for (let i = 0; i < squadIds.length; i += 30) {
        chunks.push(squadIds.slice(i, i + 30));
      }

      for (const chunk of chunks) {
        const unsub = fs
          .collection('squads')
          .where('squadId', 'in', chunk)
          .where('activeMemberCount', '>', 0)
          .onSnapshot(
            async (snap) => {
              // Clear squads from this chunk first
              chunk.forEach((id) => allSquads.delete(id));

              for (const doc of snap.docs) {
                const d = doc.data() as Record<string, unknown>;
                const memberIds: string[] = (d.memberIds as string[]) ?? [];
                const previewIds = memberIds.slice(0, 5);

                // Fetch member display info
                let memberAvatars: LiveSquadData['memberAvatars'] = [];
                try {
                  const memberDocs = await Promise.all(
                    previewIds.map((uid) => fs.collection('users').doc(uid).get())
                  );
                  memberAvatars = memberDocs
                    .filter((md) => md.exists)
                    .map((md) => {
                      const mData = md.data() as Record<string, unknown>;
                      return {
                        userId: md.id,
                        displayName: (mData.displayName as string) ?? '',
                        avatarUrl: (mData.photoURL as string | null) ?? null,
                      };
                    });
                } catch {
                  memberAvatars = [];
                }

                allSquads.set(doc.id, {
                  squadId: doc.id,
                  name: (d.name as string) ?? '',
                  venueName: (d.venueName as string) ?? '',
                  activeMemberCount: (d.activeMemberCount as number) ?? 0,
                  memberAvatars,
                });
              }
              emitBest();
            },
            (err) => console.warn('[HomeFeedService] subscribeLiveSquadCard error:', err)
          );

        if (mounted) unsubscribers.push(unsub);
        else unsub();
      }
    } catch (err) {
      console.warn('[HomeFeedService] subscribeLiveSquadCard setup error:', err);
      callback(null);
    }
  })();

  return () => {
    mounted = false;
    unsubscribers.forEach((u) => u());
  };
}

// ---------------------------------------------------------------------------
// fetchUnreadNotificationCount
// ---------------------------------------------------------------------------

export async function fetchUnreadNotificationCount(userId: string): Promise<number> {
  try {
    const firestore = (await import('@react-native-firebase/firestore')).default;
    const snap = await firestore()
      .collection('userNotifications')
      .doc(userId)
      .collection('notifications')
      .where('isRead', '==', false)
      .get();
    return snap.size;
  } catch (err) {
    console.warn('[HomeFeedService] fetchUnreadNotificationCount error:', err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// updateChallengeStatus
// ---------------------------------------------------------------------------

export async function updateChallengeStatus(
  userId: string,
  challengeId: string,
  status: 'accepted' | 'complete'
): Promise<void> {
  try {
    const firestore = (await import('@react-native-firebase/firestore')).default;
    const docId = `${userId}__${challengeId}`;
    await firestore()
      .collection('userChallengeProgress')
      .doc(docId)
      .set(
        {
          userId,
          challengeId,
          status,
          updatedAt: firestore.Timestamp.now(),
        },
        { merge: true }
      );
  } catch (err) {
    console.warn('[HomeFeedService] updateChallengeStatus error:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// fetchUserFriendIds
// ---------------------------------------------------------------------------

export async function fetchUserFriendIds(userId: string): Promise<string[]> {
  try {
    const firestore = (await import('@react-native-firebase/firestore')).default;
    const doc = await firestore().collection('users').doc(userId).get();
    if (!doc.exists) return [];
    const data = doc.data() as Record<string, unknown>;
    return (data.friendIds as string[]) ?? [];
  } catch (err) {
    console.warn('[HomeFeedService] fetchUserFriendIds error:', err);
    return [];
  }
}