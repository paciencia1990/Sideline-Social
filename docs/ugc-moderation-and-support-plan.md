# User-Generated Content Moderation and Support Plan

Status: **Repository controls implemented; operator staffing, final policy, support endpoint, and production deployment remain required.**

## Covered content

- Friend-chat messages and users.
- Team announcements and announcement replies.
- Private parent/coach text and voice messages.
- Adult public profile names and community/team/Squad identity fields.

Friend chat supports reporting and blocking. Team announcements, replies, and private messages use the authenticated `reportTeamContent` callable. Reports contain the reporter, reported account, reason, timestamp, immutable content snapshot, content path identifiers, and open/review state. Direct client access to report collections is denied.

Blocking removes the friendship, prevents direct messaging, excludes blocked accounts from suggestions/requests where implemented, and hides their shared friend-chat messages. Users can review and unblock accounts from Settings. Coaches/staff can remove team replies and announcements according to active team roles.

Server-side severe-content screening covers friend chat, text/voice team announcement metadata, private team text/captions, and announcement replies. It is intentionally limited and supplements—not replaces—human reporting and review.

## Operator workflow

1. Monitor `chatModerationReports` and `contentModerationReports` through a restricted administrative process; never grant ordinary clients access.
2. Triage credible threats, child-privacy exposure, sexual content involving minors, and imminent safety risks immediately.
3. Target initial review within **24 hours for urgent safety reports** and **72 hours for other reports**. Owner/legal counsel must approve these commitments before publication.
4. Preserve the report and minimum evidence required by the approved retention policy. Avoid copying child information into external tickets.
5. Remove violating content with existing trusted deletion/moderation functions or restricted Firebase administration.
6. Restrict or disable abusive Firebase Authentication accounts and revoke sessions when warranted. Record the decision and reviewer without exposing it to clients.
7. Notify affected users only when safe and consistent with the final policy. Escalate imminent danger to appropriate emergency or legal channels.
8. Protect against reporter abuse: duplicate reports are deterministic per reporter/content; repeated malicious reporting should be reviewed and sanctioned.

## Before submission

- Publish final Community Guidelines, Terms, Privacy Policy, and a monitored support/safety contact.
- Assign trained report reviewers and an escalation owner.
- Define retention, appeals, law-enforcement, and child-safety procedures with counsel.
- Deploy and emulator/physical-device test all report, block, unblock, filtering, deletion, and coach moderation functions.
- Confirm the review backend remains monitored throughout TestFlight and App Review.

Support URL/email: **[OWNER REQUIRED]**.

