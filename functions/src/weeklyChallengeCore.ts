export type WeeklyChallengeCategory = "sidelineConnection";

export interface WeeklyChallengeDefinition {
  id: string;
  title: string;
  description: string;
  points: number;
  category: WeeklyChallengeCategory;
  isActive: boolean;
}

export const DEFAULT_TIME_ZONE = "America/New_York";

export const WEEKLY_CHALLENGES: WeeklyChallengeDefinition[] = [
  { id: "meet-new-parent", title: "Meet Someone New", description: "Introduce yourself to one parent you have not met before.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "learn-parent-child-names", title: "Learn Their Names", description: "Learn the name of another parent and their child.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "genuine-parent-compliment", title: "Share a Genuine Compliment", description: "Give another parent a genuine compliment about something unrelated to their child's performance.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "invite-parent-nearby", title: "Save a Seat", description: "Invite another parent to sit or stand near you instead of remaining alone.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "welcome-new-parent", title: "Welcome a New Parent", description: "Introduce yourself to a parent who appears new to the team, league, or activity.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "encourage-another-child", title: "Cheer Together", description: "Encourage or celebrate another parent's child during the game or practice.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "introduce-two-parents", title: "Make an Introduction", description: "Introduce two parents who have not met but may have something in common.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "help-small-sideline-need", title: "Lend a Hand", description: "Help another parent with a small sideline need, such as carrying a chair, sharing information, or briefly watching their belongings.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "ask-lighthearted-question", title: "Ask a Fun Question", description: "Ask another parent a lighthearted question, such as their favorite snack, team tradition, or sport to watch.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "start-humorous-conversation", title: "Share a Sideline Laugh", description: "Start a fun or humorous conversation with another parent about a relatable sideline moment.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "discover-shared-interest", title: "Find Common Ground", description: "Discover one interest you share with another parent that is unrelated to youth sports.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "say-hello-first", title: "Say Hello First", description: "Be the first person to say hello when arriving at a practice or game.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "talk-to-someone-alone", title: "Include Someone", description: "Start a conversation with someone who is sitting or standing alone.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "thank-team-parent", title: "Show Appreciation", description: "Thank another parent for something they contribute to the team community.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "offer-useful-tip", title: "Share a Helpful Tip", description: "Offer another parent a useful, low-pressure tip, such as where to park, what to bring, or where nearby facilities are located.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "compliment-sportsmanship", title: "Celebrate Good Sportsmanship", description: "Compliment another parent when you notice their child showing teamwork, kindness, or good sportsmanship.", points: 5, category: "sidelineConnection", isActive: true },
  { id: "connect-after-activity", title: "Stay and Connect", description: "Spend a few minutes after the activity talking with another parent instead of leaving immediately.", points: 5, category: "sidelineConnection", isActive: true },
];

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function resolveTimeZone(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date(0));
      return candidate;
    } catch {
      // Try the next timezone candidate.
    }
  }
  return DEFAULT_TIME_ZONE;
}

export function getCurrentWeekKey(timeZone?: string, now = new Date()): string {
  return getWeekInfo(resolveTimeZone(timeZone), now).weekKey;
}

export function getWeekInfo(timeZone: string, now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(read("year"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  const weekday = WEEKDAY_INDEX[read("weekday")] ?? 1;
  const localCalendarDate = new Date(Date.UTC(year, month - 1, day));
  const monday = new Date(localCalendarDate);
  monday.setUTCDate(localCalendarDate.getUTCDate() - ((weekday + 6) % 7));
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(monday.getUTCDate() + 7);
  return {
    weekKey: formatDateKey(monday),
    nextWeekKey: formatDateKey(nextMonday),
  };
}

export function getPreviousWeekKey(weekKey: string): string {
  const [year, month, day] = weekKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 7);
  return formatDateKey(date);
}

export function selectWeeklyChallenge(
  uid: string,
  weekKey: string,
  previousChallengeId?: string | null,
  catalog: WeeklyChallengeDefinition[] = WEEKLY_CHALLENGES,
): WeeklyChallengeDefinition {
  const active = catalog.filter((challenge) => challenge.isActive);
  if (active.length === 0) throw new Error("No active weekly challenges are configured.");
  let index = stableHash(`${uid}:${weekKey}`) % active.length;
  if (active.length > 1 && active[index].id === previousChallengeId) index = (index + 1) % active.length;
  return active[index];
}

export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
