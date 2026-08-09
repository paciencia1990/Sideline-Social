const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  BOMB_COMMAND_COUNT,
  BOMB_ROLE_SCHEMA_VERSION,
  assignBombRoles,
  bombCommandMatches,
  createBombPublicCommand,
  roleForBombPlayer,
} = require('../functions/lib/bombDefusalCore.js');

const root = path.resolve(__dirname, '..');
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

assert.equal(BOMB_ROLE_SCHEMA_VERSION, 2);
assert.equal(BOMB_COMMAND_COUNT, 5);

for (let playerCount = 2; playerCount <= 6; playerCount += 1) {
  const players = Array.from({ length: playerCount }, (_, index) => ({
    uid: `player-${index + 1}`,
    joinOrder: index + 1,
  }));
  const defuserTurns = new Map(players.map((player) => [player.uid, 0]));
  const expertTurns = new Map(players.map((player) => [player.uid, 0]));

  for (let commandIndex = 0; commandIndex < playerCount * 2; commandIndex += 1) {
    const assignment = assignBombRoles(players, commandIndex);
    assert.ok(assignment, `${playerCount} players must always receive two active roles`);
    assert.equal(assignment.defuserUserId, players[commandIndex % playerCount].uid);
    assert.equal(assignment.expertUserId, players[(commandIndex + 1) % playerCount].uid);
    assert.notEqual(assignment.defuserUserId, assignment.expertUserId);
    defuserTurns.set(assignment.defuserUserId, defuserTurns.get(assignment.defuserUserId) + 1);
    expertTurns.set(assignment.expertUserId, expertTurns.get(assignment.expertUserId) + 1);
    for (const player of players) {
      const expectedRole = player.uid === assignment.defuserUserId
        ? 'defuser'
        : player.uid === assignment.expertUserId
          ? 'expert'
          : 'support';
      assert.equal(roleForBombPlayer(player.uid, assignment), expectedRole);
    }
  }
  assert.deepEqual([...defuserTurns.values()], Array(playerCount).fill(2));
  assert.deepEqual([...expertTurns.values()], Array(playerCount).fill(2));
}

const privateCommand = { type: 'cut_wire', color: 'blue' };
const publicCommand = createBombPublicCommand(privateCommand, 0);
assert.equal(publicCommand.commandId, 'command-1');
assert.equal(publicCommand.options.length, 4);
assert.deepEqual(
  Object.keys(publicCommand).sort(),
  ['commandId', 'commandIndex', 'options', 'type'],
  'the public command exposes no answer or instruction field',
);
assert.equal(JSON.stringify(publicCommand).includes('correctAnswer'), false);
assert.equal(JSON.stringify(publicCommand).includes('instruction'), false);
assert.equal(publicCommand.options.every((option) => option.number > 0 && option.marker), true);
assert.equal(bombCommandMatches(privateCommand, { color: 'blue' }), true);
assert.equal(bombCommandMatches(privateCommand, { color: 'red' }), false);

const functionSource = source('functions/src/gameJoinCodes.ts');
const serviceSource = source('services/gameJoinCodeService.ts');
const screenSource = source('src/game/BombDefusalScreen.tsx');
const rulesSource = source('database.rules.json');

assert.match(functionSource, /assignment\.defuserUserId !== uid/);
assert.match(functionSource, /role === 'expert' \? command : null/);
assert.match(functionSource, /bomb_command_stale/);
assert.match(functionSource, /processedSubmissions/);
assert.match(functionSource, /rewardEligible: false/);
assert.doesNotMatch(serviceSource, /nextStep\??:/, 'the client callable result never returns the next private command');
assert.match(screenSource, /getBombDefusalPlayerView/);
assert.match(screenSource, /playerView\.role === "defuser"/);
assert.match(screenSource, /playerView\.role === "expert"/);
assert.match(screenSource, /interactive=\{playerView\.role === "defuser"\}/);
assert.doesNotMatch(screenSource, /generateBombPattern|validateStep|currentStep/);
assert.match(rulesSource, /roleSchemaVersion/);
assert.match(rulesSource, /correctAnswer/);
assert.match(rulesSource, /"gameSessionSecrets"[\s\S]*?"\.read": false/);

console.log('Bomb Defusal role rotation, sanitized views, server authority, and client role rendering tests passed.');
