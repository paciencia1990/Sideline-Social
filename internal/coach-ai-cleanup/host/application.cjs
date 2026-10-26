'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createCleanupHost}=require('./server.cjs'),{createCleanupRuntime}=require('./runtime.cjs');
// Returns a Node HTTP handler only; never listens, loads credentials or activates
// anything on import. Future packaging supplies the reviewed workflow factory.
function createCleanupApplication({origin,projectId,publicAuthConfig=null,operatorPins,verificationKey,Timestamp,createAdapter,createActionAdapter,readsEnabled=false,mutationsEnabled=false,loginEnabled=false,operatorActionsEnabled=false,requestImpl}){
 if(projectId!=='sideline-social-staging-2026'&&!/^demo-[a-z0-9-]+$/.test(projectId))throw Error('cleanup_project_mismatch');
 if(publicAuthConfig&&publicAuthConfig.projectId!==projectId)throw Error('cleanup_login_project_mismatch');
 const assetFiles=['index.html','style.css','staff-view.js','client.js','page.js','login.js','login-page.js','action.html','action-client.js','action-page.js'];
 const assets=Object.fromEntries(assetFiles.map(file=>['/'+file,fs.readFileSync(path.resolve(__dirname,'..',file),'utf8')]));
 // Private deployment can start with no pins/credentials while all data gates
 // remain off. Enabling reads requires a complete immutable runtime configuration.
 const factory=readsEnabled===true?createCleanupRuntime({projectId,origin,operatorPins,verificationKey,Timestamp,createAdapter,requestImpl}):()=>{throw Error('cleanup_disabled');};
 if(operatorActionsEnabled&&typeof createActionAdapter!=='function')throw Error('cleanup_packaged_dependencies');
 const actionFactory=operatorActionsEnabled===true?createCleanupRuntime({projectId,origin,operatorPins,verificationKey,Timestamp,createAdapter:createActionAdapter,requestImpl}):undefined;
 return createCleanupHost({origin,publicAuthConfig,assets,createAdapter:factory,createActionAdapter:actionFactory,readsEnabled,mutationsEnabled,loginEnabled,operatorActionsEnabled});
}
module.exports={createCleanupApplication};
