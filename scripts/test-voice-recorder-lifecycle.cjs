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
  const {
    VoiceRecorderLifecycleError,
    finalizeVoiceRecorder,
    prepareAndStartVoiceRecorder,
    sanitizeVoiceRecorderMessage,
  } = loadTypeScript("services/voiceMemoRecorderService.ts");

  const calls = [];
  let status = { canRecord: true, isRecording: false, durationMillis: 0 };
  const recorder = {
    currentTime: 0,
    getStatus: () => ({ ...status }),
    prepareToRecordAsync: async () => {
      calls.push("prepare");
      status = { canRecord: true, isRecording: false, durationMillis: 0 };
    },
    record: () => {
      calls.push("record");
      status = { canRecord: true, isRecording: true, durationMillis: 0 };
    },
    stop: async () => {
      calls.push("stop");
      status = { canRecord: false, isRecording: false, durationMillis: 0 };
    },
    uri: null,
  };
  await prepareAndStartVoiceRecorder({
    configureAudioMode: async () => calls.push("audio-mode"),
    recorder,
  });
  assert.deepEqual(calls, ["stop", "audio-mode", "prepare", "record"], "a stale prepared recorder is stopped before one new start");

  await assert.rejects(
    () => prepareAndStartVoiceRecorder({
      configureAudioMode: async () => { throw new Error("audio focus unavailable"); },
      recorder,
    }),
    (error) => error instanceof VoiceRecorderLifecycleError && error.stage === "configure-audio-mode",
  );

  const finalizedReads = [];
  let finalizedUri = null;
  const finalRecorder = {
    currentTime: 2.4,
    getStatus: () => ({ canRecord: true, isRecording: true, durationMillis: 2400 }),
    prepareToRecordAsync: async () => {},
    record: () => {},
    stop: async () => {
      finalizedReads.push("stop");
      finalizedUri = "file:///private/recording.m4a";
    },
    get uri() {
      finalizedReads.push("uri");
      return finalizedUri;
    },
  };
  const finalDraft = await finalizeVoiceRecorder(finalRecorder, 2350);
  assert.deepEqual(finalizedReads, ["stop", "uri"], "the URI is read only after native stop finalizes");
  assert.equal(finalDraft.durationMilliseconds, 2400, "duration is captured before Android stop resets native timing");

  await assert.rejects(
    () => finalizeVoiceRecorder({
      currentTime: 1,
      getStatus: () => ({ canRecord: true, isRecording: true, durationMillis: 1000 }),
      prepareToRecordAsync: async () => {},
      record: () => {},
      stop: async () => {},
      uri: null,
    }, 1000),
    (error) => error instanceof VoiceRecorderLifecycleError && error.stage === "obtain-uri",
  );

  assert.equal(
    sanitizeVoiceRecorderMessage("failed file:///private/recording.m4a token eyJsecret.value"),
    "failed [redacted-uri] token [redacted-token]",
  );

  const composer = read("components", "VoiceMemoComposer.tsx");
  assert.match(composer, /operationInFlightRef\.current/, "rapid taps have a synchronous start guard");
  assert.match(composer, /VoiceRecorderCreationBoundary/, "native recorder construction failures are contained");
  assert.match(composer, /failureStage: "create-recorder"/);
  assert.match(composer, /disabled=\{disabled \|\| !active \|\| starting\}/, "the Record button is disabled while starting");
  assert.match(composer, /AppState\.addEventListener\("change"/, "backgrounding cancels active recording state");
  assert.match(composer, /resetPreparedVoiceRecorder/, "failure and unmount release prepared recorder state");
  assert.match(composer, /restorePlaybackAudioMode/, "all lifecycle exits restore playback audio mode");
  assert.match(composer, /autoStartKey\?:/, "friend chat can opt into one-tap recording without changing coach/team composers");
  assert.match(composer, /lastAutoStartKeyRef/, "auto-start keys are consumed exactly once");
  assert.match(composer, /void startRecording\(\)/, "auto-start reuses the guarded manual recording path");
  assert.match(composer, /voiceMemo\.limitReached/, "auto-stopped recordings explain the max-duration limit");
  assert.match(composer, /voiceMemo\.saveRecordingError/);
  assert.match(composer, /voiceMemo\.startRecordingError/);

  console.log("Expo Audio recorder preparation, finalization ordering, duration capture, diagnostics, guards, and cleanup tests passed.");
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
