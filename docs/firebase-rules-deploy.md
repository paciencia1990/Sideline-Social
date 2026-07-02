# Firebase Rules Deploy Guide

Use this only after confirming the local `firestore.rules` file is the ruleset you want on the Firebase project used by the app.

## 1. Sign in to Firebase CLI

```bash
firebase login
```

## 2. Confirm or select the Firebase project

This repo includes `.firebaserc` with the app project from `config/firebase.ts`:

```txt
sideline-squad
```

To confirm the selected project:

```bash
firebase use
```

To choose a different project or reconnect the repo:

```bash
firebase use --add
```

## 3. Deploy only Firestore rules

```bash
firebase deploy --only firestore:rules
```

Warning: deploying local Firestore rules overwrites the Firestore rules currently configured in the Firebase Console for the selected project.

## 4. Test Coach Mode team creation

1. Restart the app after the deploy finishes.
2. Sign in on the Android device or emulator.
3. Open Coach Mode.
4. Create a team with a team name and sport.
5. Confirm the team is created, the invite code appears, and the signed-in user is listed as coach.


## Data-shape notes

These rules match the current Coach Mode app writes:

- team documents include `createdBy`, `coachIds`, `parentIds`, `inviteCode`, and team metadata.
- member documents include `userId`, `teamId`, `displayName`, `role`, and `status`.
- announcements include `createdBy`, `audience`, and `allowReplies`.
- replies include `userId` and `replyType`.

Team reads are restricted to active team members. The current join-by-invite screen queries `teams` by `inviteCode`; that broad collection query is intentionally not opened in these MVP rules. If join-by-code needs production support, use a dedicated invite lookup document or a server-side callable join flow instead of making all team documents listable.

The team creation batch writes these paths:

```txt
teams/{teamId}
teams/{teamId}/members/{uid}
users/{uid}
```