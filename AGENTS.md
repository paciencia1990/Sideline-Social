# AGENTS.md — Sideline Squad

## Project Overview

**Sideline Squad** is a community platform for parents at youth sporting events. Built with Expo SDK 54 + React Native using file-based routing (expo-router), NativeWind v4, and gluestack-ui v3. Targets iOS and Android.

Bundle ID: `com.sidelinesquad.app`

---

## Commands

- **Start dev server:** `npm start`
- **iOS:** `npm run ios`
- **Android:** `npm run android`
- **Lint:** `npm run lint`
- **Type check:** `npm run typecheck`
- **Install packages:** use `npx expo install <pkg>` for native/runtime deps; `npm install` for dev-only

---

## Architecture

### Routing

File-based routing via **expo-router**. All routes live in `app/`.

```
app/
  _layout.tsx              Root layout — fonts, i18n, providers, ErrorBoundary, GluestackInitializer
  (auth)/
    _layout.tsx            Stack layout for auth screens
    sign-in.tsx
    sign-up.tsx
    onboarding.tsx         3-page swipeable onboarding (shown once via AsyncStorage flag)
  (tabs)/
    _layout.tsx            5-tab bottom navigator
    index.tsx              Tab 1 — Home feed
    squad.tsx              Tab 2 — Squad map (FULL IMPLEMENTATION — see Squad System below)
    games.tsx              Tab 3 — Games hub (center tab)
    friends.tsx            Tab 4 — Friends list
    profile.tsx            Tab 5 — User profile
  (games)/
    bomb-defusal.tsx       Bomb Defusal game placeholder
    spot-difference.tsx    Spot the Difference placeholder
    trivia-blitz.tsx       Trivia Blitz placeholder
  (social)/
    chat.tsx               Direct message chat (Stream Chat)
    squad-chat.tsx         Group squad chat (Stream Chat)
    squad-detail.tsx       Squad Detail screen — members, chat link, leave action
  (future)/
    league-dashboard.tsx   Locked — future feature
    marketplace.tsx        Locked — future feature
  leaderboard.tsx          Leaderboard / Sideline Stars
  +not-found.tsx
```

Root layout redirects to `(tabs)` in development (auth stub always passes). Will redirect to `(auth)/onboarding` on first launch once auth is wired.

### Design System

All design tokens live in `constants/theme.ts`. **Never hardcode hex values in screen or component files — always import from theme.**

```
Colors.primary        #C7463B  Baseball Red — CTAs, active tab, buttons
Colors.background     #F5EFE6  Soft Cream — app background (all screens)
Colors.surface        #FDFAF6  Warm White — cards, modals
Colors.secondary      #D9C4A1  Warm Sand — borders, dividers
Colors.textPrimary    #4A4A4A  Charcoal — body text
Colors.textHeading    #2F4156  Warm Navy — headers, nav labels
Colors.accentGold     #E8A84C  Soft Gold — achievements, stars, tiers
Colors.accentGreen    #7A9E82  Muted Sage — live status, success states
```

Typography fonts (loaded in root layout via `useFonts`):
- `PlayfairDisplay_*` — display and headings
- `Montserrat_*` — body and UI (400, 500, 600, 700)
- `Caveat_*` — accent/tagline ("turn wait time into game time")

Styling approach: **StyleSheet.create()** using theme tokens. Avoid NativeWind/Tailwind for custom design — use it only for gluestack-ui internal components.

### Reusable Components

All custom components live in `components/` (NOT `components/ui/` — that's gluestack):

- `ScreenWrapper` — Full screen container, #F5EFE6 bg, safe area insets
- `Card` — Rounded surface card with shadow
- `SectionHeader` — Section title in Warm Navy
- `PrimaryButton` — Red CTA button
- `OutlineButton` — Outlined variant
- `TabIcon` — Tab bar icon with active/inactive states
- `SquadMarker` — Custom map pin with sport emoji + member count bubble; `tracksViewChanges={false}` for Android perf
- `SquadCard` — Squad list card with status pill, join/joined action
- `SquadPermissionCard` — Inline location permission denied card with "Open Settings" button
- `CreateSquadSheet` — Bottom sheet (gluestack Actionsheet) for creating a new squad

### State Management

React Context + useReducer (no Redux). Three providers wrap the root layout:

- `context/AuthContext.tsx` — user, loading, signIn, signOut (stubbed; Firebase TBD)
- `context/SquadContext.tsx` — **LIVE** — nearbySquads, mySquadIds, fetchSquads, joinSquad, createSquad, leaveSquad, refreshLastActive. Backed by Firestore via squadService.
- `context/AppContext.tsx` — language, setLanguage, theme

### Squad System

**Service layer:** `services/squadService.ts`
- All Firestore read/write and `geofire-common` geohash proximity query logic
- Key exports: `fetchNearbySquads`, `joinSquad`, `createSquad`, `leaveSquad`, `updateMemberLastActive`, `fetchSquadDetail`, `getSquadStatus`, `encodeGeohash`, `calculateDistanceMiles`
- Uses `geofire-common` (`geohashForLocation`, `geohashQueryBounds`, `distanceBetween`) — pure JS, no native rebuild
- Radius fetched from Firestore `appConfig/squadConfig.squadRadiusMiles` (default: 2 miles)
- All Firebase imports are dynamic (`await import('@react-native-firebase/firestore')`) for graceful stub handling

**Map style:** `constants/mapStyle.ts` — exports `SIDELINE_MAP_STYLE` JSON for `react-native-maps` `customMapStyle` prop. Warm/muted palette using Soft Cream land, Warm Sand roads, hides POI and transit.

**Firestore data model:**
- `squads/{squadId}` — squadId, name, sport, venueName, venueLocation (GeoPoint), venueGeohash, memberIds[], activeMemberCount, createdBy, createdAt, isActive, seasonId (nullable), sponsorId (nullable), lastActivityAt
- `squadMemberships/{membershipId}` — membershipId, userId, squadId, joinedAt, lastActiveAt, isActive
- `appConfig/squadConfig` — squadRadiusMiles, maxSquadsPerUser
- `activity/{activityId}` — type, userId, squadId, createdAt
- `users/{userId}` — includes squadIds[] array

**Squad tab screen** (`app/(tabs)/squad.tsx`):
- Full-screen View (no ScreenWrapper — map must bleed edge-to-edge)
- Top 45%: `MapView` (PROVIDER_GOOGLE) with `SIDELINE_MAP_STYLE`, "You Are Here" `Circle` in Warm Navy, `SquadMarker` per nearby squad, recenter button
- Bottom 55%: `FlatList` of `SquadCard` components, "X squads near you" header, empty state
- FAB (Baseball Red, bottom-right) opens `CreateSquadSheet`
- Location permission flow on mount; denied → `SquadPermissionCard`
- `AppState` listener updates `lastActiveAt` on foreground

**Squad Detail screen** (`app/(social)/squad-detail.tsx`):
- Accessed via `router.push('/(social)/squad-detail?squadId=...')`, reads `squadId` via `useLocalSearchParams()`
- Hero card (emoji, name, venue, status pill), stats row, member avatar scroll, Open Squad Chat button, Leave Squad (overflow → AlertDialog)

**Cloud Functions** (`functions/src/index.ts`):
- `updateActiveMemberCount` — Firestore trigger on `squadMemberships/{id}` onWrite; counts active members (lastActiveAt < 3h) and updates squad's `activeMemberCount`
- `deactivateInactiveMembers` — Scheduled daily 02:00 UTC; sets `isActive=false` on memberships where `lastActiveAt` > 24h ago

**Deploy Cloud Functions:**
```bash
cd functions && npm install && npm run build
firebase deploy --only functions
```

**Firestore rules + indexes:** `firestore.rules` and `firestore.indexes.json` at project root. Deploy with `firebase deploy --only firestore`.

**⚠️ Before going to production:**
- Replace `config/firebase.ts` placeholder credentials with real Firebase project config
- Add Google Maps API key to `app.config.ts` under `android.config.googleMaps.apiKey` and `ios.config.googleMapsApiKey` — required for maps to render
- Deploy Cloud Functions and Firestore rules/indexes via Firebase CLI

### Backend (Stubbed — Firebase)

Config in `config/firebase.ts` with placeholder credentials. Replace with real Firebase project before deployment.

Services to wire:
- `@react-native-firebase/auth` — email/password, Google, Apple Sign-In
- `@react-native-firebase/firestore` — primary database (**Squad System is live against this**)
- `@react-native-firebase/database` — live game state (Realtime Database)
- `@react-native-firebase/messaging` — push notifications (FCM)
- `@react-native-firebase/functions` — Cloud Functions

### Messaging

`stream-chat` + `stream-chat-react-native` installed. DM and squad group chat via Stream Chat SDK. Screens are placeholder — wire when Stream credentials are available.

### Localization

i18next + react-i18next. Configured in `i18n/index.ts`. Supports `en` (English) and `es` (Spanish). Language persisted to AsyncStorage under key `@sideline_squad_language`.

All screens use `useTranslation()` — never hardcode user-visible strings.

i18n namespaces in use: `tabs`, `common`, `home`, `squad` (fully populated), `games`, `friends`, `profile`, `auth`, `onboarding`.

### Maps & Location

`expo-location` + `react-native-maps` installed and **live in Squad tab**.
- `expo-location.requestForegroundPermissionsAsync()` called on Squad tab mount
- `getCurrentPositionAsync({ accuracy: Balanced })` for user coords
- Geohash proximity queries via `geofire-common`
- Squad radius configurable in Firestore `appConfig/squadConfig`

### Key Files Not to Modify

- `components/GluestackInitializer.tsx` — must not be updated
- `ErrorBoundary` and `GluestackInitializer` in `app/_layout.tsx` must not be removed
- `catdoes.watch.ts` — error monitoring SDK
- `services/squadService.ts` — THREE_HOURS_MS and STARTING_SOON_MS constants are shared logic; keep in sync with Cloud Functions

### Error Tracking

CatDoes Watch SDK (`@catdoes/watch`) integrated via `catdoes.watch.ts`. Enabled by `EXPO_PUBLIC_CATDOES_WATCH_KEY` env var.

### Path Aliases

`@/` maps to the project root. Configured in `tsconfig.json` and `babel.config.js`.

---

## Planned Features (Not Yet Built)

| Feature | Status |
|---|---|
| Auth — email/password, Google, Apple | Placeholder screens only |
| Onboarding (3-page swipe) | UI built, AsyncStorage flag TBD |
| Geo squad discovery | ✅ **COMPLETE** — map, geo queries, join, create, detail |
| Squad Cloud Functions | ✅ **COMPLETE** — code in `functions/` — needs Firebase CLI deploy |
| Home feed (activity, challenges) | Placeholder |
| Bomb Defusal game | Placeholder |
| Spot the Difference game | Placeholder |
| Trivia Blitz game | Placeholder |
| Leaderboard + Sideline Stars | Placeholder |
| Weekly challenges | Placeholder |
| Friends / social connections | Placeholder |
| Stream Chat (DM + squad) | SDK installed, screens placeholder |
| Profile + badges | Placeholder |
| League Dashboard | Locked placeholder (future) |
| Local Marketplace | Locked placeholder (future) |