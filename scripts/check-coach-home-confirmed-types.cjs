'use strict';
// Scoped no-output check. Does not invoke Expo, native tools or a backend build.
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'docs/coach-home-confirmed-loading-local-20261023');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'types-attempt.json'), JSON.stringify({ at: new Date().toISOString(), noEmit: true, retries: 0 }), { flag: 'wx' });
const files = ['services/teamService.ts', 'app/coach/index.tsx', 'i18n/index.ts'];
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(files.map(f => path.join(root, f)), { ...parsed.options, noEmit: true, incremental: false });
const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
const result = { status: diagnostics.length ? 'STOPPED_NO_RETRY' : 'SCOPED_NO_EMIT_TYPES_PASSED', roots: files, diagnostics: diagnostics.map(d => ({
  code: d.code, file: d.file ? path.relative(root, d.file.fileName).replaceAll('\\', '/') : null,
  line: d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : null,
  message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
})), noEmit: true, builds: 0, retries: 0 };
fs.writeFileSync(path.join(out, 'types-result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
if (diagnostics.length) process.exitCode = 1;
