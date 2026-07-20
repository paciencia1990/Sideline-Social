# Apple Accessibility Readiness

Status: **Repository audit complete; physical VoiceOver and Dynamic Type verification remains required.** Do not claim full accessibility support in App Store Connect yet.

## Repository findings

- Major buttons generally use accessibility roles/labels and minimum touch targets.
- Password fields are obscured by default and provide a fixed-size labeled visibility control.
- Loading/error states frequently use live regions and visible text.
- Safe-area-aware tabs and screen wrappers are present.
- English and Spanish strings are provided for the new settings, deletion, notification, and moderation paths.
- Some screens use fixed font sizes, dense horizontal rows, icon-only controls, custom games, maps, and gesture surfaces that require device verification.

## Required manual audit

- VoiceOver reading order and focus after navigation, alerts, deletion confirmation, loading, and errors.
- Every icon-only button’s spoken label, including back, notifications, message actions, password visibility, game controls, and report actions.
- Dynamic Type at the largest accessibility sizes: no clipped labels, hidden buttons, overlapping cards, or inaccessible horizontal controls.
- Contrast for primary/orange text, disabled controls, badges, map overlays, game feedback, and error states.
- Color-independent communication of selected, error, win/loss, and leaderboard states.
- Keyboard avoidance/dismissal on sign-in, onboarding, replies, settings, and deletion.
- Spot the Difference and other gesture games with VoiceOver; document any gameplay limitation truthfully.
- Reduced Motion behavior for countdowns, Lottie animations, and screen transitions.

## App Store Connect recommendation

Until the physical audit passes, do not select broad claims such as VoiceOver, Larger Text, Sufficient Contrast, or Reduced Motion as fully supported. After testing, select only the individual features that work throughout all core account, team, communication, and safety flows, and preserve test evidence for each claim.

