'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/dead-code-cleanup-20261022/manifest.json'), 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const removed of manifest.removedFiles) {
  assert.equal(path.isAbsolute(removed), false);
  assert.equal(removed.split('/').includes('..'), false);
  assert.equal(fs.existsSync(path.join(root, removed)), false, removed + ' must be removed');
}
for (const entry of manifest.retainedFiles) {
  const absolute = path.join(root, entry.path);
  assert.ok(fs.existsSync(absolute), entry.path + ' must remain');
  const expected = manifest.allowedEdits[entry.path] ?? entry.sha256;
  assert.equal(hash(absolute), expected, entry.path + ' changed outside the cleanup scope');
  if (!/\.(?:[cm]?js|tsx?)$/.test(entry.path)) continue;
  const source = ts.createSourceFile(entry.path, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
  const imports = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteral(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) imports.push(node.arguments[0].text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) imports.push(node.argument.literal.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const specifier of imports) {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
    const target = specifier.startsWith('@/') ? path.resolve(root, specifier.slice(2)) : path.resolve(path.dirname(absolute), specifier);
    const relative = path.relative(root, target).replaceAll('\\', '/');
    assert.equal(manifest.removedFiles.some(file => file === relative || file.startsWith(relative + '/') || file.startsWith(relative + '.')), false, entry.path + ' still imports removed code: ' + specifier);
  }
}
for (const route of manifest.compatibilityFiles) assert.equal(hash(path.join(root, route.path)), route.sha256, 'Compatibility route changed: ' + route.path);
const teamService = fs.readFileSync(path.join(root, 'services/parentTeamService.ts'), 'utf8');
assert.doesNotMatch(teamService, /export async function isParentHomeTeamAvailable/);
assert.match(teamService, /export async function getParentTeamSummary/);
JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'));
console.log('Removed ' + manifest.removedFiles.length + ' unused files; preserved ' + manifest.compatibilityFiles.length + ' compatibility files and retained runtime hashes/import boundaries.');
