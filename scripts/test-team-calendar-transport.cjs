const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const ts = require("typescript");

function load(file, overrides = {}) {
  const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(overrides, request) ? overrides[request] : require(request);
  new Function("require", "module", "exports", output)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

const core = load("functions/src/teamCalendarCore.ts");
const fetcher = load("functions/src/teamCalendarFetch.ts", { "./teamCalendarCore": core });

function lookupResult(lookup, options) {
  return new Promise((resolve, reject) => {
    lookup("calendar.fixture.test", options, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
}

async function listen(address) {
  const server = net.createServer((socket) => {
    socket.on("error", () => undefined);
    socket.end("calendar fixture");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, address, resolve);
  });
  return server;
}

async function connect(server, lookup, autoSelectFamily) {
  const port = server.address().port;
  await new Promise((resolve, reject) => {
    const socket = net.connect({
      autoSelectFamily,
      host: "calendar.fixture.test",
      lookup,
      port,
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", reject);
  });
}

async function run() {
  const ipv4Lookup = fetcher.createPinnedLookup("127.0.0.1", 4);
  assert.deepEqual(await lookupResult(ipv4Lookup, { all: false }), { address: "127.0.0.1", family: 4 });
  assert.deepEqual(await lookupResult(ipv4Lookup, { all: true }), {
    address: [{ address: "127.0.0.1", family: 4 }],
    family: undefined,
  });

  const ipv6Lookup = fetcher.createPinnedLookup("::1", 6);
  assert.deepEqual(await lookupResult(ipv6Lookup, { all: false }), { address: "::1", family: 6 });
  assert.deepEqual(await lookupResult(ipv6Lookup, { all: true }), {
    address: [{ address: "::1", family: 6 }],
    family: undefined,
  });

  const ipv4Server = await listen("127.0.0.1");
  try {
    await assert.rejects(
      () => connect(ipv4Server, (_hostname, _options, callback) => callback(null, "127.0.0.1", 4), true),
      (error) => error?.code === "ERR_INVALID_IP_ADDRESS",
      "the historical scalar callback must reproduce Node 22's all-address failure",
    );
    await connect(ipv4Server, ipv4Lookup, false);
    await connect(ipv4Server, ipv4Lookup, true);
  } finally {
    await new Promise((resolve) => ipv4Server.close(resolve));
  }

  const ipv6Server = await listen("::1");
  try {
    await connect(ipv6Server, ipv6Lookup, false);
    await connect(ipv6Server, ipv6Lookup, true);
  } finally {
    await new Promise((resolve) => ipv6Server.close(resolve));
  }

  assert.equal(fetcher.classifyCalendarTransportError(Object.assign(new Error("private details"), { code: "ERR_INVALID_IP_ADDRESS" })), "feed_transport_configuration");
  assert.equal(fetcher.classifyCalendarTransportError(Object.assign(new Error("private details"), { code: "ETIMEDOUT" })), "feed_timeout");
  assert.equal(fetcher.classifyCalendarTransportError(Object.assign(new Error("private details"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" })), "feed_tls_invalid");

  console.log("Node 22 pinned calendar lookup transport tests passed for scalar/all and IPv4/IPv6 modes.");
}

run().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : "Calendar transport test failed.");
  process.exitCode = 1;
});
