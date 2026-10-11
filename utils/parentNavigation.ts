export const PARENT_DESTINATIONS = [
  { name: "index", labelKey: "tabs.home", href: "/(tabs)" },
  { name: "squad", labelKey: "tabs.squad", href: "/(tabs)/squad" },
  { name: "games", labelKey: "tabs.games", href: "/(tabs)/games" },
  { name: "friends", labelKey: "tabs.friends", href: "/(tabs)/friends" },
  { name: "profile", labelKey: "tabs.profile", href: "/(tabs)/profile" },
] as const;

export type ParentTabName = typeof PARENT_DESTINATIONS[number]["name"];

// Tabs already own their menu. Gameplay, Coach Mode and account gates retain
// their own layouts; only these Parent Mode detail routes get the extra shell.
export function getParentDetailSection(segments: readonly string[]): ParentTabName | null {
  if (segments[0] === "leaderboard") return "index";
  if (segments[0] === "teams") return "index";
  if (segments[0] === "(social)") {
    if (segments[1] === "chat") return "friends";
    if (segments[1] === "squad-detail") return "squad";
  }
  if (segments[0] === "(games)") {
    if (segments[1] === "lobbies") return "games";
    if (["bomb-defusal", "trivia-blitz", "spot-the-difference"].includes(segments[1])
      && segments[2] === "Lobby") return "games";
  }
  return null;
}
