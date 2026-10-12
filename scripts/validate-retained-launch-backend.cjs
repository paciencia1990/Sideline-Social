'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const repo = path.resolve(__dirname, '..');
const project = 'sideline-social-staging-2026';
const aliases = JSON.parse(fs.readFileSync(path.join(repo, '.firebaserc'), 'utf8'));
const config = require(path.join(repo, 'eas.json'));
function mergedProfile(name, visited = new Set()) {
  assert.ok(!visited.has(name), 'Build profile inheritance contains a cycle');
  visited.add(name);
  const child = config.build[name];
  assert.ok(child, 'Build profile is missing');
  const parent = child.extends ? mergedProfile(child.extends, visited) : {};
  return { ...parent, ...child, env: { ...parent.env, ...child.env } };
}
const production = mergedProfile('production');
assert.equal(aliases.projects.default, project, 'Default Firebase project must be the retained live backend');
assert.equal(aliases.projects.live, project);
assert.equal(aliases.projects.legacy, 'sideline-squad');
assert.equal(production.environment, 'preview', 'Retained native configuration is protected in the existing preview environment');
assert.equal(production.env.EXPO_PUBLIC_FIREBASE_ENVIRONMENT, 'staging');
assert.equal(production.env.APP_VARIANT, 'production');
assert.equal(production.distribution, 'store');
assert.equal(production.developmentClient, false);
assert.equal(production.env.REQUIRE_PRODUCTION_LEGAL_CONFIG, 'true');
console.log('Production profile and Firebase aliases resolve to the retained live backend; no build was submitted.');
