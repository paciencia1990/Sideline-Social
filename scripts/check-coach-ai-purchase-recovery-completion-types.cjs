'use strict';
// New screen scope and one explicitly approved correction of the stopped
// server scope. Reuses the completed client type result; emits no app output.
const fs = require('node:fs'), path = require('node:path');
if (process.env.SIDELINE_COACH_AI_RECOVERY_COMPLETION_APPROVED_ONCE !== 'once') throw Error('explicit_completion_approval_required');
const root = path.resolve(__dirname, '..'), group = process.argv[2];
if (!['screen', 'server-completion'].includes(group)) throw Error('completion_type_group_required');
const server = group === 'server-completion';
const ts = require(require.resolve('typescript', { paths: [server ? path.join(root, 'functions') : root] }));
const out = path.join(root, 'docs/coach-ai-consolidated-purchase-recovery-local-20261023');
fs.writeFileSync(path.join(out, group + '-types-attempt.json'), JSON.stringify({ at: new Date().toISOString(), noEmit: true, agentRetries: 0 }), { flag: 'wx' });
const files = server ? ['functions/src/coachAiPurchaseRecoveryCore.ts', 'functions/src/coachAiPurchaseRecovery.ts']
  : ['app/coach/resources/subscription.tsx', 'content/coachAiBillingTranslations.ts'];
const configPath = path.join(root, server ? 'functions/tsconfig.json' : 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
const options = { ...parsed.options, noEmit: true, incremental: false,
  ...(Number(ts.versionMajorMinor.split('.')[0]) >= 6 ? { ignoreDeprecations: '6.0' } : {}) };
const program = ts.createProgram(files.map(file => path.join(root, file)), options);
const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
const result = { status: diagnostics.length ? 'STOPPED_NO_RETRY' : 'SCOPED_NO_EMIT_TYPES_PASSED', group, roots: files,
  noEmit: true, builds: 0, networkRequests: 0, agentRetries: 0,
  diagnostics: diagnostics.map(d => ({ code: d.code, file: d.file ? path.relative(root, d.file.fileName).replaceAll('\\', '/') : null,
    line: d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : null,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n') })) };
fs.writeFileSync(path.join(out, group + '-types-result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result)); if (diagnostics.length) process.exitCode = 1;
