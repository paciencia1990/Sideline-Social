"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");
const decode = require("../config/safeUriDecoder.cjs");

for (const value of ["", "SC5Y9R", "hello world", "a+b/c?d=e", "Español", "日本語", "🏆", "100% ready"]) {
  assert.equal(decode(encodeURIComponent(value)), value);
}
for (const value of ["%", "%ZZ", "%E0%A4%A", "%A".repeat(64)]) assert.equal(decode(value), value);
assert.throws(() => decode(null), TypeError);

// Exercise query-string's actual CommonJS consumer with the bundled decoder.
const queryFile = require.resolve("query-string");
const consumer = new Module(queryFile);
consumer.filename = queryFile;
consumer.paths = Module._nodeModulePaths(path.dirname(queryFile));
const originalRequire = consumer.require.bind(consumer);
consumer.require = name => name === "decode-uri-component" ? decode : originalRequire(name);
consumer._compile(fs.readFileSync(queryFile, "utf8"), queryFile);
const query = consumer.exports;
const callback = query.parse("code=valid%2Bcode%2F123&state=SC5Y9R&name=Espa%C3%B1ol");
assert.equal(callback.code, "valid+code/123");
assert.equal(callback.state, "SC5Y9R");
assert.equal(callback.name, "Español");
assert.equal(query.parse("code=%A%A%A%A").code, "%A%A%A%A");

const config = require("../metro.config.js");
const fallback = { type: "sourceFile", filePath: "fallback.js" };
const context = { resolveRequest: () => fallback };
for (const platform of ["android", "ios", "web"]) {
  const resolved = config.resolver.resolveRequest(context, "decode-uri-component", platform);
  assert.equal(resolved.filePath, path.resolve(__dirname, "../config/safeUriDecoder.cjs"));
}
assert.equal(config.resolver.resolveRequest(context, "unrelated-module", "ios"), fallback);
assert.equal(config.resolver.unstable_enablePackageExports, false);

// The former adversarial input must finish in a bounded subprocess.
const probe = spawnSync(process.execPath, ["-e", "const d=require('./config/safeUriDecoder.cjs');if(d('%A'.repeat(100000)).length!==200000)process.exit(1)"], {
  cwd: path.resolve(__dirname, ".."), timeout: 1500, windowsHide: true,
});
assert.equal(probe.status, 0, "Malformed URI input must not stall the app");
console.log("Safe URI decoding preserves valid links, OAuth query values and Metro resolution; malformed input completes without recursive recovery.");
