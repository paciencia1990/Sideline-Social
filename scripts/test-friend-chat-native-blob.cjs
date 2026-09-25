"use strict";

// No device, credentials, network, or dependency edits. Exercise the installed
// RN Blob implementation and Firebase request builders, not a permissive web Blob.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const babel = require("@babel/core");
const ts = require("typescript");
const rnDirectory = path.join(path.dirname(require.resolve("react-native/package.json")), "Libraries/Blob");
const modules = new Map();
const nativeBuffers = new Map();
const refs = new Map();
function bytesOf(data) {
  return nativeBuffers.get(data.blobId).subarray(data.offset, data.offset + data.size);
}
const nativeModule = {
  createFromParts(parts, id) {
    nativeBuffers.set(id, Buffer.concat(parts.map(part => part.type === "blob" ? bytesOf(part.data) : Buffer.from(part.data))));
  },
  release(id) { nativeBuffers.delete(id); },
};
const registry = {
  register(id) { refs.set(id, (refs.get(id) || 0) + 1); },
  unregister(id) { refs.set(id, (refs.get(id) || 0) - 1); },
  has(id) { return refs.get(id) > 0; },
};
function loadRN(name) {
  if (modules.has(name)) return modules.get(name).exports;
  const filename = path.join(rnDirectory, `${name}.js`);
  const module = { exports: {} };
  modules.set(name, module);
  const { code } = babel.transformSync(fs.readFileSync(filename, "utf8"), {
    filename, configFile: false, babelrc: false,
    plugins: [require.resolve("@babel/plugin-transform-flow-strip-types"), require.resolve("@babel/plugin-transform-modules-commonjs")],
  });
  const localRequire = specifier => {
    if (specifier === "./NativeBlobModule") return nativeModule;
    if (specifier === "./BlobRegistry") return registry;
    if (specifier === "./Blob" || specifier === "./BlobManager") return loadRN(specifier.slice(2));
    return require(specifier);
  };
  new Function("module", "exports", "require", code)(module, module.exports, localRequire);
  return module.exports;
}
const tsModules = new Map();
function loadTS(filename) {
  filename = path.resolve(filename);
  if (tsModules.has(filename)) return tsModules.get(filename).exports;
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } });
  const module = { exports: {} };
  tsModules.set(filename, module);
  const localRequire = specifier => specifier.startsWith(".")
    ? loadTS(path.resolve(path.dirname(filename), `${specifier}.ts`))
    : require(specifier);
  new Function("module", "exports", "require", outputText)(module, module.exports, localRequire);
  return module.exports;
}

(async () => {
  const originalBlob = global.Blob;
  try {
    global.Blob = loadRN("Blob").default;
    const manager = loadRN("BlobManager").default;
    const firebaseFile = require.resolve("@firebase/storage");
    const firebase = { exports: {} };
    // Expose only request constructors within an isolated evaluation of the
    // installed SDK; never modify its files or dispatch its request descriptors.
    const firebaseSource = fs.readFileSync(firebaseFile, "utf8") +
      "\nmodule.exports.testInternals = { FbsBlob, Location, getMappings, multipartUpload, continueResumableUpload };";
    new Function("module", "exports", "require", firebaseSource)(firebase, firebase.exports, createRequire(firebaseFile));
    const sdk = firebase.exports.testInternals;
    const service = { host: "storage.invalid", _protocol: "https", maxUploadRetryTime: 1000 };
    const location = new sdk.Location("demo-photo-test", "synthetic/image.jpg");
    const mappings = sdk.getMappings();
    const metadata = { contentType: "image/jpeg" };
    const oldBytes = Uint8Array.from([255, 216, 0, 255, 217]);
    assert.throws(() => sdk.multipartUpload(service, location, mappings, new sdk.FbsBlob(oldBytes), metadata), /Creating blobs from 'ArrayBuffer'/u);

    const transfer = loadTS("utils/friendChatPhotoUploadTransfer.ts");
    for (const [name, size] of [["thumbnail", 5], ["main", 600_000]]) {
      const input = Buffer.alloc(size, 91);
      input[0] = 255; input[1] = 216; input[size - 1] = 217;
      nativeBuffers.set(name, input);
      const blob = manager.createFromOptions({ blobId: name, offset: 0, size, type: "image/jpeg" });
      const read = await transfer.readFriendChatPhotoUploadBlob(`file:///synthetic/${name}.jpg`, size, () => ({
        status: 200, response: blob,
        open(method) { assert.equal(method, "GET"); },
        send() { assert.equal(this.responseType, "blob"); this.onload(); },
      }));
      assert.equal(read, blob);
      const firebaseBlob = new sdk.FbsBlob(read);
      const multipart = sdk.multipartUpload(service, location, mappings, firebaseBlob, metadata);
      assert.ok(multipart.body instanceof global.Blob);
      const body = bytesOf(multipart.body.data);
      assert.ok(body.includes(input), "Multipart body must preserve exact binary bytes");
      assert.ok(body.includes(Buffer.from('"contentType":"image/jpeg"')));
      assert.equal(multipart.headers["X-Goog-Upload-Protocol"], "multipart");
      multipart.body.close();
      const chunks = [];
      for (let offset = 0; offset < size; offset += 256 * 1024) {
        const request = sdk.continueResumableUpload(location, service, "https://storage.invalid/synthetic", firebaseBlob, 256 * 1024, mappings, { current: offset, total: size });
        assert.ok(request.body instanceof global.Blob);
        chunks.push(Buffer.from(bytesOf(request.body.data)));
        assert.equal(request.headers["X-Goog-Upload-Offset"], String(offset));
        request.body.close();
      }
      assert.deepEqual(Buffer.concat(chunks), input, "Resumable slicing must preserve every byte");
      transfer.closeFriendChatPhotoUploadBlob(blob);
      assert.equal(nativeBuffers.has(name), false, "Native file must be released after transfer");
    }
    const nativeTransfer = loadTS("utils/nativeUploadBlob.ts");
    const voiceBytes = Buffer.alloc(32_000, 37);
    nativeBuffers.set("voice", voiceBytes);
    const voiceBlob = manager.createFromOptions({ blobId: "voice", offset: 0, size: voiceBytes.length, type: "audio/mp4" });
    const readVoice = await nativeTransfer.readNativeUploadBlob("file:///synthetic/voice.m4a", voiceBytes.length, {
      canceledCode: "voice_upload_canceled",
      invalidUriCode: "invalid_local_voice_uri",
      localReadCode: "voice_local_read_failed",
      localReadTimeoutCode: "voice_local_read_timeout",
      sizeMismatchCode: "voice_upload_size_mismatch",
    }, () => ({
      status: 200, response: voiceBlob,
      open(method) { assert.equal(method, "GET"); },
      send() { assert.equal(this.responseType, "blob"); this.onload(); },
    }));
    const voiceRequest = sdk.multipartUpload(service, new sdk.Location("demo-voice-test", "synthetic/voice.m4a"), mappings, new sdk.FbsBlob(readVoice), { contentType: "audio/mp4" });
    assert.ok(bytesOf(voiceRequest.body.data).includes(voiceBytes));
    voiceRequest.body.close();
    nativeTransfer.closeNativeUploadBlob(voiceBlob);
    assert.equal(nativeBuffers.has("voice"), false);
    console.log("PASS: installed RN reproduces the byte/Blob error; installed Firebase accepts native photo and voice Blobs with exact bytes and MIME. Zero requests dispatched.");
  } finally {
    global.Blob = originalBlob;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
