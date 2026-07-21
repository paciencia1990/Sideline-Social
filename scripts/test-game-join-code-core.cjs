const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  GAME_JOIN_CODE_ALPHABET,
  GAME_JOIN_CODE_RESERVATION_ATTEMPTS,
  GameJoinCodeReservationError,
  generateSecureGameJoinCode,
  normalizeGameJoinCode,
  retryGameJoinCodeReservation,
} = require('../functions/lib/gameJoinCodeCore.js');

async function run() {
  assert.equal(normalizeGameJoinCode(' 7k-pm '), '7KPM');
  assert.equal(normalizeGameJoinCode('R 4 G X'), 'R4GX');
  assert.equal(normalizeGameJoinCode('O1IX'), null);
  assert.equal(normalizeGameJoinCode('ABC'), null);
  assert.equal(normalizeGameJoinCode('ABCDE'), null);

  for (let iteration = 0; iteration < 500; iteration += 1) {
    const code = generateSecureGameJoinCode();
    assert.equal(code.length, 4);
    assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    assert.equal(/[01OI]/.test(code), false);
    assert.equal(code, code.toUpperCase());
  }
  assert.equal(generateSecureGameJoinCode(() => 0), GAME_JOIN_CODE_ALPHABET[0].repeat(4));

  let collisionAttempts = 0;
  const reserved = await retryGameJoinCodeReservation(async (candidate) => {
    collisionAttempts += 1;
    return collisionAttempts < 3 ? null : candidate;
  }, { generate: () => '7KPM' });
  assert.equal(reserved, '7KPM');
  assert.equal(collisionAttempts, 3);

  let boundedAttempts = 0;
  await assert.rejects(
    () => retryGameJoinCodeReservation(async () => {
      boundedAttempts += 1;
      return null;
    }, { generate: () => '7KPM' }),
    GameJoinCodeReservationError,
  );
  assert.equal(boundedAttempts, GAME_JOIN_CODE_RESERVATION_ATTEMPTS);

  const functionCore = fs.readFileSync(path.join(process.cwd(), 'functions', 'src', 'gameJoinCodeCore.ts'), 'utf8');
  const legacyService = fs.readFileSync(path.join(process.cwd(), 'services', 'gameService.ts'), 'utf8');
  const lobbyHook = fs.readFileSync(path.join(process.cwd(), 'hooks', 'useGameLobby.ts'), 'utf8');
  const lobbyBase = fs.readFileSync(path.join(process.cwd(), 'components', 'LobbyBase.tsx'), 'utf8');
  const gamesScreen = fs.readFileSync(path.join(process.cwd(), 'app', '(tabs)', 'games.tsx'), 'utf8');
  const translations = fs.readFileSync(path.join(process.cwd(), 'i18n', 'index.ts'), 'utf8');
  assert.doesNotMatch(functionCore, /Math\.random/);
  assert.doesNotMatch(legacyService, /generateJoinCode|fetchSessionByCode|orderByChild\(["']joinCode/);
  assert.doesNotMatch(lobbyHook, /LOCAL_JOIN_CODE|["']LOCAL["']/);
  assert.match(lobbyHook, /useRef\(createGameJoinIdempotencyKey\(\)\)/);
  assert.match(lobbyHook, /releaseGameJoinCode/);
  assert.match(lobbyBase, /spokenGameJoinCode/);
  assert.match(lobbyBase, /accessibilityLabel/);
  assert.match(lobbyBase, /Share\.share/);
  assert.match(lobbyBase, /onRetryCode/);
  assert.match(gamesScreen, /resolveAndJoinGameByCode/);
  assert.match(gamesScreen, /ROUTE_BY_JOIN_CODE_GAME/);
  assert.match(gamesScreen, /normalizeGameJoinCodeInput/);
  assert.match(gamesScreen, /disabled=\{joining \|\| !isCompleteGameJoinCode\(joinCode\)\}/);
  assert.match(translations, /Join my Sideline Social game with code \{\{code\}\}\./);
  assert.match(translations, /Únete a mi juego de Sideline Social con el código \{\{code\}\}\./);
  assert.match(translations, /Local Test/);
  assert.match(translations, /Prueba local/);

  console.log('Game Join Code generation, normalization, collision, input, and routing core tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
