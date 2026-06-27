# Squad System — Implementation Plan

## 1. Context

The Squad tab is currently a placeholder that renders stub data from `SquadContext`. This plan wires it into a full geo-location squad discovery and management feature: real Firestore data, `expo-location` + `react-native-maps`, `geofire-common` geohash queries, join/create flows, a Squad Detail screen, and Cloud Functions for member count sync and inactivity cleanup.

---

## 2. Key Findings

### Existing Patterns to Follow
- **Theme tokens**: Always import from `@/constants/theme` — `Colors`, `Typography`, `Spacing`, `Radius`, `Shadow`. Never hardcode hex values.
- **StyleSheet.create()**: All styles use this pattern, not NativeWind inline classes.
- **ScreenWrapper**: Used in every screen for safe-area + background. Import from `@/components/ScreenWrapper`.
- **PrimaryButton / Card / OutlineButton**: Reuse from `@/components/`. `PrimaryButton` already handles loading state.
- **Firebase imports**: Dynamic (`await import('@react-native-firebase/firestore')`) or direct module import — no `initializeApp()`. See `config/firebase.ts` and `context/AuthContext.tsx` for pattern.
- **i18n**: Inline in `i18n/index.ts` under `resources.en.translation` / `resources.es.translation`. Use `useTranslation()` → `t('squad.keyName')`.
- **Context**: `SquadContext` wraps the whole app already; expand it rather than adding a new provider.
- **Actionsheet**: Use gluestack `Actionsheet` + `ActionsheetContent` etc. from `@/components/ui/actionsheet` for bottom sheets.
- **FAB**: Use `Fab` + `FabIcon` from `@/components/ui/fab`. Absolutely positioned by default, z-index 20.
- **AlertDialog**: Use `@/components/ui/alert-dialog` for the Leave Squad confirm dialog.
- **AuthContext**: `useAuth()` returns `{ user }` with `user.uid`. Auth is stubbed but structure is final.
- **expo-location**: Already installed (`expo-location ~19.0.8`).
- **react-native-maps**: Already installed (`1.20.1`).
- **geofire-common**: NOT installed — needs `npm install geofire-common`.
- **Cloud Functions**: Use `@react-native-firebase/functions` (installed). Cloud Functions code lives in a `/functions` directory (Node.js).

### Constraints
- `geofire-common` is a JS-only package — install with `npm install`, not `npx expo install`.
- `react-native-maps` on Android requires a Google Maps API key in `AndroidManifest.xml` via `app.config.ts`.
- The Squad screen cannot use `ScreenWrapper` as its root if the map must fill top 45% edge-to-edge — use a bare `View` with manual insets for the map, wrap list in safe area.
- `SquadContext` is already in the provider tree in `app/_layout.tsx` — expand the existing context.
- The `(social)` layout already has a Stack with `headerShown: true` — Squad Detail screen added there gets a back button for free.
- Cloud Functions are backend code — put them in `/functions/src/index.ts`. The plan does not require wiring native CI; the developer must deploy them with `firebase deploy --only functions`.

---

## 3. Implementation Steps

### Step 0 — Install packages
```bash
npm install geofire-common
```
No native rebuild needed (`geofire-common` is pure JS).

> **Google Maps API key**: Add `googleMapsApiKey` to `app.config.ts` under `android.config.googleMaps` and `ios.config.googleMapsApiKey`. This is required for `react-native-maps` on Android and for styled map JSON on iOS.

---

### Step 1 — Data types & Firestore service layer
**New file: `services/squadService.ts`**

Define all TypeScript interfaces and Firestore helper functions:
```ts
// Types
export interface Squad {
  squadId: string;
  name: string;
  sport: string;
  venueName: string;
  venueLocation: { latitude: number; longitude: number }; // deserialized from GeoPoint
  venueGeohash: string;
  memberIds: string[];
  activeMemberCount: number;
  createdBy: string;
  createdAt: number; // milliseconds
  isActive: boolean;
  seasonId: string | null;
  sponsorId: string | null;
  lastActivityAt: number;
}

export interface SquadMembership {
  membershipId: string;
  userId: string;
  squadId: string;
  joinedAt: number;
  lastActiveAt: number;
  isActive: boolean;
}
```

Functions to implement in this file:
1. `fetchAppConfig(): Promise<{ squadRadiusMiles: number }>` — fetch `appConfig` doc from Firestore. Default to `2` on error.
2. `fetchNearbySquads(lat, lng, radiusMiles): Promise<Squad[]>` — use `geofire-common`'s `geohashQueryBounds()` to build bounding box, then query `squads` collection using `venueGeohash >= lower && venueGeohash <= upper` for each bound. Filter client-side: `isActive === true`. Return squads sorted by distance (use `distanceBetween()` from `geofire-common`).
3. `joinSquad(userId, squadId, isFirstSquadEver): Promise<void>` — Firestore batch: (a) update squad `memberIds` array + `lastActivityAt`, (b) create `squadMemberships/{membershipId}` doc, (c) update `users/{userId}.squadIds` array. Then call Cloud Function `onSquadJoin` via `@react-native-firebase/functions` to award stars + post activity + send push notification (or do it inline if Cloud Functions aren't deployed yet — flag with a TODO comment).
4. `createSquad(data: CreateSquadInput, userId: string): Promise<string>` — write new squad doc (generate ID client-side with `firestore().collection('squads').doc()`), write membership, return squadId.
5. `updateLastActiveAt(userId: string): Promise<void>` — query `squadMemberships` where `userId == userId && isActive == true`, batch-update `lastActiveAt` to `Date.now()`.
6. `leaveSquad(userId: string, squadId: string): Promise<void>` — update membership `isActive = false`, remove `userId` from squad `memberIds`.

Use `geohashForPoint([lat, lng])` from `geofire-common` when creating/querying squads.

---

### Step 2 — Expand SquadContext
**Modify: `context/SquadContext.tsx`**

Replace the stub with real logic:

```ts
// New interface (Squad type imported from services/squadService.ts)
interface SquadContextType {
  nearbySquads: Squad[];
  mySquadIds: string[];
  currentSquad: Squad | null;
  loading: boolean;
  radiusMiles: number;
  fetchSquads: (lat: number, lng: number) => Promise<void>;
  joinSquad: (squadId: string) => Promise<void>;
  createSquad: (data: CreateSquadInput) => Promise<string>;
  leaveSquad: (squadId: string) => Promise<void>;
  setCurrentSquad: (squad: Squad | null) => void;
}
```

- On mount, fetch `appConfig` to get `radiusMiles`.
- `fetchSquads` calls `squadService.fetchNearbySquads()`.
- `joinSquad` calls `squadService.joinSquad()`, updates `mySquadIds` state.
- Persist `mySquadIds` in state (also read from `users/{uid}.squadIds` on auth).

---

### Step 3 — i18n keys
**Modify: `i18n/index.ts`** — add under `squad` key in both `en` and `es` translations:

```
squad.nearbyHeader         "X squads near you"  / "X equipos cerca de ti"
squad.permissionTitle      "Location Access Needed"  / "Acceso a ubicación necesario"
squad.permissionBody       "We need your location to find nearby squads."  / "..."
squad.openSettings         "Open Settings"  / "Abrir configuración"
squad.joinButton           "Join →"  / "Unirse →"
squad.joinedPill           "You're In ✓"  / "Estás dentro ✓"
squad.activeNow            "ACTIVE NOW"  / "ACTIVO AHORA"
squad.startingSoon         "STARTING SOON"  / "COMENZANDO PRONTO"
squad.quiet                "QUIET"  / "TRANQUILO"
squad.members              "{{count}} members"  / "{{count}} miembros"
squad.createTitle          "Create a Squad"  / "Crear un equipo"
squad.squadNameLabel       "Squad Name"  / "Nombre del equipo"
squad.sportLabel           "Sport"  / "Deporte"
squad.venueLabel           "Venue Name"  / "Nombre del lugar"
squad.useMyLocation        "Use My Current Location"  / "Usar mi ubicación actual"
squad.createButton         "Create Squad"  / "Crear equipo"
squad.detailChat           "Open Squad Chat"  / "Abrir chat del equipo"
squad.detailLeave          "Leave Squad"  / "Abandonar equipo"
squad.leaveConfirmTitle    "Leave Squad?"  / "¿Abandonar equipo?"
squad.leaveConfirmBody     "You'll need to rejoin to access this squad."  / "Necesitarás unirte nuevamente para acceder."
squad.leaveConfirmYes      "Leave"  / "Abandonar"
squad.leaveConfirmNo       "Cancel"  / "Cancelar"
squad.loadingSquads        "Finding squads near you..."  / "Buscando equipos cerca..."
squad.noSquads             "No squads nearby yet. Create the first one!"  / "Sin equipos cerca. ¡Crea el primero!"
squad.distance             "{{distance}} mi away"  / "A {{distance}} mi"
```

---

### Step 4 — Custom map style constant
**New file: `constants/mapStyle.ts`**

Export a JSON array for `react-native-maps` `customMapStyle` prop. Style should: use `#F5EFE6` (Soft Cream) as land color, mute POI labels, remove transit, use `#D9C4A1` (Warm Sand) for roads, `#2F4156` (Warm Navy) for water labels. Reference: https://mapstyle.withgoogle.com/ (Retro/Pale Dawn base).

Example structure:
```ts
export const SIDELINE_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#F5EFE6' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#E8E0D5' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9E8C78' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#C5D8E8' }] },
  // ... more rules as needed
];
```

---

### Step 5 — Squad tab screen (main implementation)
**Modify: `app/(tabs)/squad.tsx`** — full replacement

Structure:
```
<View flex:1>
  {!permissionGranted && <PermissionCard />}
  {permissionGranted && (
    <>
      {/* Map — 45% height */}
      <MapView
        style={{ height: SCREEN_HEIGHT * 0.45 }}
        customMapStyle={SIDELINE_MAP_STYLE}
        region={userRegion}
        showsUserLocation={false}  // we draw custom dot
      >
        {/* "You Are Here" dot — Circle overlay in Colors.textHeading */}
        <Circle center={userCoords} radius={8} fillColor={Colors.textHeading} />

        {/* Squad markers */}
        {nearbySquads.map(squad => (
          <Marker
            key={squad.squadId}
            coordinate={squad.venueLocation}
            onPress={() => highlightSquad(squad.squadId)}
          >
            {/* Custom callout: sport emoji pin in Colors.primary */}
            <SquadMarker squad={squad} isSelected={selectedSquadId === squad.squadId} />
          </Marker>
        ))}
      </MapView>

      {/* Squad list — 55% */}
      <FlatList
        data={sortedSquads}
        ListHeaderComponent={<Text>{t('squad.nearbyHeader', { count })}</Text>}
        renderItem={({ item }) => <SquadCard squad={item} />}
        keyExtractor={item => item.squadId}
      />

      {/* FAB */}
      <Fab onPress={() => setShowCreate(true)} style={{ backgroundColor: Colors.primary }}>
        <FabIcon as={AddIcon} />
      </Fab>

      {/* Create Squad bottom sheet */}
      <CreateSquadSheet isOpen={showCreate} onClose={() => setShowCreate(false)} />
    </>
  )}
</View>
```

**PermissionCard sub-component** (inline or separate file `components/SquadPermissionCard.tsx`):
- Shows MapPin icon, title, body text from i18n
- "Open Settings" button calls `Linking.openSettings()` from `expo-linking`

**SquadMarker sub-component** (`components/SquadMarker.tsx`):
- Small View: `Colors.primary` background circle/pin, sport emoji, member count bubble above

**SquadCard sub-component** (inline or `components/SquadCard.tsx`):
- Sport emoji | Squad name (Montserrat SemiBold Warm Navy) | venue + distance
- Active member count
- Status pill: compute based on `lastActivityAt` — ACTIVE NOW (<30 min), STARTING SOON (<3h), QUIET (else)
  - Colors: `Colors.accentGreen` / `Colors.accentGold` / `Colors.secondary`
- [Join →] button (`Colors.primary`) OR [You're In ✓] pill (`Colors.accentGreen`) based on `mySquadIds.includes(squadId)`
- `onPress` navigates to `/(social)/squad-detail?squadId=xxx`

**Permission flow**:
```ts
useEffect(() => {
  (async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermissionGranted(status === 'granted');
    if (status === 'granted') {
      const loc = await Location.getCurrentPositionAsync({});
      setUserCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      await fetchSquads(loc.coords.latitude, loc.coords.longitude);
    }
  })();
}, []);
```

**Foreground → update lastActiveAt**:
```ts
useEffect(() => {
  const sub = AppState.addEventListener('change', state => {
    if (state === 'active' && user?.uid) {
      updateLastActiveAt(user.uid);
    }
  });
  return () => sub.remove();
}, [user]);
```

---

### Step 6 — Create Squad bottom sheet
**New file: `components/CreateSquadSheet.tsx`**

Uses gluestack `Actionsheet` / `ActionsheetContent`:
- `TextInput` for Squad Name (pre-populated `"${sport} Squad — ${venueName}"`)
- Sport picker: horizontal `ScrollView` of pill buttons (same sports list as `auth.sports` in i18n)
- `TextInput` for Venue Name
- `Switch` (`@/components/ui/switch`) for "Use My Current Location" toggle
- `PrimaryButton` "Create Squad" with loading state
- On submit:
  ```ts
  const squadId = await createSquad({ name, sport, venueName, venueLocation: useMyLocation ? userCoords : null });
  router.push(`/(social)/squad-detail?squadId=${squadId}`);
  ```

---

### Step 7 — Squad Detail screen
**New file: `app/(social)/squad-detail.tsx`**

Access via `useLocalSearchParams()` to get `squadId`.

Layout:
- Header: Squad name (PlayfairDisplay heading), sport + venue sub-text
- Stats row: member count, active count
- Member avatars row: first 8 `Image` circles (placeholder initials if no photoURL), then "+X more" text
- `PrimaryButton` "Open Squad Chat" → `router.push('/(social)/squad-chat?squadId=...')`
- Overflow menu (three-dots icon / `TouchableOpacity`) → opens `AlertDialog` for Leave Squad confirm
- Leave Squad: calls `leaveSquad(userId, squadId)`, then `router.back()`

Uses `useAuth()` for `user.uid` and a local `useState` to load squad data from Firestore by `squadId`.

---

### Step 8 — Cloud Functions
**New directory: `functions/`**
**New files:**
- `functions/package.json` (Node 20, `firebase-functions`, `firebase-admin`)
- `functions/tsconfig.json`
- `functions/src/index.ts`

Two functions:

**`updateActiveMemberCount`** — Firestore trigger on `squadMemberships/{membershipId}`:
```ts
export const updateActiveMemberCount = functions.firestore
  .document('squadMemberships/{membershipId}')
  .onWrite(async (change) => {
    const data = change.after.exists ? change.after.data() : change.before.data();
    const squadId = data?.squadId;
    if (!squadId) return;
    const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
    const snapshot = await admin.firestore()
      .collection('squadMemberships')
      .where('squadId', '==', squadId)
      .where('isActive', '==', true)
      .where('lastActiveAt', '>=', threeHoursAgo)
      .get();
    await admin.firestore().collection('squads').doc(squadId).update({
      activeMemberCount: snapshot.size,
    });
  });
```

**`deactivateInactiveMembers`** — Scheduled (every 24h):
```ts
export const deactivateInactiveMembers = functions.scheduler
  .onSchedule('every 24 hours', async () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const snapshot = await admin.firestore()
      .collection('squadMemberships')
      .where('isActive', '==', true)
      .where('lastActiveAt', '<', cutoff)
      .get();
    const batch = admin.firestore().batch();
    snapshot.docs.forEach(doc => batch.update(doc.ref, { isActive: false }));
    await batch.commit();
  });
```

Deploy: `cd functions && npm install && cd .. && firebase deploy --only functions`

---

## 4. Files to Modify / Create

### New Files
| File | Purpose |
|------|---------|
| `services/squadService.ts` | All Firestore + geo query logic |
| `constants/mapStyle.ts` | Custom Google Maps JSON style |
| `components/SquadMarker.tsx` | Custom map pin component |
| `components/SquadCard.tsx` | Squad list card component |
| `components/CreateSquadSheet.tsx` | Create Squad bottom sheet |
| `components/SquadPermissionCard.tsx` | Location permission denied card |
| `app/(social)/squad-detail.tsx` | Squad Detail screen |
| `functions/src/index.ts` | Cloud Functions source |
| `functions/package.json` | Cloud Functions dependencies |
| `functions/tsconfig.json` | Cloud Functions TypeScript config |

### Modified Files
| File | Change |
|------|--------|
| `app/(tabs)/squad.tsx` | Full replacement with map + list + FAB + permission flow |
| `context/SquadContext.tsx` | Replace stub with real Firestore-backed context |
| `i18n/index.ts` | Add `squad.*` keys to both `en` and `es` translations |
| `app.config.ts` | Add `googleMapsApiKey` for Android + iOS |
| `app/_layout.tsx` | Add `<Stack.Screen name="(social)/squad-detail" />` if needed (usually auto-resolved by expo-router) |

---

## 5. Package Installations

```bash
# Pure JS — use npm install
npm install geofire-common
```

`expo-location` and `react-native-maps` are already in `package.json` — no install needed.

For Cloud Functions (backend only, not bundled into the app):
```bash
cd functions
npm install firebase-functions firebase-admin
npm install --save-dev typescript @types/node
```

---

## 6. Implementation Order

1. **`services/squadService.ts`** — foundation everything depends on
2. **`i18n/index.ts`** — add all i18n keys before building UI
3. **`constants/mapStyle.ts`** — needed by map screen
4. **`context/SquadContext.tsx`** — expand before touching screens
5. **`components/SquadMarker.tsx`** — small standalone component
6. **`components/SquadCard.tsx`** — small standalone component
7. **`components/SquadPermissionCard.tsx`** — small standalone component
8. **`components/CreateSquadSheet.tsx`** — depends on context
9. **`app/(tabs)/squad.tsx`** — assembles all components above
10. **`app/(social)/squad-detail.tsx`** — final screen
11. **`functions/src/index.ts`** — Cloud Functions (can be done in parallel)
12. **`app.config.ts`** — add API key last (requires developer to obtain key)

---

## 7. Potential Gotchas / Risks

| Risk | Mitigation |
|------|-----------|
| `react-native-maps` Android requires Google Maps API key | Add key to `app.config.ts` `android.config.googleMaps.apiKey`; without it the map is blank on Android |
| `geofire-common` bounding-box queries return multiple Firestore range queries — Firestore only allows one inequality filter per query | Run one query per geohash bound (`geohashQueryBounds` returns an array of `[lower, upper]` pairs), merge results in memory, then de-duplicate by `squadId` |
| Custom map markers with React Native Views inside `<Marker>` can cause layout jank on Android | Use `<Marker image={...}>` with a pre-rendered PNG instead of a View child, OR wrap the custom View with `tracksViewChanges={false}` once loaded |
| `lastActiveAt` update on foreground can hammer Firestore if user has many memberships | Batch-write all memberships in a single `writeBatch()` call in `updateLastActiveAt` |
| Squad Detail screen needs the squadId in params — expo-router dynamic params require `[squadId].tsx` filename OR `useLocalSearchParams()` with query string | Use query string `/(social)/squad-detail?squadId=xxx` with `useLocalSearchParams()` — no file rename needed |
| Firestore `GeoPoint` type vs plain `{ latitude, longitude }` | Deserialize in `squadService.ts` so components never touch the Firestore-specific `GeoPoint` class |
| Cloud Functions use `lastActiveAt` as a number (ms) — ensure client always writes `Date.now()` not a Firestore `serverTimestamp()` (which returns a special object) | Consistently use `Date.now()` on the client side; in Cloud Functions, use `admin.firestore.Timestamp.now().toMillis()` |
| `activeMemberCount` filter (3-hour window) must match between client-side status pill logic and Cloud Function trigger | Define the constant once (e.g., `THREE_HOURS_MS = 3 * 60 * 60 * 1000`) in `squadService.ts` and import it in both places |
| Auth is still stubbed (no real UID) during development | Guard all Firestore writes with `if (!user?.uid) return` — the join/create buttons should be disabled when `user` is null |

---

## 8. Key Patterns to Follow

- **No hardcoded colors**: All colors from `Colors.*` in `@/constants/theme`.
- **Fonts**: Squad name → `Typography.bodySemiBold`. Headers → `Typography.heading`. Meta text → `Typography.bodyRegular`.
- **Spacing**: Use `Spacing.xs/sm/md/lg` everywhere.
- **Cards**: Use the `Card` component from `@/components/Card` or replicate its `Shadow.card` spread for custom cards.
- **Firebase imports**: Dynamic import pattern `const firestore = (await import('@react-native-firebase/firestore')).default` to handle unconfigured native environment gracefully (matches `AuthContext` pattern).
- **Error handling**: Wrap every async Firestore call in try/catch, log with `console.warn('[SquadService] ...')`. Never crash silently.
- **i18n**: Every visible string through `t('squad.key')`. The sport names already exist as `t('auth.sports.Soccer')` etc. — reuse those keys.
- **Navigation**: `router.push()` from `expo-router` for navigation, not `navigation.navigate()`.
- **Actionsheet for bottom sheet**: Use the existing `@/components/ui/actionsheet` components — don't use a third-party modal library.
- **FAB positioning**: The `Fab` component from `@/components/ui/fab` is absolutely positioned — it overlays the map+list layout correctly. Pass `placement="bottom right"` and override background color with inline `style={{ backgroundColor: Colors.primary }}`.