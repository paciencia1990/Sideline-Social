'use strict';
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
// Compile source in memory only. No emitted bundle, native or Function build.
function createSourceLoader(overrides = {}) {
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) throw new Error('test_source_outside_workspace');
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const localRequire = Module.createRequire(filename);
    const resolve = (name) => {
      if (name in overrides) return overrides[name];
      if (name.startsWith('@/') && fs.existsSync(path.join(root, name.slice(2) + '.ts'))) return load(name.slice(2) + '.ts');
      if (name.startsWith('.') && fs.existsSync(path.resolve(path.dirname(filename), name + '.ts'))) return load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts')));
      return localRequire(name);
    };
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function('module', 'exports', 'require', '__filename', '__dirname', output)(module, module.exports, resolve, filename, path.dirname(filename));
    return module.exports;
  }
  return load;
}
module.exports = { createSourceLoader, root };
