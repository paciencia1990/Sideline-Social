# Home Feed Implementation Plan
## Sideline Squad v1.0

---

## 1. Context

The current `app/(tabs)/index.tsx` is a placeholder with static content. This plan replaces it with a fully live Home Feed screen: real-time activity, weekly challenge, squad status, and a connection prompt — all driven by Firestore. Cloud Functions are extended to automate weekly challenge activation and send FCM push notifications for social events.

---

## 2. Key Findings

### Existing Patterns to Follow
- **Dynamic Firebase imports**: All Firestore calls use `await import('@react-native-firebase/firestore')` (see `squadService.ts` lines 1-434). Never static-import Firebase modules. Same pattern must be used in the new `homeFeedService.ts`.
- **Context + Service layer separation**: Contexts (`SquadContext.tsx`) hold state and call service functions. Service functions (`squadService.ts`) contain all Firestore logic. Follow this pattern: new `homeFeedService.ts` + new `HomeFeedContext.tsx`.
- **StyleSheet.create() + theme tokens**: All screens use `StyleSheet.create()` with tokens imported from `@/constants/theme`. Never hardcode hex values. All needed tokens already exist in `constants/theme.ts`.
- **Fonts already loaded** in `app/_layout.tsx`: `PlayfairDisplay_700Bold`, `PlayfairDisplay_700Bold_Italic`, `Montserrat_*`, `Caveat_400Regular` — use their keys from `Typography` object.
- **`flattenStyle` utility** at `@/utils/flatten-style` — use for all arrays of styles.
- **`ScreenWrapper`** adds safe-area insets + Soft Cream background. The home screen needs a fixed header OUTSIDE the scroll view, so we'll use `ScreenWrapper` as outer container with a manual header View + `ScrollView` inside.
- **Gluestack `Skeleton` component** already installed at `components/ui/skeleton/index.tsx`. It uses NativeWind `className` for color (`startColor` prop takes a Tailwind class string like `'bg-background-200'`). For shimmer color matching our theme, use a custom `Animated` approach (see Skeleton Loading section below) since gluestack Skeleton's color is NativeWind-constrained.
- **`lucide-react-native`** already installed — use `Bell`, `Trophy`, `Zap`, `Heart`, `Star` icons.
- **`react-native-reanimated`** already installed — use for skeleton shimmer animation.
- **`useAuth()`** provides `user.uid`, `user.displayName`, `user.photoURL`.
- **`useSquad()`** provides `mySquadIds`, `nearbySquads`. We can derive a user's squads from `nearbySquads` filtered by `mySquadIds`, but we also need squad names/sports — fetch separately in the home feed service.
- **i18n**: All user-visible strings go through `useTranslation()`. Keys live inline in `i18n/index.ts` under `resources.en.translation` and `resources.es.translation`. The `home` namespace already exists with only `title` and `subtitle`.
- **`router.push()`** from `expo-router` for navigation. Squad tab is `/(tabs)/squad`, squad chat is `/(social)/squad-chat?squadId=...`.
- **Firestore indexes**: `firestore.indexes.json` already has `activity` indexes on `userId + createdAt` and `squadId + createdAt`. New composite indexes will be needed (see Gotchas).
- **Cloud Functions**: Use `firebase-functions` v5 + `firebase-admin` v12. Existing functions use `functions.firestore.document().onWrite()` and `functions.pubsub.schedule()`. Same pattern for new functions. FCM via `admin.messaging()`.
- **`@tanstack/react-query`** is installed — can optionally use for one-shot fetches (challenges, connection prompts), but keep real-time listeners as raw `onSnapshot` in the context.

### Auth Stub Awareness
`AuthContext` stubs user as `null` in dev when Firebase isn't configured. All data-fetch functions must guard with `if (!user?.uid) return` and show appropriate empty states.

### SquadContext Gap
`SquadContext` does not expose the full squad objects for `mySquadIds`. It only has `nearbySquads` (geo-filtered). For "Your Sideline This Week" chips, we need squad names and sport — fetch the user's squads by ID from the `squads` collection in `homeFeedService`.

---

## 3. Implementation Steps

### Step 1 — Create `services/homeFeedService.ts`

New file. All Firestore reads for the home feed live here. Follows exact pattern of `squadService.ts` (dynamic imports, try/catch, console.warn on error).

**Exports:**

```ts
// Types
export interface ActivityItem { activityId, type, userId, displayName, avatarUrl, squadId, badgeId, challengeId, message, message_es, createdAt }
export type ActivityType = 'squad_join' | 'challenge_complete' | 'badge_earned' | 'game_played' | 'friend_added'

export interface WeeklyChallenge { challengeId, title, title_es, description, description_es, type, starsReward, weekStart, weekEnd, isActive }

export interface ConnectionPrompt { promptId, promptText, promptText_es, weekOf, isActive }

export interface UserChallenge { challengeId, userId, accepted, completed, completedAt }

export interface SquadSummary { squadId, name, sport, activeMemberCount, memberIds }
```

**Functions:**

```ts
// One-shot fetches
export async function fetchActiveWeeklyChallenge(): Promise<WeeklyChallenge | null>
  // Query: challenges where isActive == true, limit 1
  // Returns null if none found

export async function fetchWeeklyConnectionPrompt(): Promise<ConnectionPrompt | null>
  // Query: connectionPrompts where isActive == true AND weekOf == startOfCurrentWeek(), limit 1
  // startOfCurrentWeek() = Monday 00:00 local time as Timestamp

export async function fetchUserChallenge(userId: string, challengeId: string): Promise<UserChallenge | null>
  // Read: userChallenges/{userId}/challenges/{challengeId}  OR  challenges/{challengeId}/userProgress/{userId}
  // ⚠️ Implementation note: pick sub-collection path userChallenges/{userId}/challenges/{challengeId}

export async function acceptChallenge(userId: string, challengeId: string): Promise<void>
  // Write: userChallenges/{userId}/challenges/{challengeId} { accepted: true, completed: false, acceptedAt: now }

export async function completeChallenge(userId: string, challengeId: string): Promise<void>
  // Write: userChallenges/{userId}/challenges/{challengeId} { completed: true, completedAt: now }
  // Also post activity: activity.add({ type: 'challenge_complete', userId, challengeId, createdAt: now })
  // Also increment user sidelineStars by challenge.starsReward

export async function fetchUserSquads(squadIds: string[]): Promise<SquadSummary[]>
  // Batched reads: squads docs for each id in squadIds (max 10 per Firestore 'in' query)
  // Returns name, sport, activeMemberCount, memberIds for each

export async function fetchUnreadNotificationCount(userId: string): Promise<number>
  // Query: userNotifications/{userId}/notifications where read == false
  // Returns count (snapshot.size)

// Real-time listener
export function subscribeToActivityFeed(
  squadIds: string[],
  friendIds: string[],
  onData: (items: ActivityItem[]) => void,
  onError: (err: Error) => void
): () => void   // returns unsubscribe
  // Strategy: Firestore doesn't support OR queries across different fields in one snapshot
  // Use TWO parallel onSnapshot listeners:
  //   Listener A: activity where squadId in squadIds, createdAt >= 7daysAgo, orderBy createdAt DESC, limit 30
  //   Listener B: activity where userId in friendIds, createdAt >= 7daysAgo, orderBy createdAt DESC, limit 30
  //   Merge, de-duplicate by activityId, re-sort by createdAt DESC, slice to 30, call onData
  //   Return cleanup function that unsubscribes both
  // ⚠️ Firestore 'in' filter is limited to 30 elements. If squadIds or friendIds > 30, chunk them.
  // ⚠️ If squadIds is empty, skip Listener A. If friendIds is empty, skip Listener B.
  // ⚠️ Firestore does NOT support 'in' on two different fields in one query — two listeners is correct.

export function subscribeToUnreadCount(
  userId: string,
  onCount: (n: number) => void
): () => void
  // onSnapshot: userNotifications/{userId}/notifications where read == false
```

**Utility:**
```ts
function startOfCurrentWeek(): number  // Returns Monday 00:00:00 UTC as ms timestamp
```

---

### Step 2 — Create `context/HomeFeedContext.tsx`

New context/provider. Wraps the home feed data state, fires up real-time listeners, and exposes clean data + actions to the screen.

**State:**
```ts
interface HomeFeedState {
  activityFeed: ActivityItem[]
  weeklyChallenge: WeeklyChallenge | null
  userChallenge: UserChallenge | null   // acceptance/completion state for current user
  connectionPrompt: ConnectionPrompt | null
  userSquads: SquadSummary[]
  unreadCount: number
  loading: boolean          // true on first render only
  refreshing: boolean       // true during pull-to-refresh
}
```

**Actions:** `refresh()`, `acceptChallenge()`, `markChallengeComplete()`

**Lifecycle:**
- On mount (when `user.uid` is available): call one-shot fetches (challenge, prompt, userSquads, userChallenge) and start real-time listeners (activity feed, unread count).
- Store unsubscribe functions in refs, call them in `useEffect` cleanup.
- `refresh()`: sets `refreshing: true`, re-runs all fetches and resets listeners, sets `refreshing: false`.
- Derive `liveSquad` inside context: find first squad in `userSquads` where `activeMemberCount > 0`. Expose as `liveSquad: SquadSummary | null`.

**Provider placement:** Add `<HomeFeedProvider>` in `app/_layout.tsx` wrapping `AppProvider` children — OR lazily create it only in the home tab. **Preferred: lazy — only render it inside `app/(tabs)/index.tsx`** to avoid mounting Firestore listeners on every screen. The provider wraps the screen component itself.

---

### Step 3 — Create `components/HomeFeedSkeleton.tsx`

Custom skeleton using `react-native-reanimated` (already installed) for shimmer effect, since gluestack's `Skeleton` uses NativeWind color classes that don't map to our exact Warm Sand/Soft Cream palette.

**Approach:** Use `useSharedValue` + `useAnimatedStyle` with `withRepeat(withTiming())` to animate a gradient-like opacity pulse on placeholder `View` shapes. Use `Colors.secondary` (`#D9C4A1`, Warm Sand) as the shimmer block color.

**Export:** `HomeFeedSkeleton` — renders 3 stacked placeholder cards mimicking the header, squad chips row, and challenge card.

---

### Step 4 — Replace `app/(tabs)/index.tsx`

Full replacement. Structure:

```tsx
// Wrap with HomeFeedProvider at top of file (not in _layout.tsx)
export default function HomeScreenWrapper() {
  return (
    <HomeFeedProvider>
      <HomeScreen />
    </HomeFeedProvider>
  );
}

function HomeScreen() {
  const { t, i18n } = useTranslation();
  const { activityFeed, weeklyChallenge, userChallenge, connectionPrompt,
          userSquads, liveSquad, unreadCount, loading, refreshing,
          refresh, acceptChallenge, markChallengeComplete } = useHomeFeed();
  const { user } = useAuth();
  const router = useRouter();

  if (loading) return <HomeFeedSkeleton />;

  return (
    <ScreenWrapper style={styles.wrapper}>
      {/* Fixed Header — outside ScrollView */}
      <HeaderBar unreadCount={unreadCount} onBellPress={() => {/* future notifications screen */}} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />}
      >
        <YourSidelineSection squads={userSquads} onJoinNudge={() => router.push('/(tabs)/squad')} />
        {liveSquad && <LiveSquadCard squad={liveSquad} onJoinChat={() => router.push(`/(social)/squad-chat?squadId=${liveSquad.squadId}`)} />}
        {weeklyChallenge && (
          <WeeklyChallengeCard
            challenge={weeklyChallenge}
            userChallenge={userChallenge}
            lang={i18n.language}
            onAccept={() => acceptChallenge(weeklyChallenge.challengeId)}
            onComplete={() => markChallengeComplete(weeklyChallenge.challengeId)}
          />
        )}
        <ActivityFeedSection items={activityFeed} lang={i18n.language} />
        {connectionPrompt && <ConnectionPromptCard prompt={connectionPrompt} lang={i18n.language} />}
      </ScrollView>
    </ScreenWrapper>
  );
}
```

**Sub-components** (defined in same file or extracted to `components/home/` — prefer same file for first pass, extract if >400 lines):

- **`HeaderBar`**: `View` with `flexDirection: row`, logo mark (`Star` icon sized 20 in Soft Gold) + "Sideline Squad" `Text` in `Typography.heading`, bell `TouchableOpacity` with `Bell` lucide icon and absolute-positioned red circle badge (`unreadCount > 0`). Background `Colors.background`, borderBottom 1px `Colors.secondary`.
- **`YourSidelineSection`**: `SectionHeader` at font size 13 + horizontal `ScrollView` of squad chips. Each chip: `TouchableOpacity` row with sport emoji `Text`, squad name `Text`, colored status dot (`Colors.accentGreen` if `activeMemberCount > 0`, else `Colors.secondary`). Empty state: `Card` with text "Join a squad nearby →", `onPress` → Squad tab.
- **`LiveSquadCard`**: `Card` with `borderLeftWidth: 4, borderLeftColor: Colors.accentGreen`. "LIVE" pill: small `View` with `backgroundColor: Colors.accentGreen`, `Text` in white Montserrat Bold 10pt uppercase. Avatar row: map first 5 `memberIds` to initials circles (dark background, white text). "+X more" text if >5. `PrimaryButton` "Join Chat →".
- **`WeeklyChallengeCard`**: `Card` with `borderLeftWidth: 4, borderLeftColor: Colors.accentGold`. Label row, title in `Typography.display` 18pt, description in `Typography.bodyRegular` 12pt. Progress bar: thin `View` container (`height: 4`, `backgroundColor: Colors.secondary`, `borderRadius: 2`) with inner `View` (`backgroundColor: Colors.accentGold`, width as percentage). Button logic:
  - `!userChallenge || !userChallenge.accepted` → `PrimaryButton` "Accept Challenge"
  - `userChallenge.accepted && !userChallenge.completed` → `PrimaryButton` "Mark Complete ✓"
  - `userChallenge.completed` → non-interactive `View` styled as button, `backgroundColor: Colors.accentGreen`, text "Completed ✓"
- **`ActivityFeedSection`**: `SectionHeader` + `FlatList` (or `map` inside ScrollView — prefer `map` since parent is ScrollView and items are ≤30). Each item: avatar circle (initials from `displayName`), `message` or `message_es` based on lang, relative time via inline `formatRelativeTime(createdAt)` helper, type icon. Empty state card.
- **`ConnectionPromptCard`**: `Card` with `backgroundColor: Colors.textHeading` (Warm Navy). Prompt text in `Typography.accent` (Caveat) 22pt, `color: Colors.background` (Soft Cream). `OutlineButton` customized with `borderColor: Colors.background, color: Colors.background` via `style` prop override.

**Helper functions** (module-level in the file):
```ts
function getInitials(name: string | null): string  // "John Doe" → "JD", null → "?"
function formatRelativeTime(ms: number): string    // returns "2m ago", "1h ago", "3d ago"
function getActivityIcon(type: ActivityType): LucideIcon  // trophy/zap/heart/star
```

---

### Step 5 — Update `i18n/index.ts`

Extend the `home` key in both `en` and `es` translations. Add all new keys inline in the existing `resources` object.

**New keys under `home`:**

```ts
// English
home: {
  title: 'Home',
  subtitle: 'Your squad is waiting',
  sidelineThisWeek: 'Your Sideline This Week',
  joinSquadNudge: 'Join a squad nearby →',
  liveNow: 'LIVE',
  parentsActiveNow: '{{count}} parent active now',
  parentsActiveNow_other: '{{count}} parents active now',
  joinChat: 'Join Chat →',
  thisWeeksChallenge: "THIS WEEK'S CHALLENGE",
  acceptChallenge: 'Accept Challenge',
  markComplete: 'Mark Complete ✓',
  completed: 'Completed ✓',
  whatsHappening: "What's Happening",
  activityEmpty: 'Be the first to do something! Join a squad or play a game.',
  shareInSquadChat: 'Share in Squad Chat',
  moreMembers: '+{{count}} more',
}

// Spanish
home: {
  title: 'Inicio',
  subtitle: 'Tu equipo te espera',
  sidelineThisWeek: 'Tu Sideline Esta Semana',
  joinSquadNudge: 'Únete a un equipo cercano →',
  liveNow: 'EN VIVO',
  parentsActiveNow: '{{count}} padre activo ahora',
  parentsActiveNow_other: '{{count}} padres activos ahora',
  joinChat: 'Unirse al Chat →',
  thisWeeksChallenge: 'RETO DE ESTA SEMANA',
  acceptChallenge: 'Aceptar Reto',
  markComplete: 'Marcar como Completo ✓',
  completed: 'Completado ✓',
  whatsHappening: '¿Qué está pasando?',
  activityEmpty: '¡Sé el primero en hacer algo! Únete a un equipo o juega un juego.',
  shareInSquadChat: 'Compartir en Chat del Equipo',
  moreMembers: '+{{count}} más',
}
```

---

### Step 6 — Add new Cloud Functions to `functions/src/index.ts`

Append to the existing file. Do not modify existing exports.

**`activateWeeklyChallenge`** — Scheduled `0 5 * * 1` (Monday 00:00 ET = 05:00 UTC):
```ts
export const activateWeeklyChallenge = functions.pubsub
  .schedule('0 5 * * 1')
  .timeZone('America/New_York')
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    // Deactivate all current active challenges
    const activeSnap = await admin.firestore().collection('challenges').where('isActive', '==', true).get();
    const batch = admin.firestore().batch();
    activeSnap.docs.forEach(d => batch.update(d.ref, { isActive: false }));
    // Activate challenge for current week: weekStart <= now <= weekEnd
    const toActivate = await admin.firestore().collection('challenges')
      .where('weekStart', '<=', now)
      .where('weekEnd', '>=', now)
      .limit(1).get();
    toActivate.docs.forEach(d => batch.update(d.ref, { isActive: true }));
    await batch.commit();
  });
```
⚠️ Firestore does NOT support `<=` and `>=` on two different fields in one query. **Workaround**: query on `weekStart <= now` only, then filter `weekEnd >= now` client-side in the function. See Gotchas.

**`sendNewChallengeNotification`** — Scheduled `0 13 * * 1` (Monday 08:00 ET = 13:00 UTC):
```ts
export const sendNewChallengeNotification = functions.pubsub
  .schedule('0 13 * * 1')
  .timeZone('America/New_York')
  .onRun(async () => {
    // Fetch active challenge
    const snap = await admin.firestore().collection('challenges').where('isActive', '==', true).limit(1).get();
    if (snap.empty) return null;
    const challenge = snap.docs[0].data();
    // Fetch all user FCM tokens (from users collection where fcmToken exists)
    const usersSnap = await admin.firestore().collection('users').where('fcmToken', '!=', null).get();
    const tokens = usersSnap.docs.map(d => d.data().fcmToken).filter(Boolean);
    if (!tokens.length) return null;
    // Send in chunks of 500 (FCM multicast limit)
    const CHUNK = 500;
    for (let i = 0; i < tokens.length; i += CHUNK) {
      await admin.messaging().sendEachForMulticast({
        tokens: tokens.slice(i, i + CHUNK),
        notification: { title: 'New Weekly Challenge! 🏆', body: challenge.title },
        data: { type: 'weekly_challenge', challengeId: snap.docs[0].id },
      });
    }
    return null;
  });
```

**FCM Trigger Functions:**

```ts
// friendRequests/{requestId} onWrite — new request (before.exists == false, after.data().status == 'pending')
export const onFriendRequestReceived = functions.firestore
  .document('friendRequests/{requestId}')
  .onCreate(async (snap) => {
    const { toUserId, fromDisplayName } = snap.data();
    await notifyUser(toUserId, {
      title: 'New Friend Request',
      body: `${fromDisplayName} wants to connect!`,
      data: { type: 'friend_request', requestId: snap.id },
    });
  });

// friendRequests/{requestId} onUpdate — accepted
export const onFriendRequestAccepted = functions.firestore
  .document('friendRequests/{requestId}')
  .onUpdate(async (change) => {
    const after = change.after.data();
    if (after.status !== 'accepted') return null;
    const { fromUserId, toDisplayName } = after;
    await notifyUser(fromUserId, {
      title: 'Friend Request Accepted',
      body: `${toDisplayName} accepted your friend request!`,
      data: { type: 'friend_accepted', requestId: change.after.id },
    });
    return null;
  });

// squadMemberships/{id} onCreate — new member joined squad
export const onSquadMemberJoined = functions.firestore
  .document('squadMemberships/{membershipId}')
  .onCreate(async (snap) => {
    const { squadId, userId } = snap.data();
    // Get squad name
    const squadDoc = await admin.firestore().collection('squads').doc(squadId).get();
    if (!squadDoc.exists) return null;
    const { name, memberIds } = squadDoc.data()!;
    // Notify all OTHER current members
    const otherMembers = (memberIds as string[]).filter((id: string) => id !== userId);
    await Promise.all(otherMembers.map(uid => notifyUser(uid, {
      title: `New member in ${name}!`,
      body: 'Someone just joined your squad.',
      data: { type: 'squad_join', squadId },
    })));
    return null;
  });

// gameInvitations/{inviteId} onCreate
export const onGameInvitation = functions.firestore
  .document('gameInvitations/{inviteId}')
  .onCreate(async (snap) => {
    const { toUserId, fromDisplayName, gameType } = snap.data();
    await notifyUser(toUserId, {
      title: 'Game Invitation! 🎮',
      body: `${fromDisplayName} invited you to play ${gameType}`,
      data: { type: 'game_invite', inviteId: snap.id },
    });
  });

// Helper
async function notifyUser(userId: string, payload: { title: string; body: string; data: Record<string, string> }) {
  const userDoc = await admin.firestore().collection('users').doc(userId).get();
  if (!userDoc.exists) return;
  const fcmToken = userDoc.data()?.fcmToken;
  if (!fcmToken) return;
  await admin.messaging().send({
    token: fcmToken,
    notification: { title: payload.title, body: payload.body },
    data: payload.data,
  });
}
```

---

### Step 7 — Update `firestore.indexes.json`

Add composite indexes required by new queries:

```json
{ "collectionGroup": "challenges", "queryScope": "COLLECTION",
  "fields": [{ "fieldPath": "isActive", "order": "ASCENDING" }, { "fieldPath": "weekStart", "order": "ASCENDING" }] },

{ "collectionGroup": "connectionPrompts", "queryScope": "COLLECTION",
  "fields": [{ "fieldPath": "isActive", "order": "ASCENDING" }, { "fieldPath": "weekOf", "order": "ASCENDING" }] },

{ "collectionGroup": "activity", "queryScope": "COLLECTION",
  "fields": [{ "fieldPath": "squadId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" }] },
// Note: activity.squadId+createdAt already exists — confirm it covers the 7-day filter case

{ "collectionGroup": "notifications", "queryScope": "COLLECTION_GROUP",
  "fields": [{ "fieldPath": "read", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" }] }
```

Deploy after changes: `firebase deploy --only firestore`.

---

### Step 8 — Optional: Register `HomeFeedProvider` approach

Since the provider is self-contained in `index.tsx` (wrapping only the home screen), no changes to `app/_layout.tsx` are needed. The `HomeFeedProvider` is instantiated and torn down with the home tab.

---

## 4. Files to Create / Modify

| Action | File | What Changes |
|--------|------|--------------|
| **Create** | `services/homeFeedService.ts` | All Firestore reads + real-time listeners for home feed |
| **Create** | `context/HomeFeedContext.tsx` | State provider for home feed data + actions |
| **Create** | `components/HomeFeedSkeleton.tsx` | Reanimated shimmer skeleton for first load |
| **Replace** | `app/(tabs)/index.tsx` | Full replacement with live home feed UI |
| **Modify** | `i18n/index.ts` | Extend `home` keys in `en` and `es` translation blocks |
| **Modify** | `functions/src/index.ts` | Append 6 new Cloud Function exports |
| **Modify** | `firestore.indexes.json` | Add 3–4 new composite indexes |

---

## 5. Firestore Query Strategy

| Data | Strategy | Reason |
|------|----------|--------|
| Weekly challenge | One-shot `get()` on mount + during refresh | Changes once/week; no need for real-time |
| Connection prompt | One-shot `get()` on mount + refresh | Changes once/week |
| User challenge state | One-shot `get()` on mount; optimistic local update on accept/complete | Sub-collection read, changes infrequently |
| Activity feed | `onSnapshot` (two parallel listeners, merged) | Real-time feed — needs live updates |
| Unread notification count | `onSnapshot` | Badge count must update instantly |
| User squads (names/sports) | Batched one-shot `get()` calls on mount | Static during session |
| Live squad detection | Derived from `userSquads.activeMemberCount` | Already fetched |

**All service functions** follow the `squadService.ts` dynamic-import pattern:
```ts
const firestore = (await import('@react-native-firebase/firestore')).default;
```

---

## 6. Real-time Listener Cleanup

In `HomeFeedContext.tsx`:

```tsx
const activityUnsubRef = useRef<(() => void) | null>(null);
const notifUnsubRef = useRef<(() => void) | null>(null);

useEffect(() => {
  if (!user?.uid) return;
  // Start listeners
  activityUnsubRef.current = subscribeToActivityFeed(mySquadIds, friendIds, setActivityFeed, onError);
  notifUnsubRef.current = subscribeToUnreadCount(user.uid, setUnreadCount);

  return () => {
    activityUnsubRef.current?.();
    notifUnsubRef.current?.();
  };
}, [user?.uid, mySquadIds.join(','), friendIds.join(',')]);
// Note: join(',') creates a stable dep string; re-subscribe when squad/friend list changes
```

The `subscribeToActivityFeed` function itself returns a single cleanup function that unsubscribes both its internal listeners.

---

## 7. Skeleton Loading Approach

Use `react-native-reanimated` (already installed, v4.1.1) — **not** the gluestack `Skeleton` component, because gluestack's `startColor` prop expects a NativeWind class string, making it incompatible with our custom hex colors.

**Pattern in `components/HomeFeedSkeleton.tsx`:**
```tsx
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated';

function ShimmerBlock({ width, height, style }: { width?: DimensionValue, height: number, style?: object }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.4, { duration: 800 }), -1, true);
  }, []);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ width: width ?? '100%', height, backgroundColor: Colors.secondary, borderRadius: Radius.sm }, animStyle, style]} />;
}
```

Render 3 stacked `ShimmerBlock` groups mimicking: header bar, squad chip row, challenge card.

---

## 8. i18n Key Additions

See Step 5 above. All additions are under the `home` namespace key in the existing `resources` object in `i18n/index.ts`. No new namespaces or files needed.

---

## 9. Cloud Functions Approach

- **Scheduling**: Use `functions.pubsub.schedule(cron).timeZone('America/New_York').onRun()` — same API as existing `deactivateInactiveMembers`.
- **FCM**: Use `admin.messaging().send({ token, notification, data })` for single-user notifications. Use `admin.messaging().sendEachForMulticast({ tokens[], ... })` for broadcast (weekly challenge). Requires user documents to store `fcmToken` field — the client must call `messaging().getToken()` on app launch and write it to `users/{uid}.fcmToken` (this is a separate client-side task, noted as prerequisite).
- **Firebase Functions v5**: The existing code uses `firebase-functions` v5 (`^5.0.0`). The v1 API (`functions.pubsub`, `functions.firestore`) is still valid in v5 for Node 20. No migration needed.

---

## 10. Gotchas & Risks

### 🔴 Critical

1. **Firestore `OR` queries across fields**: The activity feed requires `squadId in [...] OR userId in [...]`. Firestore does not support this in one query. **Solution**: Two parallel `onSnapshot` listeners, client-side merge. Implemented in `subscribeToActivityFeed`.

2. **Firestore range filter on two fields**: `weekStart <= now AND weekEnd >= now` violates Firestore's "inequality filter on only one field" rule. **Solution**: In `activateWeeklyChallenge` Cloud Function, query `weekStart <= now`, then filter `weekEnd >= now` in JavaScript.

3. **FCM token storage**: None of the existing code stores `fcmToken` on the user document. The notification functions will silently no-op until the client writes the token. **Must add** to `AuthContext` or a dedicated messaging setup: call `messaging().getToken()` after login and `firestore().collection('users').doc(uid).update({ fcmToken })`. This is a prerequisite for FCM to work.

4. **`friendIds` not in existing contexts**: `AuthContext` provides `uid` but not a `friendIds[]` list. `SquadContext` has no friends data. **Solution**: In `HomeFeedContext`, fetch `users/{uid}` to get `friendIds[]` on mount. Add this to the initial data load.

### 🟡 Important

5. **Composite index for `challenges`**: `isActive == true` + `weekStart <= now` requires a composite index. Add to `firestore.indexes.json` (Step 7).

6. **`in` filter limit**: Firestore `in` queries are limited to 30 elements. If `mySquadIds` or `friendIds` exceed 30, chunk into multiple queries. Add chunking logic in `subscribeToActivityFeed`.

7. **`SquadSummary.memberIds` for avatar circles**: Live Squad Card shows up to 5 avatars by initials. `memberIds` is an array of UIDs, but `displayName` is not stored on the squad doc. **Solution**: Fetch first 5 user docs from `users` collection in `fetchUserSquads`. Or use the `MemberPreview` pattern from `fetchSquadDetail` in `squadService.ts` — reuse that helper.

8. **`userChallenges` sub-collection path**: The data model is not yet created in Firestore. The path `userChallenges/{userId}/challenges/{challengeId}` should be documented and consistent between client and Cloud Function. Choose this path and be consistent.

9. **Auth stub in dev**: `user` is `null` when Firebase isn't configured. All context effects must guard `if (!user?.uid) { setLoading(false); return; }` to avoid infinite loading state in dev.

10. **`react-native-reanimated` import**: Must import from `react-native-reanimated`, not `react-native-reanimated/src`. The babel plugin is already configured in `babel.config.js`.

### 🟢 Low Risk

11. **`ConnectionPromptCard` button**: The `OutlineButton` component uses `Colors.primary` (Baseball Red) for border and text. For the dark-background card, override via `style` prop to use `Colors.background` (Soft Cream). The component supports a `style` prop but it only affects the container. Override `borderColor` and label color by passing a customized inner Text component — or build a local `Creamy OutlineButton` style inline with `TouchableOpacity` in the card component.

12. **Progress bar on challenge**: The spec mentions a progress bar but the data model has no `progress` field. For the MVP, show the bar at 0% if `!userChallenge`, 50% if `accepted`, 100% if `completed`. Document this assumption.

13. **Deploy order**: Deploy Firestore indexes BEFORE deploying the client (indexes must be built before queries run). Deploy Cloud Functions after client if scheduling is not yet active.

---

## 11. Verification

1. **Type-check**: `npm run typecheck` — should pass with 0 errors.
2. **Lint**: `npm run lint` — should pass.
3. **Dev mode (Firebase unconfigured)**: Home screen shows skeleton briefly, then empty states for all sections (no crash). Bell shows 0 badge.
4. **With Firebase configured (staging)**:
   - Seed a `challenges` doc with `isActive: true`, `weekStart` and `weekEnd` bracketing today → challenge card appears.
   - Seed a `connectionPrompts` doc with `isActive: true`, `weekOf` = this Monday → connection card appears.
   - Seed `activity` docs with `squadId` matching a user's squad → items appear in feed.
   - Accept a challenge → button changes to "Mark Complete ✓".
   - Mark complete → button becomes non-interactive "Completed ✓" in Muted Sage.
   - Pull down to refresh → all data re-fetches.
5. **Cloud Functions**: After deploy, trigger `activateWeeklyChallenge` manually via Firebase console → correct challenge doc updated.
6. **FCM**: Write a test `fcmToken` to a user doc, deploy functions, create a `friendRequests` doc → push notification received on device.
7. **Indexes**: Run `firebase deploy --only firestore` and confirm index build completes in Firebase console before testing queries.