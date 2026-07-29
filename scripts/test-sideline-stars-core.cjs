const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = require("../functions/lib/sidelineStarsCore");
const weekly = require("../functions/lib/weeklyChallengeCore");
const { formatPublicUserName } = require("../functions/lib/friendSuggestionCore");

const ranked = core.rankLeaderboardEntries([
  { userId: "d", displayName: "Delta D.", sidelineStars: 50 },
  { userId: "b", displayName: "Beta B.", sidelineStars: 90 },
  { userId: "a", displayName: "Alpha A.", sidelineStars: 100 },
  { userId: "c", displayName: "Charlie C.", sidelineStars: 90 },
]);
assert.deepEqual(ranked.map((entry) => entry.userId), ["a", "b", "c", "d"]);
assert.deepEqual(ranked.map((entry) => entry.rank), [1, 2, 2, 4], "ties use competition ranking");

const reverseTie = core.rankLeaderboardEntries([
  { userId: "c", displayName: "Charlie C.", sidelineStars: 90 },
  { userId: "b", displayName: "Beta B.", sidelineStars: 90 },
]);
assert.deepEqual(reverseTie.map((entry) => entry.rank), [1, 1], "secondary display order does not split tied ranks");

assert.equal(core.getSidelineStarsTier(0), "bronze");
assert.equal(core.getSidelineStarsTier(500), "silver");
assert.equal(core.getSidelineStarsTier(1500), "gold");
assert.equal(core.getSidelineStarsTier(3000), "platinum");
assert.equal(core.getSidelineStarsTier(5000), "legend");
assert.equal(formatPublicUserName("Joann Pollard"), "Joann Pollard");
assert.equal(formatPublicUserName("D’Andre Smith"), "D’Andre Smith");
assert.equal(formatPublicUserName("Madonna"), "Madonna");
assert.equal(formatPublicUserName("parent@example.com"), null, "emails are never public display names");

const largeRanking = core.rankLeaderboardEntries(Array.from({ length: 60 }, (_, index) => ({
  userId: `member-${index}`,
  displayName: `Member ${index}`,
  sidelineStars: 1000 - index,
})));
assert.equal(largeRanking.slice(0, 50).length, 50);
assert.equal(largeRanking.find((entry) => entry.userId === "member-55").rank, 56, "actual rank survives outside the top 50");

function amount(breakdown) {
  return breakdown ? core.totalBreakdown(breakdown) : 0;
}
assert.equal(amount(core.calculateTriviaReward({ completedAllQuestions: true, correctAnswers: 10, questionCount: 10 })), 15);
assert.equal(amount(core.calculateTriviaReward({ completedAllQuestions: true, correctAnswers: 7, questionCount: 10 })), 12);
assert.equal(core.calculateTriviaReward({ completedAllQuestions: false, correctAnswers: 7, questionCount: 10 }), null);
assert.equal(amount(core.calculateSpotDifferencesReward({ terminal: true, foundCount: 10, totalDifferences: 10 })), 15);
assert.equal(amount(core.calculateSpotDifferencesReward({ terminal: true, foundCount: 6, totalDifferences: 10 })), 11);
assert.equal(core.calculateSpotDifferencesReward({ terminal: false, foundCount: 6, totalDifferences: 10 }), null);
assert.equal(amount(core.calculateBombDefusalReward({ outcome: "exploded", firstAttemptCorrectStepCount: 3, totalSteps: 4 })), 8);
assert.equal(amount(core.calculateBombDefusalReward({ outcome: "defused", firstAttemptCorrectStepCount: 4, totalSteps: 4 })), 14);
assert.equal(amount(core.calculateBombDefusalReward({ outcome: "defused", firstAttemptCorrectStepCount: 5, totalSteps: 5 })), 15);
assert.ok(weekly.WEEKLY_CHALLENGES.every((challenge) => challenge.points === 5), "every new Weekly Challenge awards five Stars");

const functionsSource = fs.readFileSync(path.join(process.cwd(), "functions/src/index.ts"), "utf8");
const seasonFunctionsSource = fs.readFileSync(path.join(process.cwd(), "functions/src/squadSeason.ts"), "utf8");
const leaderboardSource = fs.readFileSync(path.join(process.cwd(), "app/leaderboard.tsx"), "utf8");
const leaderboardService = fs.readFileSync(path.join(process.cwd(), "services/leaderboardService.ts"), "utf8");
const triviaSource = fs.readFileSync(path.join(process.cwd(), "src/game/triviaBlitz/TriviaBlitzScreen.tsx"), "utf8");
const lobbySources = [
  "bomb-defusal",
  "trivia-blitz",
  "spot-the-difference",
].map((game) => fs.readFileSync(path.join(process.cwd(), "app", "(games)", game, "Lobby.tsx"), "utf8"));

assert.doesNotMatch(functionsSource, /export const awardGameStars\s*=/, "unsafe legacy callable is not exported");
assert.match(functionsSource, /export const finalizeGameReward/);
const localRewardBoundary = functionsSource.slice(
  functionsSource.indexOf("export const createGameRewardSession"),
  functionsSource.indexOf("export const finalizeGameReward"),
);
assert.match(
  localRewardBoundary,
  /if \(!requestedSessionId\)[\s\S]*failed-precondition/,
  "local-only Bomb and Spot games cannot mint reward sessions",
);
assert.match(
  localRewardBoundary,
  /gameSessions\/\$\{requestedSessionId\}[\s\S]*participants\?\.\[uid\][\s\S]*mode:\s*'multiplayer'/,
  "reward eligibility must be rooted in a canonical RTDB participant session",
);
assert.match(seasonFunctionsSource, /membership\.membershipStatus === 'active'/, "leaderboard uses durable membership");
assert.doesNotMatch(seasonFunctionsSource.slice(seasonFunctionsSource.indexOf("getSquadLeaderboard"), seasonFunctionsSource.indexOf("readSeasonEligibleSquadIds")), /presenceStatus|lastSeenAt/, "presence does not determine ranking eligibility");
assert.match(leaderboardSource, /selectedSquadId/);
assert.match(leaderboardSource, /useFocusEffect/);
assert.match(leaderboardSource, /RefreshControl/);
assert.match(leaderboardSource, /currentUserEntry/);
assert.match(leaderboardSource, /seasonStars/);
assert.match(leaderboardSource, /currentUserLifetimeStars/);
assert.match(leaderboardSource, /noSquadTitle/);
assert.doesNotMatch(leaderboardService, /collection\(|getDocs\(|users/, "client does not query complete user profiles");
assert.doesNotMatch(triviaSource, /Team Points|pointsAwarded\} points|Trivia Score/, "Trivia does not expose another score currency");
lobbySources.forEach((lobbySource) => {
  assert.match(
    lobbySource,
    /params:\s*sessionId\s*\?\s*\{\s*sessionId\s*\}/,
    "each canonical lobby session reaches its game route",
  );
});
assert.doesNotMatch(functionsSource, /dailyGame|dailyStars|subscription|entitlement|advertisement/i, "no reward cap or monetization gate was introduced");

console.log("Sideline Stars reward and Squad leaderboard core tests passed.");
