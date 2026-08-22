const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const babel = require("@babel/core");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const projectRoot = path.resolve(__dirname, "..");
const firebaseSourcePath = path.join(projectRoot, "config", "firebase.ts");
const firebaseEnvironmentPath = path.join(projectRoot, "config", "firebaseEnvironment.ts");
const featureFlagsPath = path.join(projectRoot, "config", "featureFlags.ts");
const appConfigPath = path.join(projectRoot, "app.config.js");
const nativeConfigPath = path.join(projectRoot, "config", "firebaseNativeConfig.js");
const expectedStagingProjectId = "sideline-social-staging-2026";
const requiredFirebaseVariables = [
  "EXPO_PUBLIC_FIREBASE_ENVIRONMENT",
  "EXPO_PUBLIC_FIREBASE_API_KEY",
  "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "EXPO_PUBLIC_FIREBASE_DATABASE_URL",
  "EXPO_PUBLIC_FIREBASE_APP_ID_IOS",
  "EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID",
];
const betaVariables = [
  "EXPO_PUBLIC_AI_COACH_TESTING_ENABLED",
  "EXPO_PUBLIC_AI_COACH_BETA_BUILD",
];
const usesEasPreview = process.env.COACH_AI_REQUIRE_EAS_PREVIEW === "true";
const syntheticEnvironment = {
  EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "staging",
  EXPO_PUBLIC_FIREBASE_API_KEY: `AIza${"a".repeat(30)}`,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: `${expectedStagingProjectId}.firebaseapp.com`,
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: expectedStagingProjectId,
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: `${expectedStagingProjectId}.firebasestorage.app`,
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "123456789012",
  EXPO_PUBLIC_FIREBASE_DATABASE_URL: `https://${expectedStagingProjectId}-default-rtdb.firebaseio.com`,
  EXPO_PUBLIC_FIREBASE_APP_ID_IOS: "1:123456789012:ios:abcdef123456",
  EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID: "1:123456789012:android:abcdef123456",
  EXPO_PUBLIC_AI_COACH_TESTING_ENABLED: "true",
  EXPO_PUBLIC_AI_COACH_BETA_BUILD: "true",
};

const selectedEnvironment = usesEasPreview
  ? readRequiredPreviewEnvironment()
  : syntheticEnvironment;
const previousEnvironment = new Map(
  [...requiredFirebaseVariables, ...betaVariables].map((name) => [name, process.env[name]]),
);
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "coach-ai-compiled-environment-"));

try {
  for (const [name, value] of Object.entries(selectedEnvironment)) {
    process.env[name] = value;
  }

  verifyStaticApplicationReferences();
  const compiledFirebase = transformApplicationFile(firebaseSourcePath);
  const compiledFeatureFlags = transformApplicationFile(featureFlagsPath);
  verifyCompiledBehavior(compiledFirebase, compiledFeatureFlags);
  verifyNativeWorkerValidationRemainsEnabled();
  runAndInspectExpoExport();
} finally {
  for (const [name, value] of previousEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  const resolvedTemporaryDirectory = path.resolve(temporaryDirectory);
  const resolvedSystemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolvedTemporaryDirectory.startsWith(resolvedSystemTemp)) {
    throw new Error("Refusing to clean a compiled-environment path outside the system temp directory.");
  }
  fs.rmSync(resolvedTemporaryDirectory, { recursive: true, force: true });
}

console.log(
  `Coach AI compiled Firebase isolation and Expo export tests passed (${usesEasPreview ? "EAS Preview" : "synthetic staging"}).`,
);

function readRequiredPreviewEnvironment() {
  const environment = {};
  for (const name of [...requiredFirebaseVariables, ...betaVariables]) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required for the EAS Preview compiled-environment test.`);
    environment[name] = value;
  }
  if (environment.EXPO_PUBLIC_FIREBASE_PROJECT_ID !== expectedStagingProjectId) {
    throw new Error("The EAS Preview Firebase project does not match the controlled Coach AI staging project.");
  }
  if (
    environment.EXPO_PUBLIC_FIREBASE_ENVIRONMENT !== "staging"
    || environment.EXPO_PUBLIC_AI_COACH_TESTING_ENABLED !== "true"
    || environment.EXPO_PUBLIC_AI_COACH_BETA_BUILD !== "true"
  ) {
    throw new Error("The EAS Preview Coach AI beta gates are not configured exactly.");
  }
  return environment;
}

function verifyStaticApplicationReferences() {
  const source = fs.readFileSync(firebaseSourcePath, "utf8");
  const ast = parse(source);
  const directReferences = new Set();
  let passesWholeEnvironment = false;
  let usesComputedEnvironmentAccess = false;
  let destructuresEnvironment = false;
  let spreadsEnvironment = false;

  traverse(ast, {
    MemberExpression(memberPath) {
      const node = memberPath.node;
      if (isProcessEnv(node)) {
        if (node.computed) usesComputedEnvironmentAccess = true;
        else if (node.property.type === "Identifier") directReferences.add(node.property.name);
      }
    },
    VariableDeclarator(variablePath) {
      if (
        variablePath.node.id.type === "ObjectPattern"
        && isProcessEnvObject(variablePath.node.init)
      ) {
        destructuresEnvironment = true;
      }
    },
    SpreadElement(spreadPath) {
      if (isProcessEnvObject(spreadPath.node.argument)) spreadsEnvironment = true;
    },
    CallExpression(callPath) {
      if (
        callPath.node.callee.type === "Identifier"
        && callPath.node.callee.name === "resolveFirebaseClientConfig"
        && isProcessEnvObject(callPath.node.arguments[0])
      ) {
        passesWholeEnvironment = true;
      }
    },
  });

  for (const name of [...requiredFirebaseVariables, "EXPO_PUBLIC_AI_COACH_BETA_BUILD"]) {
    assert.equal(directReferences.has(name), true, `${name} must use direct process.env dot notation in config/firebase.ts.`);
  }
  assert.equal(passesWholeEnvironment, false, "config/firebase.ts must not pass the complete process.env object.");
  assert.equal(usesComputedEnvironmentAccess, false, "config/firebase.ts must not use computed process.env access.");
  assert.equal(destructuresEnvironment, false, "config/firebase.ts must not destructure process.env.");
  assert.equal(spreadsEnvironment, false, "config/firebase.ts must not spread process.env.");
}

function verifyCompiledBehavior(compiledFirebase, compiledFeatureFlags) {
  const firebaseAst = parse(compiledFirebase);
  const featureFlagsAst = parse(compiledFeatureFlags);
  const compiledEnvironment = readObjectBinding(firebaseAst, "firebaseClientEnvironment");
  const compiledBetaBuildValue = readBinding(firebaseAst, "coachAiBetaBuildValue");
  const compiledFeatureFlagInput = readCallObject(featureFlagsAst, "resolveFeatureFlags");

  assert.equal(compiledEnvironment.EXPO_PUBLIC_FIREBASE_ENVIRONMENT, "staging");
  assert.equal(compiledEnvironment.EXPO_PUBLIC_FIREBASE_PROJECT_ID, expectedStagingProjectId);
  assert.equal(compiledBetaBuildValue, "true");
  assert.equal(compiledFeatureFlagInput.coachAiTestingValue, "true");
  assert.equal(compiledFeatureFlagInput.coachAiBetaBuildValue, "true");
  assert.deepEqual(
    collectRelevantProcessEnvReferences(firebaseAst),
    [],
    "The compiled Firebase bootstrap must not retain Expo public environment lookups.",
  );
  assert.deepEqual(
    collectRelevantProcessEnvReferences(featureFlagsAst),
    [],
    "The compiled feature flags must not retain Coach AI public environment lookups.",
  );

  const compiledResolver = loadCompiledResolver();
  const resolved = compiledResolver.resolveFirebaseClientConfig(
    compiledEnvironment,
    "android",
    compiledBetaBuildValue,
  );
  assert.equal(resolved.environment, "staging");
  assert.equal(resolved.options.projectId, expectedStagingProjectId);
  assert.throws(
    () => compiledResolver.resolveFirebaseClientConfig({}, "android", "true"),
    /Coach AI beta Firebase configuration must resolve to staging project/,
  );
  assert.equal(
    compiledResolver.resolveFirebaseClientConfig({}, "ios").options.projectId,
    "sideline-squad",
  );
}

function verifyNativeWorkerValidationRemainsEnabled() {
  const appConfig = fs.readFileSync(appConfigPath, "utf8");
  const nativeConfig = fs.readFileSync(nativeConfigPath, "utf8");
  assert.match(appConfig, /isEasBuild:\s*process\.env\.EAS_BUILD === "true"/u);
  assert.match(appConfig, /IS_STAGING_FIREBASE && !DEFER_STAGING_NATIVE_FIREBASE_VALIDATION/u);
  assert.match(nativeConfig, /requested &&[\s\S]*!isEasBuild &&[\s\S]*coachAiBetaBuild/u);
  assert.match(nativeConfig, /assertStagingNativeFirebaseConfig/u);
}

function runAndInspectExpoExport() {
  const outputDirectory = path.join(temporaryDirectory, "dist");
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const exportEnvironment = {
    ...process.env,
    APP_VARIANT: "production",
    REQUIRE_PRODUCTION_LEGAL_CONFIG: "true",
    EAS_DEFER_STAGING_NATIVE_FIREBASE_VALIDATION: "true",
    EXPO_NO_DOTENV: "1",
    EXPO_PUBLIC_PRIVACY_POLICY_URL: "https://www.joinsidelinesocial.com/privacy",
    EXPO_PUBLIC_TERMS_OF_USE_URL: "https://www.joinsidelinesocial.com/terms",
    EXPO_PUBLIC_SUPPORT_URL: "https://www.joinsidelinesocial.com/support",
  };
  const result = childProcess.spawnSync(
    executable,
    ["expo", "export", "--platform", "android", "--output-dir", outputDirectory],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: exportEnvironment,
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    const diagnostic = redactEnvironmentValues(
      `${result.error?.message || ""}\n${result.stdout || ""}\n${result.stderr || ""}`,
    )
      .split(/\r?\n/u)
      .filter(Boolean)
      .slice(-30)
      .join("\n");
    throw new Error(`The build-equivalent Expo export failed. Redacted diagnostic:\n${diagnostic}`);
  }

  const bundleFiles = listFiles(outputDirectory)
    .filter((file) => /\.(?:hbc|js)$/u.test(file));
  assert.equal(bundleFiles.length > 0, true, "Expo export did not produce an Android JavaScript bundle.");
  const bundleBuffers = bundleFiles.map((file) => fs.readFileSync(file));
  assert.equal(
    bundleBuffers.some((buffer) => buffer.includes(Buffer.from(expectedStagingProjectId))),
    true,
    "The compiled Android bundle must contain the controlled staging Firebase project ID.",
  );
  for (const prohibitedIdentifier of ["ANTHROPIC_API_KEY", "GOOGLE_CLOUD_API_KEY"]) {
    assert.equal(
      bundleBuffers.some((buffer) => buffer.includes(Buffer.from(prohibitedIdentifier))),
      false,
      `The compiled mobile bundle must not contain ${prohibitedIdentifier}.`,
    );
  }
}

function redactEnvironmentValues(output) {
  let redacted = output;
  const values = Object.values(selectedEnvironment)
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const value of values) redacted = redacted.split(value).join("[redacted]");
  return redacted.replace(/AIza[\w-]{20,}/gu, "[redacted Firebase API key]");
}

function transformApplicationFile(filename) {
  return babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [[require.resolve("babel-preset-expo"), {}]],
    caller: metroCaller(true),
    filename,
  }).code;
}

function loadCompiledResolver() {
  const code = babel.transformFileSync(firebaseEnvironmentPath, {
    babelrc: false,
    configFile: false,
    presets: [[require.resolve("babel-preset-expo"), {}]],
    plugins: [require.resolve("@babel/plugin-transform-modules-commonjs")],
    caller: metroCaller(false),
    filename: firebaseEnvironmentPath,
  }).code;
  const compiledModule = new Module(firebaseEnvironmentPath, module);
  compiledModule.filename = firebaseEnvironmentPath;
  compiledModule.paths = Module._nodeModulePaths(projectRoot);
  compiledModule._compile(code, firebaseEnvironmentPath);
  return compiledModule.exports;
}

function metroCaller(supportsStaticESM) {
  return {
    name: "metro",
    platform: "android",
    isDev: false,
    isServer: false,
    isReactServer: false,
    supportsStaticESM,
    supportsDynamicImport: true,
    engine: "hermes",
  };
}

function parse(source) {
  return parser.parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
}

function isProcessEnvObject(node) {
  return Boolean(
    node
    && node.type === "MemberExpression"
    && node.computed === false
    && node.object.type === "Identifier"
    && node.object.name === "process"
    && node.property.type === "Identifier"
    && node.property.name === "env"
  );
}

function isProcessEnv(node) {
  return node.object?.type === "MemberExpression" && isProcessEnvObject(node.object);
}

function collectRelevantProcessEnvReferences(ast) {
  const references = [];
  traverse(ast, {
    MemberExpression(memberPath) {
      const node = memberPath.node;
      if (
        isProcessEnv(node)
        && node.property.type === "Identifier"
        && (
          node.property.name.startsWith("EXPO_PUBLIC_FIREBASE_")
          || node.property.name.startsWith("EXPO_PUBLIC_AI_COACH_")
        )
      ) {
        references.push(node.property.name);
      }
    },
  });
  return references;
}

function readObjectBinding(ast, bindingName) {
  let result;
  traverse(ast, {
    VariableDeclarator(variablePath) {
      if (
        variablePath.node.id.type === "Identifier"
        && variablePath.node.id.name === bindingName
        && variablePath.node.init?.type === "ObjectExpression"
      ) {
        result = readObjectExpression(variablePath.node.init);
      }
    },
  });
  if (!result) throw new Error(`Compiled binding ${bindingName} was not found.`);
  return result;
}

function readBinding(ast, bindingName) {
  let result;
  traverse(ast, {
    VariableDeclarator(variablePath) {
      if (
        variablePath.node.id.type === "Identifier"
        && variablePath.node.id.name === bindingName
      ) {
        result = readLiteral(variablePath.node.init);
      }
    },
  });
  if (result === undefined) throw new Error(`Compiled binding ${bindingName} was not found.`);
  return result;
}

function readCallObject(ast, functionName) {
  let result;
  traverse(ast, {
    CallExpression(callPath) {
      if (
        callPath.node.callee.type === "Identifier"
        && callPath.node.callee.name === functionName
        && callPath.node.arguments[0]?.type === "ObjectExpression"
      ) {
        result = readObjectExpression(callPath.node.arguments[0]);
      }
    },
  });
  if (!result) throw new Error(`Compiled call to ${functionName} was not found.`);
  return result;
}

function readObjectExpression(node) {
  return Object.fromEntries(node.properties.map((property) => {
    if (
      property.type !== "ObjectProperty"
      || property.computed
      || !["Identifier", "StringLiteral"].includes(property.key.type)
    ) {
      throw new Error("Compiled environment object contains an unsupported property.");
    }
    const key = property.key.type === "Identifier" ? property.key.name : property.key.value;
    return [key, readLiteral(property.value)];
  }));
}

function readLiteral(node) {
  if (node?.type === "StringLiteral") return node.value;
  if (node?.type === "BooleanLiteral") return node.value;
  if (node?.type === "Identifier" && node.name === "undefined") return undefined;
  throw new Error("Compiled environment value was not inlined as a literal.");
}

function listFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else files.push(entryPath);
    }
  }
  return files;
}
