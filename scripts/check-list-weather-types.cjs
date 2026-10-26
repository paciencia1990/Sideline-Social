'use strict';
const path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const files = [
  'utils/virtualizedRows.ts', 'components/VirtualizedRows.tsx', 'hooks/useSquadWeather.ts', 'components/SquadWeatherProvider.tsx',
  'app/(tabs)/friends.tsx', 'app/(social)/chat/index.tsx', 'app/teams/[teamId]/index.tsx',
  'app/(social)/squad-detail.tsx', 'app/teams/[teamId]/announcements/[announcementId].tsx',
];
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram([...files.map(file => path.join(root, file)), ...parsed.fileNames.filter(file => file.endsWith('.d.ts'))], { ...parsed.options, noEmit: true, incremental: false });
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  process.exitCode = 1;
} else console.log('PASS no-emit typecheck: 9 changed runtime entries and their dependencies');
