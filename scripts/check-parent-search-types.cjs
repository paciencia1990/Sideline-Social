'use strict';
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'docs/parent-search-local-20261023');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'types-attempt.json'), JSON.stringify({ at: new Date().toISOString(), noEmit: true, retries: 0 }), { flag: 'wx' });
const files = ['utils/publicUserSearchRequests.ts', 'services/publicProfileService.ts', 'hooks/useParentSearch.ts', 'app/(tabs)/friends.tsx', 'i18n/index.ts'];
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(files.map(file => path.join(root, file)), { ...parsed.options, noEmit: true, incremental: false });
const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
const result = { state: diagnostics.length ? 'STOPPED_NO_RETRY' : 'SCOPED_NO_EMIT_TYPES_PASSED', roots: files, noEmit: true, builds: 0, retries: 0,
  diagnostics: diagnostics.map(d => ({ code: d.code, file: d.file ? path.relative(root, d.file.fileName).replaceAll('\\', '/') : null,
    line: d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : null,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n') })) };
fs.writeFileSync(path.join(out, 'types-result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result)); if (diagnostics.length) process.exitCode = 1;
