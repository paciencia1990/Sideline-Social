# Backend Readiness Notes

The app safely handles permission-denied reads by returning fallback UI values, but the restored Firebase features will need production Firestore/Realtime Database rules for authenticated users.

Likely Firestore rule coverage needed later:

- `users/{userId}`: read basic profile fields for friends, leaderboard, chat labels, and squad previews; allow each signed-in user to update their own profile/location fields.
- `notifications`: allow signed-in users to count/read their own unread notifications.
- `challenges`: allow signed-in users to read active challenges.
- `connectionPrompts`: allow signed-in users to read active prompts.
- `challengeProgress`: allow signed-in users to create/update their own challenge status.
- `squads`: allow signed-in users to read active nearby squads and update membership-related fields through validated writes.
- `squadMemberships`: allow signed-in users to create/read/update their own active squad memberships.
- `activity`: allow signed-in users to read activity for their squads/friends and create safe activity entries.
- `friendRequests`: allow signed-in users to create, read, accept, decline, or cancel requests involving their own user ID.
- `chats` and `messages`: allow only chat participants to read/write chat metadata and messages.
- `triviaSessions`: allow only session players to read/write session/player state.

Likely Realtime Database rule coverage needed later:

- `/sessions/{sessionId}`: allow lobby/game players to read session state and update only their own ready/player fields; host-only start controls.
- `/gameSessions/{sessionId}`: allow squad members to read active game sessions and validated host/player updates.
- `/bombDefusal/{gameId}/result`: allow authenticated game participants to write result logs.

Until those rules are updated, the app should continue to show empty or limited states instead of crashing.