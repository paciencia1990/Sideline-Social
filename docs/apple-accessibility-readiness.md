# Apple Accessibility Readiness

Status, October 20, 2026: **Accessibility-label preparation complete; support claims await evidence.** A separate physical accessibility audit is not a mandatory launch gate established by this plan. The existing repository observations below do not certify device behavior.

## Store-label decision and scope

[Apple's current overview](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/) describes Accessibility Nutrition Labels as voluntary initially and says future mandatory reporting will receive notice. Support claims require evaluation of the app's common tasks.

Prepared approach: make no new unverified accessibility claim in the ordinary
metadata handoff. This does not select “no features supported”; unverified and
unsupported are different. No current live label state was inspected or changed
in this preparation. The app's existing labels/roles are not proof of complete
VoiceOver, Larger Text, contrast or motion support.

No separate test campaign, new build, accessibility website or badge publication
is proposed. Actual usability defects found during the existing device acceptance
still need appropriate fixes. If the owner later chooses a support claim, use
the targeted criteria below on the actual candidate and retain that evidence.
Recheck Apple's applicable submission requirements at the normal release handoff,
without scheduling recurring checks or making claims now.


## Repository findings

- Major buttons generally use accessibility roles/labels and minimum touch targets.
- Password fields are obscured by default and provide a fixed-size labeled visibility control.
- Loading/error states frequently use live regions and visible text.
- Safe-area-aware tabs and screen wrappers are present.
- English and Spanish strings are provided for the new settings, deletion, notification, and moderation paths.
- Some screens use fixed font sizes, dense horizontal rows, icon-only controls, custom games, maps, and gesture surfaces that require device verification.

## Targeted evaluation before a support claim

- VoiceOver reading order and focus after navigation, alerts, deletion confirmation, loading, and errors.
- Every icon-only button’s spoken label, including back, notifications, message actions, password visibility, game controls, and report actions.
- Dynamic Type at the largest accessibility sizes: no clipped labels, hidden buttons, overlapping cards, or inaccessible horizontal controls.
- Contrast for primary/orange text, disabled controls, badges, map overlays, game feedback, and error states.
- Color-independent communication of selected, error, win/loss, and leaderboard states.
- Keyboard avoidance/dismissal on sign-in, onboarding, replies, settings, and deletion.
- Spot the Difference and other gesture games with VoiceOver; document any gameplay limitation truthfully.
- Reduced Motion behavior for countdowns, Lottie animations, and screen transitions.

## App Store Connect recommendation

Use the existing candidate/device handoff to evaluate any support claim the owner elects to make. Preserve the retained checks below as guidance, not an added mandatory audit. Publish only claims supported by the actual device evidence; no label save or publication is authorized by this document.

