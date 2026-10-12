'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..');

function validateBinding(binding, project, readFile = (relative) => fs.readFileSync(path.join(repo, relative))) {
  assert.equal(project, 'sideline-social-staging-2026', 'Deployment must explicitly target the retained live project');
  assert.equal(binding?.project, project, 'Source binding targets another project');
  assert.ok(Array.isArray(binding?.targets) && binding.targets.length > 0, 'Reviewed target list is required');
  assert.ok(Array.isArray(binding?.files) && binding.files.length > 0, 'Source hashes are required');
  for (const row of binding.files) {
    assert.ok(typeof row.path === 'string' && !path.isAbsolute(row.path) && !row.path.split(/[\\/]/).includes('..'), 'Source path must stay inside the checkout');
    assert.ok(/^[a-f0-9]{64}$/.test(row.sha256), 'Source SHA-256 is missing');
    const actual = crypto.createHash('sha256').update(readFile(row.path)).digest('hex');
    assert.equal(actual, row.sha256, 'Source changed after deployment binding');
  }
  return true;
}

if (require.main === module) {
  try {
    const file = process.env.SIDELINE_BACKEND_DEPLOYMENT_BINDING;
    assert.ok(file, 'Set SIDELINE_BACKEND_DEPLOYMENT_BINDING to the scoped, current source manifest');
    const binding = JSON.parse(fs.readFileSync(file, 'utf8'));
    validateBinding(binding, process.env.GCLOUD_PROJECT);
    console.log('Retained live project and source binding verified. Use only the manifested deployment targets.');
  } catch (error) {
    console.error('Deployment stopped: ' + (error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'invalid source binding'));
    process.exitCode = 1;
  }
}
module.exports = { validateBinding };
