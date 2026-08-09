const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");

const gamesSource = read("app", "(tabs)", "games.tsx");
const translations = read("i18n", "index.ts");

const gameCardsMatch = gamesSource.match(/const GAME_CARDS:[\s\S]*?const ROUTE_BY_GAME/);
assert.ok(gameCardsMatch, "Games page must keep a game card configuration.");
const gameCardsConfig = gameCardsMatch[0];

for (const gameType of ["bomb_defusal", "spot_difference", "trivia_blitz"]) {
  assert.match(gameCardsConfig, new RegExp(`gameType:\\s*"${gameType}"`), `${gameType} card must remain present.`);
}

assert.match(gameCardsConfig, /players:\s*"2-6"/, "Bomb Defusal must keep the 2-6 players range.");
assert.match(gameCardsConfig, /players:\s*"4-12"/, "Spot the Differences must keep the 4-12 players range.");
assert.match(gameCardsConfig, /players:\s*"2-20"/, "Trivia Blitz must keep the 2-20 players range.");
assert.equal((gameCardsConfig.match(/players:\s*"/g) ?? []).length, 3, "Every released game card must declare one player range.");

assert.match(gamesSource, /<Users size=\{13\} color=\{Colors\.textHeading\} \/>[\s\S]*config\.players[\s\S]*t\("games\.players"\)/, "Game cards must still render player ranges with the player label.");
assert.doesNotMatch(gamesSource, /durationMinutes|durationMinutesExact|3\s*[-\u2013]\s*8\s*min|5\s*[-\u2013]\s*15\s*min|7\s*min/i, "Games page must not render or configure time estimates.");
assert.doesNotMatch(translations, /durationMinutes|durationMinutesExact/, "Games page duration localization keys must be removed when unused.");

for (const route of [
  "/(games)/bomb-defusal/Lobby",
  "/(games)/spot-the-difference/Lobby",
  "/(games)/trivia-blitz/Lobby",
]) {
  const routePattern = new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  assert.match(gamesSource, routePattern, `${route} must remain a Games page lobby destination.`);
}

assert.match(gamesSource, /ROUTE_BY_GAME[\s\S]*bomb_defusal[\s\S]*spot_difference[\s\S]*trivia_blitz/, "Active Now routing must keep every game destination.");
assert.match(gamesSource, /onPress=\{\(\) => openGameLobby\(ROUTE_BY_GAME\[activeSession\.gameType\], activeSession\.sessionId\)\}/, "Active Now must still open the active game lobby.");
assert.match(gamesSource, /resolveAndJoinGameByCode\(joinCode\)/, "Join-code resolution must remain wired.");
assert.match(gamesSource, /ROUTE_BY_JOIN_CODE_GAME\[session\.gameType\]/, "Join-code navigation must still use the resolved game route.");
assert.match(gamesSource, /normalizeGameJoinCodeInput/, "Join-code input normalization must remain wired.");
assert.match(gamesSource, /disabled=\{joining \|\| !isCompleteGameJoinCode\(joinCode\)\}/, "Join-code button must keep its completion guard.");
assert.match(gamesSource, /GAME_CARDS\.map/, "All game cards must still render from the configuration.");
assert.match(gamesSource, /onOpen=\{\(\) => openGameLobby\(game\.route\)\}/, "Game card presses must still open the configured lobby.");

console.log("Games page card player ranges, duration removal, lobby routing, Active Now, and join-code tests passed.");
