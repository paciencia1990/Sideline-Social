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
  assertPermanentBoundary(path.relative(functionsSource, file), source);
}

// Translation deliberately enforces App Check at the native builder and uses
// the same permanent-account/standing helpers explicitly. Keep this exception
// limited to its exact handler and authorization-before-content contract.
const translationSource = fs.readFileSync(path.join(functionsSource, "teamTranslation.ts"), "utf8");
for (const [before, after] of [
  ["requirePermanentUid(context)", "context.auth.uid"],
  ["enforceAppCheck: true", "enforceAppCheck: false"],
  ["await requireAccountCapability(uid, 'app')", "Promise.resolve()"],
  ["load: loadAuthorizedTranslationText", "load: unprotectedLoad"],
]) {
  assert.throws(() => assertPermanentBoundary("teamTranslation.ts", translationSource.replace(before, after)), /translation boundary/, "Removing an explicit translation protection must fail");
}
assert.throws(() => assertPermanentBoundary("other.ts", translationSource), /provider-aware callable boundary/, "The manual exception must not extend to other callables");

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

function assertPermanentBoundary(relativeFile, source) {
  if (relativeFile !== "teamTranslation.ts") {
    assert.match(source, /permanentAccountFunctions/, `${relativeFile} must use the provider-aware callable boundary`);
    return;
  }
  assert.equal((source.match(/\.https\.onCall/g) || []).length, 1, "translation boundary covers exactly one callable");
  assert.match(source, /enforceAppCheck:\s*true/, "translation boundary requires enforced App Check");
  assert.match(source, /\.https\.onCall\(async \(data, context\) => \{\s*const uid = requirePermanentUid\(context\);/, "translation boundary rejects temporary/anonymous accounts first");
  assert.match(source, /if \(!context\.app\) throw/, "translation boundary requires verified app context");
  assert.match(source, /load:\s*loadAuthorizedTranslationText/, "translation boundary must load authorized content");
  const start = source.indexOf("export async function loadAuthorizedTranslationText");
  const end = source.indexOf("export async function reserveTranslationCharacters", start);
  assert.ok(start >= 0 && end > start, "translation boundary loader must be identifiable");
  const loader = source.slice(start, end);
  const standing = loader.indexOf("await requireAccountCapability(uid, 'app')");
  assert.ok(standing >= 0 && standing < loader.indexOf("admin.firestore()"), "translation boundary checks standing before content access");
}
