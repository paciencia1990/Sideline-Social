const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(require, loaded, loaded.exports);
  return loaded.exports;
}

async function run() {
  const manifest = read("android", "app", "src", "main", "AndroidManifest.xml");
  const recordPermission = '<uses-permission android:name="android.permission.RECORD_AUDIO"/>';
  assert.equal((manifest.match(/android\.permission\.RECORD_AUDIO/g) ?? []).length, 1, "RECORD_AUDIO must exist exactly once");
  assert.ok(manifest.indexOf(recordPermission) > manifest.indexOf("<manifest"));
  assert.ok(manifest.indexOf(recordPermission) < manifest.indexOf("<application"));

  const appConfig = read("app.config.js");
  assert.match(appConfig, /permissions:\s*\["android\.permission\.RECORD_AUDIO"\]/);
  assert.match(appConfig, /googleMaps/);
  assert.match(appConfig, /adaptiveIcon/);

  const { ensureVoiceRecordingPermission } = loadTypeScript("services/voiceMemoPermissionService.ts");
  let requests = 0;
  assert.equal(await ensureVoiceRecordingPermission({
    getPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
    requestPermissionsAsync: async () => { requests += 1; return { granted: false, canAskAgain: true }; },
  }), "granted");
  assert.equal(requests, 0, "already-granted permission must not prompt");

  assert.equal(await ensureVoiceRecordingPermission({
    getPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
    requestPermissionsAsync: async () => { requests += 1; return { granted: true, canAskAgain: true }; },
  }), "granted");
  assert.equal(requests, 1, "requestable permission must prompt exactly once");

  assert.equal(await ensureVoiceRecordingPermission({
    getPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
    requestPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
  }), "denied");
  assert.equal(await ensureVoiceRecordingPermission({
    getPermissionsAsync: async () => ({ granted: false, canAskAgain: false }),
    requestPermissionsAsync: async () => { throw new Error("must not prompt"); },
  }), "settings");
  assert.equal(await ensureVoiceRecordingPermission({
    getPermissionsAsync: async () => { throw new Error("native permission failure"); },
    requestPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
  }), "error");

  const composer = read("components", "VoiceMemoComposer.tsx");
  const capability = read("services", "teamVoiceAudioCapability.ts");
  const coachComposer = read("app", "coach", "messages.tsx");
  const privateThread = read("components", "PrivateTeamMessageThread.tsx");
  assert.equal(composer.includes("Audio.requestPermissionsAsync()"), false, "permission logic must check before requesting");
  assert.ok(composer.indexOf("ensureVoiceRecordingPermission(Audio)") > composer.indexOf("const startRecording"));
  assert.match(composer, /permissionRequestInFlight/);
  assert.match(composer, /permission === "settings"/);
  assert.match(composer, /Linking\.openSettings\(\)/);
  assert.match(composer, /voiceMemo\.permissionRequiredTitle/);
  assert.match(composer, /voiceMemo\.permissionRequiredBody/);
  assert.equal(composer.includes("setError(getErrorCode(nextError))"), false, "raw native errors must not be displayed");
  assert.match(capability, /requireOptionalNativeModule\("ExponentAV"\)/);
  assert.match(composer, /require\("expo-av"\)/);
  assert.equal(composer.includes('from "expo-av"'), false, "older clients must retain deferred audio loading");
  assert.match(coachComposer, /VoiceMemoComposer/);
  assert.match(privateThread, /VoiceMemoComposer/);
  assert.match(coachComposer, /useState<"text" \| "voice">\("text"\)/, "text messaging must remain the default");

  const translations = read("i18n", "index.ts");
  for (const expected of [
    "Microphone Permission Required",
    "Allow microphone access in your phone settings to record voice messages.",
    "Open Settings",
    "Se requiere permiso para usar el micrófono",
    "Permite el acceso al micrófono en la configuración de tu teléfono para grabar mensajes de voz.",
    "Abrir configuración",
  ]) assert.equal(translations.includes(expected), true, expected);

  console.log("Android RECORD_AUDIO manifest/config and shared voice runtime permission flow tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

