# Friend Chat audit and activation notes

## Original failure

The active landing route was `app/(social)/chat/index.tsx`. Its legacy listener read the top-level Firestore `chats` collection and each conversation read `chats/{chatId}/messages`. `firestore.rules` had no `chats` match, so Firestore's default deny returned `permission-denied`. The landing listener mapped every listener error to `chat.errorBody`, whose English value was “Chat is unavailable right now. Please try again in a moment.” The screen supplied the “Could not load Chat” title.

The same legacy service let the client create conversations, provide participant IDs and sender snapshots, write messages, and update conversation summaries. Opening those rules would therefore have preserved an unsafe authorization model. The old implementation also contained a Squad Chat route and selected Squad entry points. It used Firestore only; it did not use Realtime Database, a Chat Cloud Function, a Chat index, or Chat-specific tests. The configured Firebase project is `sideline-squad`.

## Canonical V1 model

- `friendConversations/{conversationId}`: direct/group type, owner/admin projections, active/invited participant projections, privacy-safe name snapshots, counts, timestamps, and latest-message summary.
- `friendConversations/{conversationId}/members/{uid}`: the private authoritative membership, role, invitation/join/leave/removal state, mute state, read state, and send throttle. Only that user can read this full document from a client.
- `friendConversations/{conversationId}/memberProfiles/{uid}`: the minimal server-maintained roster projection (`userId`, privacy-safe name, status, role, `updatedAt`) visible under membership rules.
- `friendConversations/{conversationId}/messages/{messageId}`: server-authored text/system message, trusted sender snapshot and time, removal state, idempotency key, and `visibleToUserIds` snapshot.
- `userBlocks/{blockerUid}/blockedUsers/{blockedUid}`: callable-only private block records.
- `chatModerationReports/{reportId}`: callable-only moderation references.

Direct IDs are deterministic SHA-256 hashes of the JSON-encoded sorted UID pair, with a `direct_` prefix. This retains deterministic pair identity without delimiter-collision risk or displaying UIDs. Group IDs are generated. `MAX_CHAT_PARTICIPANTS` is 10 in the trusted Chat core and is surfaced through the client Chat service for every UI limit.

Every mutation is a `us-central1` callable. Clients can read only projected conversation/roster/message data allowed by rules and cannot create or update Chat documents. Group messages snapshot the active user IDs at send time. Message queries require the caller in `visibleToUserIds`; consequently invitees see no messages, newly accepted users cannot query pre-join history, and left/removed users lose all message access even if an old message once included their UID.

## V1 safety behavior

Blocking removes the accepted friendship symmetrically, prevents direct creation/sending and future friend requests/invitations, suppresses pushes in either direction, and creates no block notification. Existing shared groups remain intact. The blocker's client omits the blocked user's group messages, and either participant may mute or leave; other members receive no block event. Reports store references and status without deleting content automatically.

Flood protection is a per-sender, per-conversation trusted cooldown of 750 ms. A retry with the same `clientMessageId` is checked before the cooldown and returns `alreadySent`, so transport retries do not duplicate messages. There is no daily cap or paid gate.

## Read and cost boundaries

- Conversation list: active summary listener starts at 25 documents and expands in 25-document pages to a 100-document UI ceiling; each visible summary reads its caller-owned member record. Pending invitations use a separate bounded 25-document summary query. No message histories are read.
- Open conversation: one conversation read, one caller membership read, one private blocked-ID callable/query, one self-profile read for a direct friendship check, and one message listener capped at 50 documents. Earlier pages are 25 documents using a cursor. Only the open conversation has a message listener.
- Send direct message: one callable; normally 7 transaction reads (conversation, own membership, idempotency document, sender profile, friend profile, two block documents) and 3 writes (message, summary, own member). Bounded asynchronous push fan-out adds the conversation/member, block, and token reads for the one recipient, and at most one FCM send.
- Send group message with `N` active members: one callable; normally 4 transaction reads and 3 writes. Bounded push fan-out reads the conversation, at most 10 active member documents, two block documents plus a bounded token query for each of at most `N-1` recipients, and sends at most 9 FCM messages. Muted and blocked recipients are skipped.
- Mark read: one callable, one membership read, and one membership write.
- Accept invitation: one callable, two reads (conversation and own member) and three writes (private member, public roster projection, conversation projection). Opening the invitation notification also uses the existing notification acknowledgement callable to dismiss only that inbox record.

Ordinary messages create no general notification-inbox records, no per-recipient unread documents, and no Stars. Group invitations create one existing-style inbox record per invitee. Chat has no Squad, Team, location, presence, selected Squad, season, leaderboard, reward, or entitlement dependency.

## Production activation commands (not run)

From `C:\Dev\Sideline_Social_Code`, after normal release approval:

```powershell
npm.cmd --prefix functions run build
firebase.cmd deploy --project sideline-squad --only "firestore:rules,firestore:indexes"
firebase.cmd deploy --project sideline-squad --only "functions:blockFriendChatUser,functions:createFriendGroupConversation,functions:createOrOpenDirectConversation,functions:getBlockedFriendChatUserIds,functions:inviteFriendsToGroupConversation,functions:leaveFriendConversation,functions:markFriendConversationRead,functions:removeFriendGroupMember,functions:removeOwnFriendChatMessage,functions:renameFriendGroupConversation,functions:reportFriendChatMessage,functions:reportFriendChatUser,functions:respondToFriendGroupInvitation,functions:sendFriendChatMessage,functions:setFriendConversationMuted,functions:setFriendGroupAdminRole,functions:transferFriendGroupOwnership,functions:sendFriendRequest"
```

No production data migration is required: the canonical collection is new and the denied legacy `chats` documents are intentionally not imported. A read-only pre-deployment audit may use the Firebase console to confirm the two `friendConversations` summary indexes and the `messages` visibility/time index are building or enabled. Do not delete legacy data as part of activation; any later retention cleanup should be a separately approved, backed-up operation.
