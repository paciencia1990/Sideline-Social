'use strict';
// Type-check only this changed backend entry and its imports. Never emits an artifact.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),out=process.argv[2];
if(!out)throw Error('result_directory_required');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'types-attempt.json'),JSON.stringify({startedAt:new Date().toISOString(),noEmit:true}),{flag:'wx'});
const configPath=path.join(root,'functions/tsconfig.json');
const raw=ts.readConfigFile(configPath,ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(raw.config,ts.sys,path.dirname(configPath));
const options={...parsed.options,noEmit:true,incremental:false,types:['node']};
if(Number(ts.versionMajorMinor.split('.')[0])>=6)options.ignoreDeprecations='6.0';
const entry=path.join(root,'functions/src/coachAiCleanupInterface.ts');
const program=ts.createProgram([entry],options);
const diagnostics=[...(raw.error?[raw.error]:[]),...parsed.errors,...ts.getPreEmitDiagnostics(program)];
const result={passed:diagnostics.length===0,noEmit:true,entry:'functions/src/coachAiCleanupInterface.ts',typescript:ts.version,
 diagnostics:diagnostics.map(d=>({code:d.code,file:d.file?path.relative(root,d.file.fileName):null,
  line:d.file&&d.start!==undefined?d.file.getLineAndCharacterOfPosition(d.start).line+1:null,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')}))};
fs.writeFileSync(path.join(out,'types-result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
