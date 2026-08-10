const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('../functions/lib/bombDefusalCore.js');

const root = path.resolve(__dirname, '..');
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

assert.equal(core.BOMB_ROLE_SCHEMA_VERSION, 3);
assert.equal(core.BOMB_COMMAND_COUNT, 6);
assert.equal(core.BOMB_MAX_STRIKES, 1);

const allChallenges = [
  ...core.BOMB_CHALLENGE_BANK.direct,
  ...core.BOMB_CHALLENGE_BANK.interpretation,
  ...Object.values(core.BOMB_CHALLENGE_BANK.reasoning).flat(),
  ...core.BOMB_CHALLENGE_BANK.combined,
];
assert.ok(allChallenges.length >= 15, 'the curated bank must provide meaningful replay variety');

for (const challenge of allChallenges) {
  assert.equal(core.validateBombChallenge(challenge), true, `${challenge.challengeId} must pass server validation`);
  assert.equal(challenge.options.length, 4);
  assert.equal(new Set(challenge.options.map((option) => option.id)).size, 4);
  assert.equal(new Set(challenge.options.map((option) => option.number)).size, 4);
  assert.equal(challenge.options.every((option) => option.number > 0 && option.marker), true, 'controls need non-color identifiers');
  for (const locale of ['en', 'es']) {
    assert.ok(challenge.prompt[locale].trim(), `${challenge.challengeId} needs a ${locale} prompt`);
    assert.ok(challenge.explanation[locale].trim(), `${challenge.challengeId} needs a ${locale} explanation`);
    assert.equal(new Set(challenge.options.map((option) => option.label[locale].toUpperCase())).size, 4);
    const solution = core.createBombSolution(challenge, locale);
    assert.equal(challenge.options.filter((option) => option.id === solution.correctOptionId).length, 1);
    assert.ok(solution.correctOptionLabel.trim());
    assert.ok(solution.explanation.trim());
  }
}

for (const challenge of core.BOMB_CHALLENGE_BANK.reasoning.math) {
  const solution = core.createBombSolution(challenge, 'en');
  assert.equal(challenge.options.filter((option) => option.label.en === solution.correctOptionLabel).length, 1, 'math has one matching result');
  assert.equal(Number.isInteger(Number(solution.correctOptionLabel)), true, 'math answers remain whole numbers');
}
for (const challenge of core.BOMB_CHALLENGE_BANK.reasoning.word) {
  assert.equal(challenge.validation.kind, 'word');
  assert.notEqual(challenge.validation.scramble.en, challenge.validation.scramble.es, 'word scrambles are curated per language');
}
for (const challenge of core.BOMB_CHALLENGE_BANK.reasoning.riddle) {
  assert.equal(challenge.validation.kind, 'riddle');
  assert.equal(challenge.prompt.en.length < 100 && challenge.prompt.es.length < 120, true, 'riddles stay concise');
}
for (const challenge of core.BOMB_CHALLENGE_BANK.reasoning.cipher) {
  assert.equal(challenge.validation.kind, 'cipher');
  assert.ok(challenge.key?.en.includes('back 1'));
  assert.ok(challenge.key?.es.includes('1'));
}
for (const challenge of core.BOMB_CHALLENGE_BANK.combined) {
  assert.equal(challenge.validation.kind, 'combined');
  assert.equal(new Set(challenge.validation.mechanics).size, 2);
}

const alwaysFirst = () => 0;
const firstSequence = core.createBombChallengeSequence(alwaysFirst);
assert.equal(firstSequence.length, 6);
assert.equal(firstSequence[0].stage, 'direct');
assert.equal(firstSequence[1].stage, 'interpretation');
assert.equal(firstSequence[5].stage, 'combined');
assert.equal(firstSequence.slice(2, 5).every((command) => command.stage === 'reasoning'), true);
assert.equal(new Set(firstSequence.slice(2, 5).map((command) => command.category)).size, 3);
assert.equal(core.validateBombChallengeSequence(firstSequence), true);

const replaySequence = core.createBombChallengeSequence(alwaysFirst, firstSequence.map((command) => command.challengeId));
assert.notDeepEqual(
  replaySequence.map((command) => command.challengeId),
  firstSequence.map((command) => command.challengeId),
  'a rematch must not repeat the complete previous sequence when alternatives exist',
);

for (let playerCount = 2; playerCount <= 6; playerCount += 1) {
  const players = Array.from({ length: playerCount }, (_, index) => ({
    uid: `player-${index + 1}`,
    joinOrder: index + 1,
  }));
  const defuserTurns = new Map(players.map((player) => [player.uid, 0]));
  const expertTurns = new Map(players.map((player) => [player.uid, 0]));
  for (let commandIndex = 0; commandIndex < playerCount * 2; commandIndex += 1) {
    const assignment = core.assignBombRoles(players, commandIndex);
    assert.ok(assignment);
    assert.equal(assignment.defuserUserId, players[commandIndex % playerCount].uid);
    assert.equal(assignment.expertUserId, players[(commandIndex + 1) % playerCount].uid);
    defuserTurns.set(assignment.defuserUserId, defuserTurns.get(assignment.defuserUserId) + 1);
    expertTurns.set(assignment.expertUserId, expertTurns.get(assignment.expertUserId) + 1);
    for (const player of players) {
      const expectedRole = player.uid === assignment.defuserUserId
        ? 'defuser'
        : player.uid === assignment.expertUserId
          ? 'expert'
          : 'support';
      assert.equal(core.roleForBombPlayer(player.uid, assignment), expectedRole);
    }
  }
  assert.deepEqual([...defuserTurns.values()], Array(playerCount).fill(2));
  assert.deepEqual([...expertTurns.values()], Array(playerCount).fill(2));
}

const privateCommand = firstSequence[0];
const publicCommand = core.createBombPublicCommand(privateCommand, 0);
assert.equal(publicCommand.commandId, 'command-1');
assert.deepEqual(
  Object.keys(publicCommand).sort(),
  ['category', 'commandId', 'commandIndex', 'controlKind', 'options', 'stage'],
  'the public command exposes no private clue, answer, explanation, or validation metadata',
);
assert.equal(JSON.stringify(publicCommand).includes('correctOptionId'), false);
assert.equal(JSON.stringify(publicCommand).includes('prompt'), false);
assert.equal(JSON.stringify(publicCommand).includes('explanation'), false);
assert.equal(JSON.stringify(publicCommand).includes('validation'), false);
assert.equal(core.bombCommandMatches(privateCommand, { optionId: privateCommand.correctOptionId }), true);
assert.equal(core.bombCommandMatches(privateCommand, { optionId: privateCommand.options.find((option) => option.id !== privateCommand.correctOptionId).id }), false);
const expertInstruction = core.createBombExpertInstruction(privateCommand, 'en');
assert.ok(expertInstruction.prompt);
assert.equal('challengeId' in expertInstruction, false, 'server-only challenge IDs must not leak through the Expert view');
assert.equal('correctOptionId' in expertInstruction, false, 'the Expert clue must not reveal the answer');
assert.ok(core.createBombExpertInstruction(privateCommand, 'es').prompt);
assert.doesNotThrow(() => core.validateBombChallenge({ ...privateCommand, validation: undefined }));
assert.equal(core.validateBombChallenge({ ...privateCommand, validation: undefined }), false, 'malformed legacy commands fail safely');

const functionSource = source('functions/src/gameJoinCodes.ts');
const serviceSource = source('services/gameJoinCodeService.ts');
const screenSource = source('src/game/BombDefusalScreen.tsx');
const rulesSource = source('database.rules.json');
const rewardSource = source('functions/src/sidelineStarsCore.ts');

assert.match(functionSource, /assignment\.defuserUserId !== uid/);
assert.match(functionSource, /role === 'expert'[\s\S]*createBombExpertInstruction/);
assert.match(functionSource, /solution:[\s\S]*=== 'playing'[\s\S]*createBombSolution/);
assert.match(functionSource, /const outcome = !correct[\s\S]*'exploded'/);
assert.match(functionSource, /const nextCommandIndex = correct \? currentCommandIndex \+ 1 : currentCommandIndex/);
assert.match(functionSource, /roleRevision:[\s\S]*\+ \(correct && outcome === 'playing' \? 1 : 0\)/);
assert.match(functionSource, /processedSubmissions/);
assert.match(functionSource, /validateBombChallengeSequence/);
assert.match(functionSource, /rewardEligible: false/, 'abandoned rounds remain ineligible');
assert.match(functionSource, /completionReason: 'timeout'[\s\S]*strikeCount: BOMB_MAX_STRIKES/);
assert.doesNotMatch(serviceSource, /nextStep\??:/, 'submission responses never return a private next command');
assert.match(screenSource, /playerView\.role === "defuser"/);
assert.match(screenSource, /playerView\.role === "expert"/);
assert.match(screenSource, /interactive=\{playerView\.role === "defuser"\}/);
assert.match(screenSource, /solution\.correctOptionLabel[\s\S]*solution\.explanation/);
assert.doesNotMatch(screenSource, /generateBombPattern|validateStep|currentStep/);
assert.match(rulesSource, /roleSchemaVersion'\)\.val\(\) == 3/);
assert.match(rulesSource, /"gameSessionSecrets"[\s\S]*?"\.read": false/);
assert.match(rewardSource, /completionStars: input\.outcome === 'defused' \? 5 : 0/);

console.log('Bomb Defusal challenge progression, localization, validation, role isolation, detonation, and reward tests passed.');
