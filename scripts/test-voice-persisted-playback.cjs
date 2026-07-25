const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(require, loaded, loaded.exports);
  return loaded.exports;
}

async function run() {
  const { normalizeVoiceMessageFields } = loadTypeScript("utils/voiceMessageNormalizer.ts");
  const currentPath = "teamVoiceMemos/team-1/privateConversations/conversation-1/message-1/reservation-1/memo.m4a";
  const current = normalizeVoiceMessageFields({
    contentType: "voice",
    senderUserId: "sender-1",
    caption: "A caption",
    voiceMemo: {
      storagePath: currentPath,
      durationMilliseconds: 6_250,
      sizeBytes: 42_000,
      mimeType: "audio/mp4",
    },
  });
  assert.deepEqual(current, {
    contentType: "voice",
    senderUserId: "sender-1",
    caption: "A caption",
    voiceMemo: {
      storagePath: currentPath,
      durationMilliseconds: 6_250,
      sizeBytes: 42_000,
      mimeType: "audio/mp4",
    },
  });

  const legacyPath = "teamVoiceMemos/team-1/announcements/announcement-1/reservation-2/memo.m4a";
  const legacy = normalizeVoiceMessageFields({
    messageType: "voice",
    senderId: "legacy-sender",
    audio: {
      audioPath: legacyPath,
      durationMs: "7300",
      fileSizeBytes: 51_000,
      mimeType: "audio/m4a",
    },
  });
  assert.equal(legacy.contentType, "voice");
  assert.equal(legacy.senderUserId, "legacy-sender");
  assert.equal(legacy.voiceMemo.storagePath, legacyPath);
  assert.equal(legacy.voiceMemo.durationMilliseconds, 7_300);
  assert.equal(legacy.voiceMemo.sizeBytes, 51_000);
  assert.equal(normalizeVoiceMessageFields({
    type: "voice",
    voicePath: legacyPath,
    durationMillis: 8_400,
  }).voiceMemo.durationMilliseconds, 8_400);

  for (const malformed of [
    { contentType: "voice" },
    { contentType: "voice", storagePath: "file:///private/local-only.m4a", durationMs: 1_000 },
    { messageType: "voice", mediaPath: "https://public.example.test/audio.m4a", durationMillis: 1_000 },
    { type: "voice", audioPath: "../memo.m4a", durationMs: 1_000 },
  ]) {
    const normalized = normalizeVoiceMessageFields(malformed);
    assert.equal(normalized.contentType, "voice");
    assert.equal(normalized.voiceMemo, null, "malformed persisted media fails closed");
  }

  const playback = loadTypeScript("utils/voicePlaybackCore.ts");
  const source = {
    kind: "persisted-message",
    messageId: "message-1",
    messageKind: "privateMessage",
    storagePath: currentPath,
  };
  assert.deepEqual(
    playback.normalizeVoicePlaybackUrlResponse({
      url: "https://signed.example.test/message",
      expiresAtMillis: 10_000,
    }, { now: 1_000 }),
    {
      url: "https://signed.example.test/message",
      expiresAtMillis: 10_000,
    },
  );
  for (const invalidResponse of [
    null,
    { downloadUrl: "https://signed.example.test/message", expiresAt: 10_000 },
    { url: "", expiresAtMillis: 10_000 },
    { url: "http://signed.example.test/message", expiresAtMillis: 10_000 },
    { url: "https://signed.example.test/message", expiresAtMillis: 500 },
  ]) {
    assert.throws(
      () => playback.normalizeVoicePlaybackUrlResponse(invalidResponse, { now: 1_000 }),
      /invalid_voice_playback|expired_voice_playback/u,
    );
  }

  const successfulProbe = await playback.probeVoicePlaybackUrl(
    "https://signed.example.test/message",
    async (_url, init) => {
      assert.equal(init.method, "GET");
      assert.equal(init.headers.Range, "bytes=0-1");
      return new Response(new Uint8Array([0, 1]), {
        headers: {
          "content-range": "bytes 0-1/42000",
          "content-type": "audio/mp4",
        },
        status: 206,
      });
    },
  );
  assert.deepEqual(successfulProbe, {
    completeObject: true,
    contentTypeAccepted: true,
    hasNonzeroBytes: true,
    httpStatusCategory: "success",
    redirectFree: true,
  });
  await assert.rejects(
    () => playback.probeVoicePlaybackUrl(
      "https://signed.example.test/message",
      async () => new Response("permission denied", {
        headers: { "content-type": "application/json" },
        status: 403,
      }),
    ),
    /voice_remote_authorization_failed/u,
  );
  await assert.rejects(
    () => playback.probeVoicePlaybackUrl(
      "https://signed.example.test/message",
      async () => new Response("<html>not audio</html>", {
        headers: { "content-type": "text/html" },
        status: 200,
      }),
    ),
    /voice_remote_unsupported_format/u,
  );
  await assert.rejects(
    () => playback.probeVoicePlaybackUrl(
      "https://signed.example.test/message",
      async () => new Response(null, {
        headers: { "content-type": "audio/mp4" },
        status: 200,
      }),
    ),
    /voice_remote_empty/u,
  );

  playback.clearVoicePlaybackUrlCache();
  playback.setVoicePlaybackAuthorizationContext("signed-in-user");
  let signedUrlCalls = 0;
  const requestSignedUrl = async () => ({
    url: `https://signed.example.test/${++signedUrlCalls}`,
    expiresAtMillis: Date.now() + 60_000,
  });
  assert.equal(await playback.resolveVoicePlaybackUri(source, requestSignedUrl), "https://signed.example.test/1");
  assert.equal(await playback.resolveVoicePlaybackUri(source, requestSignedUrl), "https://signed.example.test/1");
  assert.equal(signedUrlCalls, 1, "a valid signed URL is cached per authenticated message source");

  playback.setVoicePlaybackAuthorizationContext(null);
  playback.setVoicePlaybackAuthorizationContext("signed-in-user");
  assert.equal(await playback.resolveVoicePlaybackUri(source, requestSignedUrl), "https://signed.example.test/2");
  assert.equal(signedUrlCalls, 2, "sign-out clears all signed playback URLs");

  playback.clearVoicePlaybackUrlCache();
  signedUrlCalls = 0;
  const attemptedUris = [];
  await playback.playVoiceSourceWithOneRefresh({
    source,
    requestSignedUrl,
    playUri: async (uri) => {
      attemptedUris.push(uri);
      if (attemptedUris.length === 1) throw new Error("expired remote source");
    },
  });
  assert.deepEqual(attemptedUris, [
    "https://signed.example.test/1",
    "https://signed.example.test/2",
  ]);
  assert.equal(signedUrlCalls, 2, "one failed persisted playback gets exactly one fresh signed URL");

  playback.clearVoicePlaybackUrlCache();
  signedUrlCalls = 0;
  let failedAttempts = 0;
  await assert.rejects(() => playback.playVoiceSourceWithOneRefresh({
    source,
    requestSignedUrl,
    playUri: async () => {
      failedAttempts += 1;
      throw new Error("still unavailable");
    },
  }));
  assert.equal(failedAttempts, 2);
  assert.equal(signedUrlCalls, 2, "a persistent error never enters an infinite retry loop");

  playback.clearVoicePlaybackUrlCache();
  signedUrlCalls = 0;
  let cancelledAttempts = 0;
  await assert.rejects(() => playback.playVoiceSourceWithOneRefresh({
    source,
    requestSignedUrl,
    shouldRetry: (error) => error.message !== "voice_playback_superseded",
    playUri: async () => {
      cancelledAttempts += 1;
      throw new Error("voice_playback_superseded");
    },
  }));
  assert.equal(cancelledAttempts, 1, "navigation/global-stop cancellation never recreates a disposed player");
  assert.equal(signedUrlCalls, 1);

  let localSignedUrlCalls = 0;
  let localPlayCalls = 0;
  await assert.rejects(() => playback.playVoiceSourceWithOneRefresh({
    source: { kind: "local-draft", uri: "file:///private/preview.m4a" },
    requestSignedUrl: async () => {
      localSignedUrlCalls += 1;
      throw new Error("not expected");
    },
    playUri: async () => {
      localPlayCalls += 1;
      throw new Error("local playback failed");
    },
  }));
  assert.equal(localSignedUrlCalls, 0, "local draft preview never requests a remote URL");
  assert.equal(localPlayCalls, 1, "local draft preview does not use the persisted-source retry policy");

  const player = read("components", "VoiceMemoPlayer.tsx");
  const privateThread = read("components", "PrivateTeamMessageThread.tsx");
  const composer = read("components", "VoiceMemoComposer.tsx");
  const messageService = read("services", "teamPrivateMessageService.ts");
  const functionsSource = read("functions", "src", "index.ts");
  const translations = read("i18n", "index.ts");
  assert.match(player, /createAudioPlayer\(null/);
  assert.match(player, /addListener\("playbackStatusUpdate"/);
  assert.ok(
    player.indexOf('addListener("playbackStatusUpdate"') < player.indexOf("player.replace({ uri: playbackUri })"),
    "the status listener is attached before the remote source",
  );
  assert.ok(
    player.indexOf("await ready") < player.indexOf("player.play()"),
    "playback waits for expo-audio to report the source ready",
  );
  assert.match(player, /playVoiceSourceWithOneRefresh/);
  assert.match(player, /operationInFlightRef\.current/, "rapid Play taps have a synchronous duplicate-player guard");
  assert.match(player, /generationRef\.current/, "stale player listeners are generation-scoped");
  assert.match(player, /probeVoicePlaybackUrl\(playbackUri\)/);
  assert.match(player, /playbackUrlRequested: input\.playbackUrlRequested/);
  assert.match(player, /playCalled: input\.playCalled/);
  assert.match(player, /errorName: error instanceof Error \? error\.name : undefined/);
  assert.match(functionsSource, /teamVoicePlaybackGrants/);
  assert.match(functionsSource, /export const streamTeamVoiceMemo/);
  assert.doesNotMatch(functionsSource, /file\.getSignedUrl/);
  assert.match(functionsSource, /reason\.startsWith\('invalid_'\) \|\| validationReasons\.has\(reason\)/);
  assert.match(functionsSource, /: 'internal';/, "unexpected runtime failures are no longer mislabeled as bad client input");
  assert.match(player, /numberOfLines=\{1\} style=\{styles\.time\}/);
  assert.match(player, /container: \{[^}]*width: "100%"/);
  assert.doesNotMatch(player, /<View accessibilityLabel=\{t\("voiceMemo\.playerAccessibility"\)\}/);
  assert.match(privateThread, /message\.contentType === "voice" && !message\.isDeleted && styles\.voiceBubble/);
  assert.match(privateThread, /voiceBubble: \{ width: "92%" \}/);
  assert.match(privateThread, /<VoiceMemoUnavailable \/>/);
  assert.match(composer, /kind: "local-draft", uri: draft\.uri/);
  assert.doesNotMatch(composer, /storagePath:\s*draft\.uri/);
  assert.match(messageService, /blob\.size < 1 \|\| blob\.size !== draft\.sizeBytes/);
  assert.match(messageService, /snapshot\.metadata\.contentType !== draft\.mimeType/);
  assert.ok(
    messageService.indexOf("await (await fetch(draft.uri)).blob()") < messageService.indexOf("const task = uploadBytesResumable"),
    "the exact locally previewed URI is read before upload starts",
  );
  assert.match(functionsSource, /messageSnapshot\.data\(\)\?\.voiceMemo\?\.storagePath !== storagePath/);
  assert.match(functionsSource, /announcement\?\.voiceMemo\?\.storagePath !== storagePath/);
  for (const localizedValue of [
    "loading: 'Loading voice message\\u2026'",
    "playbackUnavailable: 'This voice message couldn\\u2019t be played.'",
    "tryAgain: 'Try again'",
    "loading: 'Cargando mensaje de voz\\u2026'",
    "playbackUnavailable: 'No se pudo reproducir este mensaje de voz.'",
    "tryAgain: 'Intentar de nuevo'",
  ]) assert.equal(translations.includes(localizedValue), true, `${localizedValue} is present`);

  console.log("Persisted voice normalization, signed-URL caching/refresh, explicit source separation, player readiness, layout, and localization tests passed.");
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
