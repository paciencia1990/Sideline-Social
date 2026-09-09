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
const expectedProductionProjectId = "sideline-squad";
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
  "EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD",
];
const managedVariables = [...requiredFirebaseVariables, ...betaVariables];
const syntheticStagingEnvironment = {
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
const syntheticProfiles = {
  staging: {
    label: "synthetic staging beta",
    firebaseEnvironment: "staging",
    expectedProjectId: expectedStagingProjectId,
    coachAiEnabled: true,
    environment: syntheticStagingEnvironment,
  },
  "production-beta": {
    label: "synthetic production-connected beta",
    firebaseEnvironment: "production",
    expectedProjectId: expectedProductionProjectId,
    coachAiEnabled: true,
    environment: {
      EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production",
      EXPO_PUBLIC_AI_COACH_TESTING_ENABLED: "true",
      EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD: "true",
    },
  },
  production: {
    label: "synthetic normal production",
    firebaseEnvironment: "production",
    expectedProjectId: expectedProductionProjectId,
    coachAiEnabled: false,
    environment: {
      EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production",
    },
  },
};

const usesEasPreview = process.env.COACH_AI_REQUIRE_EAS_PREVIEW === "true";
const usesEasProduction = process.env.COACH_AI_REQUIRE_EAS_PRODUCTION === "true";
if (usesEasPreview && usesEasProduction) {
  throw new Error("Only one EAS environment may be verified per compiled-environment invocation.");
}

const requestedProfile = process.env.COACH_AI_COMPILED_PROFILE;
const profiles = selectProfiles();
const previousEnvironment = new Map(managedVariables.map((name) => [name, process.env[name]]));
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "coach-ai-compiled-environment-"));

try {
  verifyStaticApplicationReferences();
  verifyNativeWorkerValidationRemainsEnabled();
  for (const profile of profiles) {
    applyEnvironment(profile.environment);
    const compiledFirebase = transformApplicationFile(firebaseSourcePath);
    const compiledFeatureFlags = transformApplicationFile(featureFlagsPath);
    verifyCompiledBehavior(compiledFirebase, compiledFeatureFlags, profile);
    runAndInspectExpoExport(profile);
  }
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

console.log(`Coach AI compiled Firebase isolation and Expo export tests passed (${profiles.map((profile) => profile.label).join(", ")}).`);

function selectProfiles() {
  if (usesEasPreview) {
    if (requestedProfile && requestedProfile !== "staging") {
      throw new Error("The EAS Preview check may only verify the staging profile.");
    }
    return [{
      ...syntheticProfiles.staging,
      label: "EAS Preview staging beta",
      environment: readRequiredPreviewEnvironment(),
    }];
  }
  if (usesEasProduction) {
    if (!requestedProfile || !["production-beta", "production"].includes(requestedProfile)) {
      throw new Error("The EAS Production check requires production-beta or production.");
    }
    return [{
      ...syntheticProfiles[requestedProfile],
      label: `EAS Production ${requestedProfile}`,
      environment: readProductionEnvironment(requestedProfile),
    }];
  }
  if (!requestedProfile || requestedProfile === "all") return Object.values(syntheticProfiles);
  const profile = syntheticProfiles[requestedProfile];
  if (!profile) throw new Error("COACH_AI_COMPILED_PROFILE must be all, staging, production-beta, or production.");
  return [profile];
}

function readRequiredPreviewEnvironment() {
  const environment = {};
  for (const name of [...requiredFirebaseVariables, ...betaVariables]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  for (const name of requiredFirebaseVariables) {
    if (!environment[name]) throw new Error(`${name} is required for the EAS Preview compiled-environment test.`);
  }
  if (environment.EXPO_PUBLIC_FIREBASE_PROJECT_ID !== expectedStagingProjectId) {
    throw new Error("The EAS Preview Firebase project does not match the controlled Coach AI staging project.");
  }
  if (
    environment.EXPO_PUBLIC_FIREBASE_ENVIRONMENT !== "staging"
    || environment.EXPO_PUBLIC_AI_COACH_TESTING_ENABLED !== "true"
    || environment.EXPO_PUBLIC_AI_COACH_BETA_BUILD !== "true"
    || environment.EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD
  ) {
    throw new Error("The EAS Preview Coach AI staging-beta gates are not configured exactly.");
  }
  return environment;
}

function readProductionEnvironment(profile) {
  const environment = {};
  for (const name of managedVariables) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  environment.EXPO_PUBLIC_FIREBASE_ENVIRONMENT = "production";
  const suppliedFirebaseVariables = requiredFirebaseVariables.slice(1).filter((name) => Boolean(environment[name]));
  if (suppliedFirebaseVariables.length > 0) {
    for (const name of requiredFirebaseVariables.slice(1)) {
      if (!environment[name]) throw new Error(`${name} is required when EAS Production supplies public Firebase overrides.`);
    }
    if (environment.EXPO_PUBLIC_FIREBASE_PROJECT_ID !== expectedProductionProjectId) {
      throw new Error("The EAS Production Firebase project must be sideline-squad.");
    }
  }
  if (profile === "production-beta") {
    if (
      environment.EXPO_PUBLIC_AI_COACH_TESTING_ENABLED !== "true"
      || environment.EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD !== "true"
      || environment.EXPO_PUBLIC_AI_COACH_BETA_BUILD
    ) {
      throw new Error("The production-connected beta gates are not configured exactly.");
    }
  } else if (
    environment.EXPO_PUBLIC_AI_COACH_TESTING_ENABLED
    || environment.EXPO_PUBLIC_AI_COACH_BETA_BUILD
    || environment.EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD
  ) {
    throw new Error("The normal EAS Production bundle must not contain Coach AI testing or beta flags.");
  }
  return environment;
}

function applyEnvironment(environment) {
  for (const name of managedVariables) delete process.env[name];
  for (const [name, value] of Object.entries(environment)) process.env[name] = value;
}

function verifyStaticApplicationReferences() {
  verifyStaticReferences(firebaseSourcePath, [
    ...requiredFirebaseVariables,
    "EXPO_PUBLIC_AI_COACH_BETA_BUILD",
    "EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD",
  ]);
  verifyStaticReferences(featureFlagsPath, betaVariables);
  verifyStaticReferences(appConfigPath, betaVariables);
}

function verifyStaticReferences(filename, expectedVariables) {
  const ast = parse(fs.readFileSync(filename, "utf8"));
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
      if (variablePath.node.id.type === "ObjectPattern" && isProcessEnvObject(variablePath.node.init)) {
        destructuresEnvironment = true;
      }
    },
    SpreadElement(spreadPath) {
      if (isProcessEnvObject(spreadPath.node.argument)) spreadsEnvironment = true;
    },
    CallExpression(callPath) {
      if (callPath.node.arguments.some((argument) => isProcessEnvObject(argument))) passesWholeEnvironment = true;
    },
  });

  for (const name of expectedVariables) {
    assert.equal(directReferences.has(name), true, `${name} must use direct process.env dot notation in ${path.relative(projectRoot, filename)}.`);
  }
  assert.equal(passesWholeEnvironment, false, `${path.relative(projectRoot, filename)} must not pass the complete process.env object.`);
  assert.equal(usesComputedEnvironmentAccess, false, `${path.relative(projectRoot, filename)} must not use computed process.env access.`);
  assert.equal(destructuresEnvironment, false, `${path.relative(projectRoot, filename)} must not destructure process.env.`);
  assert.equal(spreadsEnvironment, false, `${path.relative(projectRoot, filename)} must not spread process.env.`);
}

function verifyCompiledBehavior(compiledFirebase, compiledFeatureFlags, profile) {
  const firebaseAst = parse(compiledFirebase);
  const featureFlagsAst = parse(compiledFeatureFlags);
  const compiledEnvironment = readObjectBinding(firebaseAst, "firebaseClientEnvironment");
  const compiledStagingBetaBuildValue = readBinding(firebaseAst, "coachAiBetaBuildValue");
  const compiledProductionBetaBuildValue = readBinding(firebaseAst, "coachAiProductionBetaBuildValue");
  const compiledFeatureFlagInput = readCallObject(featureFlagsAst, "resolveFeatureFlags");

  assert.equal(compiledEnvironment.EXPO_PUBLIC_FIREBASE_ENVIRONMENT, profile.firebaseEnvironment);
  assert.equal(compiledStagingBetaBuildValue, profile.environment.EXPO_PUBLIC_AI_COACH_BETA_BUILD);
  assert.equal(compiledProductionBetaBuildValue, profile.environment.EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD);
  assert.equal(compiledFeatureFlagInput.coachAiTestingValue, profile.environment.EXPO_PUBLIC_AI_COACH_TESTING_ENABLED);
  assert.equal(compiledFeatureFlagInput.coachAiBetaBuildValue, profile.environment.EXPO_PUBLIC_AI_COACH_BETA_BUILD);
  assert.equal(compiledFeatureFlagInput.coachAiProductionBetaBuildValue, profile.environment.EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD);
  assert.deepEqual(collectRelevantProcessEnvReferences(firebaseAst), [], "The compiled Firebase bootstrap must not retain Expo public environment lookups.");
  assert.deepEqual(collectRelevantProcessEnvReferences(featureFlagsAst), [], "The compiled feature flags must not retain Coach AI public environment lookups.");

  const compiledResolver = loadCompiledModule(firebaseEnvironmentPath);
  const resolved = compiledResolver.resolveFirebaseClientConfig(
    compiledEnvironment,
    "android",
    compiledStagingBetaBuildValue,
    compiledProductionBetaBuildValue,
  );
  assert.equal(resolved.environment, profile.firebaseEnvironment);
  assert.equal(resolved.options.projectId, profile.expectedProjectId);

  const compiledFeatureResolver = loadCompiledModule(featureFlagsPath);
  const flags = compiledFeatureResolver.resolveFeatureFlags(compiledFeatureFlagInput);
  assert.equal(flags.coachAiEnabled, profile.coachAiEnabled);
  assert.throws(
    () => compiledResolver.resolveFirebaseClientConfig({}, "android", "true", "true"),
    /cannot both be enabled/,
  );
  assert.throws(
    () => compiledFeatureResolver.resolveFeatureFlags({
      isDevelopment: false,
      coachAiTestingValue: "true",
      coachAiBetaBuildValue: "true",
      coachAiProductionBetaBuildValue: "true",
    }),
    /cannot both be enabled/,
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

function runAndInspectExpoExport(profile) {
  const outputDirectory = path.join(temporaryDirectory, profile.label.replace(/[^a-z0-9]+/giu, "-"), "dist");
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
      profile.environment,
    ).split(/\r?\n/u).filter(Boolean).slice(-30).join("\n");
    throw new Error(`The ${profile.label} build-equivalent Expo export failed. Redacted diagnostic:\n${diagnostic}`);
  }

  const bundleFiles = listFiles(outputDirectory).filter((file) => /\.(?:hbc|js)$/u.test(file));
  assert.equal(bundleFiles.length > 0, true, `${profile.label} did not produce an Android JavaScript bundle.`);
  const bundleBuffers = bundleFiles.map((file) => fs.readFileSync(file));
  assert.equal(
    bundleBuffers.some((buffer) => buffer.includes(Buffer.from(profile.expectedProjectId))),
    true,
    `The ${profile.label} bundle must contain the expected Firebase project ID.`,
  );
  for (const prohibitedIdentifier of ["ANTHROPIC_API_KEY", "COACH_AI_API_KEY", "COACH_AI_ENDPOINT", "GOOGLE_CLOUD_API_KEY"]) {
    assert.equal(
      bundleBuffers.some((buffer) => buffer.includes(Buffer.from(prohibitedIdentifier))),
      false,
      `The ${profile.label} mobile bundle must not contain ${prohibitedIdentifier}.`,
    );
  }
}

function redactEnvironmentValues(output, environment) {
  let redacted = output;
  const values = Object.values(environment)
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

function loadCompiledModule(filename) {
  const code = babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [[require.resolve("babel-preset-expo"), {}]],
    plugins: [require.resolve("@babel/plugin-transform-modules-commonjs")],
    caller: metroCaller(false),
    filename,
  }).code;
  const compiledModule = new Module(filename, module);
  compiledModule.filename = filename;
  compiledModule.paths = Module._nodeModulePaths(projectRoot);
  compiledModule._compile(code, filename);
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
        && (node.property.name.startsWith("EXPO_PUBLIC_FIREBASE_") || node.property.name.startsWith("EXPO_PUBLIC_AI_COACH_"))
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
  let found = false;
  traverse(ast, {
    VariableDeclarator(variablePath) {
      if (variablePath.node.id.type === "Identifier" && variablePath.node.id.name === bindingName) {
        result = readLiteral(variablePath.node.init);
        found = true;
      }
    },
  });
  if (!found) throw new Error(`Compiled binding ${bindingName} was not found.`);
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
