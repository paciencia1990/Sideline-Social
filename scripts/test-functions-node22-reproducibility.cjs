"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const sourceDirectory = path.join(root, "functions");
const expectedNodeVersion = fs.readFileSync(path.join(sourceDirectory, ".nvmrc"), "utf8").trim();
const currentNodeVersion = process.versions.node;

assert.equal(
  currentNodeVersion.split(".")[0],
  "22",
  `Run this Functions reproducibility gate with Node.js ${expectedNodeVersion}; received ${currentNodeVersion}.`,
);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sideline-functions-node22-"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  for (const fileName of ["package.json", "package-lock.json", "tsconfig.json"]) {
    fs.copyFileSync(
      path.join(sourceDirectory, fileName),
      path.join(temporaryDirectory, fileName),
    );
  }
  fs.cpSync(
    path.join(sourceDirectory, "src"),
    path.join(temporaryDirectory, "src"),
    { recursive: true },
  );

  runNpm(["ci", "--no-audit", "--no-fund"]);
  runNpm(["run", "build"]);

  assert.equal(
    fs.existsSync(path.join(temporaryDirectory, "lib", "index.js")),
    true,
    "A clean Node.js 22 install must compile the Functions entry point.",
  );
  assert.equal(
    fs.existsSync(path.join(temporaryDirectory, "node_modules", "sideline-squad")),
    false,
    "A clean Functions install must not recreate a dependency on the root application package.",
  );

  const installedModulesPath = fs.realpathSync(path.join(temporaryDirectory, "node_modules"));
  assert.equal(
    installedModulesPath.startsWith(fs.realpathSync(temporaryDirectory)),
    true,
    "The clean install must remain inside its isolated temporary Functions directory.",
  );

  console.log(
    `Cloud Functions clean npm ci and TypeScript build passed under Node.js ${currentNodeVersion}.`,
  );
} finally {
  fs.rmSync(temporaryDirectory, { force: true, maxRetries: 3, recursive: true });
}

function runNpm(arguments_) {
  const result = spawnSync(npmCommand, arguments_, {
    cwd: temporaryDirectory,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    assert.fail(
      `npm ${arguments_.join(" ")} failed in the isolated Functions copy.` +
        (output ? `\n${output}` : ""),
    );
  }
}
