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
## Coach Mode / Teams

Coach Mode keeps Teams separate from Squads. Squads remain the location/community layer; Teams are private spaces for coach/staff communication.

Firestore rules needed before production use:

- `teams/{teamId}`: authenticated team members can read their team; only coaches/staff or trusted creation flows can create/update team metadata.
- `teams/{teamId}/members/{userId}`: team members can read active membership records for their team; users can join by valid invite code as parent; coaches/staff can manage staff/parent membership as needed.
- `teams/{teamId}/announcements/{announcementId}`: active team members can read announcements for their team; only `coach`, `assistantCoach`, or `teamParent` members can create coach announcements.
- `teams/{teamId}/announcements/{announcementId}/replies/{replyId}`: active team members can create replies when `allowReplies` is true.
- Private replies using `replyType: "privateToCoach"` need staff-only read rules before exposing that UI broadly.
- Squad membership and Squad chat rules should remain separate from team membership and team announcements.
