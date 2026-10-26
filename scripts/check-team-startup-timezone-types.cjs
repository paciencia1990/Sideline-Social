'use strict';
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/team-startup-device-timezone-local-20261026');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'types-attempt.json'), JSON.stringify({ noEmit: true, at: new Date().toISOString(), retries: 0 }), { flag: 'wx' });
const roots = ['utils/teamScheduleDisplay.ts', 'utils/teamScheduleCore.ts', 'hooks/useDeviceTimeZone.ts',
  'components/TeamScheduleEventCard.tsx', 'app/teams/[teamId]/schedule/index.tsx',
  'app/teams/[teamId]/schedule/[eventId].tsx', 'app/teams/[teamId]/schedule/connect.tsx',
  'app/teams/[teamId]/schedule/import-ics.tsx', 'services/teamReadReadiness.ts', 'services/teamService.ts',
  'services/parentTeamService.ts', 'services/childService.ts', 'app/coach/index.tsx', 'app/(tabs)/index.tsx', 'i18n/index.ts'];
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(roots.map(file => path.join(root, file)), {
  ...parsed.options, noEmit: true, incremental: false, ignoreDeprecations: '6.0',
});
const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
const result = { status: diagnostics.length ? 'STOPPED_NO_RETRY' : 'PASS', roots, noEmit: true,
  builds: 0, networkRequests: 0, retries: 0, diagnostics: diagnostics.map(d => ({ code: d.code,
    file: d.file ? path.relative(root, d.file.fileName).replaceAll('\\', '/') : null,
    line: d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : null,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  })) };
fs.writeFileSync(path.join(out, 'types-result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
if (diagnostics.length) process.exitCode = 1;
