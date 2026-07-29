const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");

const gameState = read("src", "game", "triviaBlitz", "gameState.ts");
const scoring = read("src", "game", "triviaBlitz", "scoring.ts");
const turnManager = read("src", "game", "triviaBlitz", "turnManager.ts");
const types = read("src", "game", "triviaBlitz", "types.ts");
const joinCodeService = read("services", "gameJoinCodeService.ts");
const gameLobby = read("hooks", "useGameLobby.ts");
const triviaFunctions = read("functions", "src", "triviaGame.ts");

const mutationModules = [gameState, scoring, turnManager].join("\n");
assert.doesNotMatch(
  mutationModules,
  /\b(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction|serverTimestamp|increment|arrayUnion)\b/,
  "Trivia client mutation modules must not write directly to Firestore.",
);
assert.doesNotMatch(
  mutationModules,
  /questions\.json|questionSelection|questionHistory/,
  "Trivia client mutation modules must not import or select from the private answer bank.",
);
assert.doesNotMatch(
  mutationModules,
  /firebase\/firestore/,
  "Trivia session command modules must use callables; live reads belong in participant subscriptions.",
);

assert.match(gameState, /httpsCallable/, "Trivia mutations must use Firebase callable functions.");
for (const callableName of [
  "createTriviaGameSession",
  "resumeTriviaGameSession",
  "setTriviaPlayerReady",
  "startTriviaGameSession",
  "submitTriviaAnswer",
  "advanceTriviaGameSession",
  "resetTriviaGameSession",
  "endTriviaGameSession",
]) {
  assert.match(
    gameState,
    new RegExp(`["']${callableName}["']`),
    `Missing ${callableName} callable contract.`,
  );
}

for (const requiredSubmitField of [
  "sessionId: string",
  "questionIndex: number",
  "answerIndex: number",
  "submissionId: string",
]) {
  assert.match(
    gameState,
    new RegExp(requiredSubmitField),
    `submitTriviaAnswer must include ${requiredSubmitField}.`,
  );
}

const questionType = types.slice(
  types.indexOf("export type TriviaQuestion ="),
  types.indexOf("export type TriviaPlayer ="),
);
assert.doesNotMatch(
  questionType,
  /\banswer\s*:/,
  "The participant-readable TriviaQuestion type must never contain an answer key.",
);

const sessionType = types.slice(
  types.indexOf("export type TriviaSession ="),
  types.indexOf("export type TriviaParentSession ="),
);
for (const publicField of [
  "questionCount",
  "currentQuestion",
  "answerResult",
  "questionStartedAt",
  "questionEndsAt",
  "hostPlayerId",
]) {
  assert.match(sessionType, new RegExp(`\\b${publicField}\\b`), `TriviaSession is missing ${publicField}.`);
}
assert.doesNotMatch(
  sessionType,
  /\bselectedQuestions\b|\bselectionRevealed\b/,
  "The public session must not retain the legacy answer-bearing question array or reveal flag.",
);

assert.match(
  scoring,
  /export \{ submitTriviaAnswer \} from "\.\/gameState"/,
  "The scoring module must expose only the server-authoritative submission boundary.",
);
assert.doesNotMatch(scoring, /firebase\/firestore/, "The scoring module must not import Firestore.");
assert.match(
  turnManager,
  /export \{ advanceTriviaGameSession \} from "\.\/gameState"/,
  "The turn manager must expose only the server-authoritative advancement boundary.",
);
assert.doesNotMatch(turnManager, /firebase\/firestore/, "The turn manager must not import Firestore.");

assert.match(
  joinCodeService,
  /export async function setRealtimeGamePlayerReady/,
  "The shared lobby service must expose its authenticated ready-state callable.",
);
assert.match(
  joinCodeService,
  /["']setRealtimeGamePlayerReady["']/,
  "The ready-state wrapper must call setRealtimeGamePlayerReady.",
);
assert.match(
  joinCodeService,
  /sessionId: string;[\s\S]*ready: boolean/,
  "The ready-state wrapper must send only the session ID and authenticated caller's desired state.",
);
assert.doesNotMatch(
  gameLobby,
  /import \{[^}]*\bupdate\b[^}]*\} from ['"]firebase\/database['"]/,
  "The shared lobby must not import the direct Realtime Database update API.",
);
assert.doesNotMatch(
  gameLobby,
  /\bupdate\(ref\(rtdb/,
  "The shared lobby must not mutate realtime game sessions directly.",
);
assert.match(
  gameLobby,
  /setRealtimeGamePlayerReady\(\{ sessionId, ready: !self\.ready \}\)/,
  "Bomb Defusal and Spot the Difference ready state must cross the callable boundary.",
);
assert.match(
  gameLobby,
  /if \(gameType === ['"]triviaBlitz['"]\) \{\s*await startTriviaSession\(sessionId\);\s*return;\s*\}\s*await updateGameJoinCodeStatus/,
  "Trivia uses its atomic Firestore start callable, while RTDB games use the server-controlled status transition.",
);
assert.match(
  triviaFunctions,
  /gameJoinSessionLinks[\s\S]*gameJoinCodes[\s\S]*status: 'started'/,
  "Trivia start must commit canonical gameplay and JOIN-code routing state in one Firestore transaction.",
);
assert.match(
  triviaFunctions,
  /submitTriviaAnswer[\s\S]*consumeAnswerAttempt\(uid,\s*sessionId\)/,
  "Trivia answer submissions must cross a bounded per-user, per-session abuse limit.",
);
assert.match(
  triviaFunctions,
  /const ANSWER_LIMIT\s*=\s*\d+[\s\S]*resource-exhausted[\s\S]*rate_limited/,
  "Trivia answer throttling must fail with a safe callable rate-limit error.",
);

console.log("Trivia callable client contract tests passed.");
