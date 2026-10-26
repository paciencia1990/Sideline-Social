'use strict';
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const files = [
  'context/AuthContext.tsx', 'app/(tabs)/profile.tsx', 'app/coach/index.tsx',
  'app/(tabs)/index.tsx', 'services/parentTeamService.ts', 'services/friendsService.ts',
  'app/(tabs)/friends.tsx', 'app/(social)/chat/new.tsx', 'app/(social)/chat/manage.tsx',
  'utils/modeSwitch.ts', 'i18n/index.ts',
];
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const options = { ...parsed.options, noEmit: true, incremental: false };
const program = ts.createProgram([...files.map(file => path.join(root, file)), ...parsed.fileNames.filter(file => file.endsWith('.d.ts'))], options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  process.exitCode = 1;
} else console.log(`PASS no-emit typecheck: ${files.length} changed entry files and their dependencies`);
