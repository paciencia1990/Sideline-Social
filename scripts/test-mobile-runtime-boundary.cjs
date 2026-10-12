'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {resolve}=require('metro-resolver');
const config=require('../metro.config.js');
const root=path.resolve(__dirname,'..');
const readPackage=file=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
function packageFor(file){
 for(let dir=path.dirname(file);;dir=path.dirname(dir)){
  const packageJson=readPackage(path.join(dir,'package.json'));
  if(packageJson)return {rootPath:dir,packageJson,packageRelativePath:path.relative(dir,file)};
  if(dir===path.dirname(dir)||path.basename(dir)==='node_modules')return null;
 }
}
function lookup(file){try{const realPath=fs.realpathSync(file);return {exists:true,realPath,type:fs.statSync(realPath).isDirectory()?'d':'f'};}catch{return {exists:false};}}
const base={
 allowHaste:false,assetExts:new Set(config.resolver.assetExts),customResolverOptions:{},dev:false,
 disableHierarchicalLookup:false,doesFileExist:file=>lookup(file).type==='f',extraNodeModules:{},
 getPackage:readPackage,getPackageForModule:packageFor,fileSystemLookup:lookup,
 mainFields:config.resolver.resolverMainFields,nodeModulesPaths:[],preferNativePlatform:true,
 resolveAsset:()=>null,redirectModulePath:file=>file,resolveHasteModule:()=>null,resolveHastePackage:()=>null,
 sourceExts:config.resolver.sourceExts,unstable_conditionNames:config.resolver.unstable_conditionNames,
 unstable_conditionsByPlatform:config.resolver.unstable_conditionsByPlatform,
 unstable_enablePackageExports:config.resolver.unstable_enablePackageExports,
 unstable_incrementalResolution:false,unstable_logWarning:()=>{},resolveRequest:resolve,
};
for(const platform of ['android','ios']){
 const entry=resolve({...base,originModulePath:path.join(root,'index.js')},'firebase/firestore',platform);
 assert.equal(entry.type,'sourceFile');
 const sdk=resolve({...base,originModulePath:entry.filePath},'@firebase/firestore',platform);
 assert.equal(sdk.type,'sourceFile');
 assert.match(sdk.filePath.replaceAll('\\','/'),/\/dist\/index\.rn\.js$/);
 const source=fs.readFileSync(sdk.filePath,'utf8');
 assert.doesNotMatch(source,/['"]@grpc\//);
 const decoder=config.resolver.resolveRequest({...base,originModulePath:entry.filePath},'decode-uri-component',platform);
 assert.equal(decoder.filePath,path.join(root,'config/safeUriDecoder.cjs'));
}
console.log('Android/iOS Metro resolution selects the Firestore RN entry and bounded URI decoder. This checks entry selection, not an installed release artifact.');
