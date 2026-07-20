# TestFlight Test Plan

## Setup

1. Create an internal tester group in App Store Connect and add trusted team members.
2. After internal acceptance, create an external group and provide Beta App Review information.
3. Use fictional accounts and data. Never distribute production passwords in source control.
4. Configure a monitored feedback email: **[OWNER REQUIRED]**.

## Beta description

Test Sideline Social’s parent and coach experiences, private team communication, friend and Squad connections, weekly challenges, leaderboard, notifications, and mini-games. Report crashes, privacy concerns, confusing permissions, navigation failures, or content-safety issues.

## Physical-device matrix

- Small supported iPhone, standard iPhone, and current large/Dynamic Island iPhone.
- iOS 16.4 minimum and the current public iOS release.
- English and Spanish; default and larger Dynamic Type.
- VoiceOver, reduced motion, light/dark system appearances where the app responds.
- Wi-Fi, cellular, offline transition, slow network, background/foreground, force-close/relaunch.

## Required scenarios

- Fresh install, account creation, sign-in/reset/sign-out/session persistence, Parent/Coach onboarding and switching.
- Notification opt-in/denial, foreground/background/terminated delivery, deep links, account switching, invalid-token cleanup.
- Foreground location allowed/denied/Settings recovery and nearby Squad discovery.
- Microphone allowed/denied/Settings recovery, recording cleanup, upload interruption, and playback.
- My Teams, child selection, join code, roster authorization, announcements/replies, report/block/unblock, and deletion/moderation.
- Friend requests/chat; blocked content must not continue reaching the blocker where enforcement applies.
- Weekly Challenge exactly-once reward and Squad leaderboard refresh/ties.
- Bomb Defusal, Trivia Blitz randomization/solo/multiplayer, and Spot the Difference scrolling/zoom/taps/timer/reset.
- Permanent account deletion with a disposable account, including interrupted/retried deletion and sole-owner blocker.

## Promotion criteria

No reproducible crash or data exposure; permission denials remain usable; authentication and protected-route regressions absent; account deletion succeeds; reporting/blocking work; push deep links work on a physical device; all critical English/Spanish screens are usable; legal/support URLs are final; automated checks and production build/archive inspection pass.

External TestFlight review and public App Review are separate Apple processes. The prepared submission command is `npx eas-cli@latest submit --platform ios --latest`; do not run it without explicit authorization.

