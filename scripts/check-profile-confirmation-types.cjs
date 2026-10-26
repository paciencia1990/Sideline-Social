'use strict';
// No emit, network, native build or broad app test execution.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/profile-confirmation-local-20261026');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'types-attempt.json'),JSON.stringify({at:new Date().toISOString(),noEmit:true,retries:0})+'\n',{flag:'wx'});
const roots=['utils/confirmedProfileRead.ts','utils/modeSwitch.ts','services/teamService.ts','app/coach/index.tsx','app/(tabs)/profile.tsx'];
const config=ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
const program=ts.createProgram(roots.map(file=>path.join(root,file)),{...parsed.options,noEmit:true,incremental:false,ignoreDeprecations:'6.0'});
const diagnostics=[...(config.error?[config.error]:[]),...parsed.errors,...ts.getPreEmitDiagnostics(program)];
const result={status:diagnostics.length?'STOPPED_NO_RETRY':'PASS',roots,noEmit:true,networkRequests:0,deviceCommands:0,builds:0,deployments:0,retries:0,diagnostics:diagnostics.map(d=>({code:d.code,file:d.file?path.relative(root,d.file.fileName).replaceAll('\\','/'):null,line:d.file&&d.start!=null?d.file.getLineAndCharacterOfPosition(d.start).line+1:null,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')}))};
fs.writeFileSync(path.join(out,'types-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));if(diagnostics.length)process.exitCode=1;
