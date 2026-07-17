# Squad administrator recovery

Squad authority comes from an active `squadMemberships` record with `squadRole: "admin"`. The historical `createdBy` or `creatorId` value is not sufficient after that creator leaves.

## Audit (dry-run by default)

From the repository root:

```powershell
node .\scripts\migrate-squad-admins.cjs --project sideline-squad
```

The command reports aggregate counts only. It does not assign a random, long-standing, active, staff, Parent-mode, or Coach-mode member. `--apply` is optional and only self-heals an active recorded creator whose membership has no explicit role; it never changes an explicit `member` role and never repairs an orphan automatically.

## Manual recovery review

An active member may create a pending `squadAdminAccessRequests/{squadId}__{requesterUserId}` record through `requestSquadAdminAccess`. The request grants no authority.

A trusted platform administrator with the existing `admin` or `platformAdmin` custom claim may invoke `reviewSquadAdminAccessRequest` with `squadId`, `requesterUserId`, and `decision: "approve" | "decline"`. Approval runs in a transaction and succeeds only when:

- the request is still pending;
- the requester still has an active durable Squad membership; and
- the Squad still has no active administrator.

Approval sets the explicit membership role and records the trusted reviewer and timestamp. Reviewers should confirm the requester through the platform's private support process before approval; no review control is exposed in the consumer app.

## Physical-device verification

Use three real accounts in the same Squad:

- Account A: original creator and current administrator.
- Account B: ordinary active member.
- Account C: second ordinary active member.

Verify this sequence on Android:

1. Account A tries to leave as the sole administrator and sees the dedicated last-admin explanation instead of the ordinary leave confirmation.
2. Account A invites Account B. Account B opens the notification deep link, reviews the responsibility copy, and declines. Account A must still be unable to leave.
3. Account A sends a new invitation and Account B accepts. Both accounts appear in the administrator roster.
4. Account A leaves. The Squad, seasons, standings, announcements, memberships, venue, and sport remain intact. Account A has no administrator or season controls; Account B retains them.
5. Account B invites Account C and Account C accepts. Account B steps down and remains an ordinary member. Account C cannot step down or leave while they are the final administrator.
6. Restart the app and sign in again to confirm roles and invitation state persist.

Repeat the flow in English and Spanish, with a large Android font size, and with TalkBack enabled. Confirm focus reaches every selector and confirmation action, names and buttons wrap without clipping, and the final-admin warning is understandable without relying on color. Inspect the administrator response and screens to confirm they contain no email addresses, child data, coordinates, authentication data, or other private-profile fields.
