const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const functionsSource = path.join(root, "functions", "src");

const callableFiles = walk(functionsSource)
  .filter((file) => file.endsWith(".ts"))
  .filter((file) => fs.readFileSync(file, "utf8").includes(".https.onCall"));

for (const file of callableFiles) {
  if (file.endsWith(`${path.sep}permanentAuth.ts`)) continue;
  const source = fs.readFileSync(file, "utf8");
  assert.match(
    source,
    /permanentAccountFunctions/,
    `${path.relative(root, file)} must use the provider-aware callable boundary`,
  );
}

for (const directory of ["app", "components", "context", "hooks", "services", "src", "utils"]) {
  for (const file of walk(path.join(root, directory)).filter((candidate) => /\.(?:ts|tsx)$/.test(candidate))) {
    assert.equal(
      fs.readFileSync(file, "utf8").includes("signInAnonymously"),
      false,
      `${path.relative(root, file)} must not create anonymous Firebase users`,
    );
  }
}

for (const ruleFile of ["firestore.rules", "database.rules.json", "storage.rules"]) {
  assert.match(
    fs.readFileSync(path.join(root, ruleFile), "utf8"),
    /sign_in_provider/,
    `${ruleFile} must distinguish the anonymous provider`,
  );
}

console.log(
  `Permanent-account boundary guard passed for ${callableFiles.length} callable source modules.`,
);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(resolved) : [resolved];
  });
}
