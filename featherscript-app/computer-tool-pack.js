'use strict';
// Shared catalogue with computer_tools.py. These handlers run only after the
// existing ComputerAccess broker has checked pairing, approvals and real paths.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const os=require('node:os'),dns=require('node:dns'),net=require('node:net'),http=require('node:http'),https=require('node:https');
const catalog=require('./computer-tool-catalog.json');
const definitions=new Map(catalog.map(tool=>[tool.name,tool]));
const MAX_FILE=1048576,MAX_OUTPUT=524288;
const poison=new Set(['__proto__','prototype','constructor']);
function check(signal){if(signal?.aborted)throw Error('Computer request was cancelled.');}
function validateValue(value,schema,label,depth=0){
 if(depth>32)throw Error('Arguments exceed 32 nested levels.');
 const kinds=Array.isArray(schema.type)?schema.type:[schema.type];
 const kind=value===null?'null':Array.isArray(value)?'array':typeof value;
 const valid=kinds.includes(kind)||(kinds.includes('integer')&&Number.isInteger(value));
 if(!valid)throw Error(label+' has the wrong type.');
 if(typeof value==='number'&&(!Number.isFinite(value)||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))throw Error(label+' is outside its allowed range.');
 if(typeof value==='string'&&(value.length<(schema.minLength??0)||value.length>(schema.maxLength??1048576)||value.includes('\0')))throw Error(label+' has an invalid length or NUL.');
 if(schema.enum&&!schema.enum.includes(value))throw Error(label+' is not an allowed value.');
 if(Array.isArray(value)){
  if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??20000))throw Error(label+' has an invalid item count.');
  for(const item of value)validateValue(item,schema.items||{type:['object','array','string','number','boolean','null']},label+' item',depth+1);
 }else if(value&&typeof value==='object'){
  for(const key of Object.keys(value)){
   if(poison.has(key))throw Error('Prototype-related keys are not accepted.');
   validateValue(value[key],{type:['object','array','string','number','boolean','null']},label+'.'+key,depth+1);
  }
 }
}
function validate(tool,args){
 const definition=definitions.get(tool);if(!definition)throw Error('Unknown computer tool.');
 for(const key of Object.keys(args))if(!Object.hasOwn(definition.inputSchema.properties,key))throw Error('Unknown argument: '+key);
 for(const key of definition.inputSchema.required)if(!Object.hasOwn(args,key))throw Error('Missing argument: '+key);
 for(const [key,value] of Object.entries(args))validateValue(value,definition.inputSchema.properties[key],key);
 return definition;
}
async function resolvePaths(tool,args,canonical){
 const definition=validate(tool,args);
 return Promise.all(definition.paths.map(key=>canonical(args[key],definition.allowMissing===true)));
}
async function readBytes(target,max=MAX_FILE){
 const file=await fsp.open(target,'r');
 try{
  const info=await file.stat();if(!info.isFile())throw Error('Expected a regular file.');
  if(info.size>max)throw Error(`File exceeds the ${max}-byte limit.`);
  const data=Buffer.alloc(Math.min(info.size+1,max+1));let used=0;
  while(used<data.length){const {bytesRead}=await file.read(data,used,data.length-used,null);if(!bytesRead)break;used+=bytesRead;}
  if(used>max||used>info.size)throw Error('File changed while reading. Retry.');
  return data.subarray(0,used);
 }finally{await file.close();}
}
async function readText(target){
 const bytes=await readBytes(target);const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 return {text,bytes};
}
async function readJson(target){const record=await readText(target);return {...record,value:JSON.parse(record.text)};}
async function atomicWrite(target,text,original,signal){
 check(signal);
 if(Buffer.byteLength(text)>MAX_FILE)throw Error('Result exceeds the 1 MB write limit.');
 if(!Buffer.from(await readBytes(target)).equals(original))throw Error('File changed since reading; edit was not applied.');
 const info=await fsp.stat(target),temporary=path.join(path.dirname(target),'.fs-edit-'+crypto.randomBytes(12).toString('hex'));
 if(original.subarray(0,3).equals(Buffer.from([239,187,191]))&&!text.startsWith('\uFEFF'))text='\uFEFF'+text;
 try{
  await fsp.writeFile(temporary,text,{encoding:'utf8',flag:'wx',mode:info.mode&0o777});
  check(signal);await fsp.rename(temporary,target);
 }finally{await fsp.unlink(temporary).catch(()=>{});}
 return {path:target,written:true,bytes:Buffer.byteLength(text)};
}
async function hashFile(target,algorithm='sha256',signal){
 const file=await fsp.open(target,'r');
 try{
  const info=await file.stat();if(!info.isFile()||info.size>67108864)throw Error('Hash requires a regular file of at most 64 MB.');
  const hash=crypto.createHash(algorithm),buffer=Buffer.alloc(65536);let size=0;
  while(true){check(signal);const {bytesRead}=await file.read(buffer,0,buffer.length,null);if(!bytesRead)break;size+=bytesRead;if(size>67108864)throw Error('File grew beyond hash limit.');hash.update(buffer.subarray(0,bytesRead));}
  return {path:target,algorithm,hash:hash.digest('hex'),bytes:size};
 }finally{await file.close();}
}
async function walk(root,depth=4,signal){
 if(!(await fsp.stat(root)).isDirectory())throw Error('Expected a directory.');
 const queue=[{path:root,level:0}],entries=[];let truncated=false,unreadable=0;
 for(let index=0;index<queue.length;index++){
  check(signal);const current=queue[index];let children;
  try{children=await fsp.readdir(current.path,{withFileTypes:true});}catch{unreadable++;continue;}
  children.sort((a,b)=>a.name.localeCompare(b.name));
  for(const child of children){
   if(child.isSymbolicLink())continue;
   if(entries.length>=5000){truncated=true;break;}
   const target=path.join(current.path,child.name);let info;
   try{const linkInfo=await fsp.lstat(target);if(linkInfo.isSymbolicLink())continue;const real=await fsp.realpath(target);const relative=path.relative(root,real);if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))continue;info=await fsp.stat(real);}catch{unreadable++;continue;}
   const row={path:target,relative:path.relative(root,target),type:info.isDirectory()?'directory':'file',bytes:info.size,modifiedAt:info.mtimeMs};entries.push(row);
   if(info.isDirectory()&&current.level<depth)queue.push({path:target,level:current.level+1});
  }
  if(truncated)break;
 }
 return {entries,truncated,unreadable};
}
function pointerParts(pointer){
 if(pointer==='')return [];
 if(!pointer.startsWith('/')||/~(?:[^01]|$)/.test(pointer))throw Error('Use an RFC 6901 JSON Pointer.');
 const parts=pointer.slice(1).split('/').map(key=>key.replace(/~1/g,'/').replace(/~0/g,'~'));
 if(parts.some(key=>poison.has(key)))throw Error('Prototype-related pointer keys are not accepted.');
 return parts;
}
function child(node,key){
 if(!node||typeof node!=='object'||!Object.hasOwn(node,key))throw Error('JSON Pointer does not exist.');
 if(Array.isArray(node)&&!/^(0|[1-9][0-9]*)$/.test(key))throw Error('Use a valid array index.');
 return node[key];
}
function query(value,pointer){return pointerParts(pointer).reduce(child,value);}
function mutate(value,pointer,next,remove){
 const parts=pointerParts(pointer);
 if(!parts.length){if(remove)throw Error('Cannot delete the document root.');return next;}
 const key=parts.pop();let parent=value;for(const part of parts)parent=child(parent,part);
 if(!parent||typeof parent!=='object')throw Error('Pointer parent is not an object or array.');
 if(Array.isArray(parent)){
  if(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=parent.length)throw Error('Array index is outside the array.');
  if(remove)parent.splice(Number(key),1);else parent[Number(key)]=next;
 }else if(remove){if(!Object.hasOwn(parent,key))throw Error('Pointer does not exist.');delete parent[key];}else parent[key]=next;
 return value;
}
function merge(target,patch,depth=0){
 if(depth>32)throw Error('JSON merge exceeds 32 levels.');
 if(!target||Array.isArray(target)||typeof target!=='object'||!patch||Array.isArray(patch)||typeof patch!=='object')throw Error('Merge requires object documents.');
 for(const [key,value] of Object.entries(patch)){
  if(poison.has(key))throw Error('Prototype-related keys are not accepted.');
  if(value&&typeof value==='object'&&!Array.isArray(value)){
   const old=Object.hasOwn(target,key)?target[key]:null;
   target[key]=merge(old&&typeof old==='object'&&!Array.isArray(old)?old:{},value,depth+1);
  }else target[key]=value;
 }
 return target;
}
function jsonDiff(left,right){
 const changes=[];let truncated=false;
 function visit(a,b,pointer,depth){
  if(changes.length>=500){truncated=true;return;}if(depth>32)throw Error('JSON diff exceeds 32 levels.');
  if(a===b)return;
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
   for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
    const at=pointer+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1');
    if(!Object.hasOwn(a,key)||!Object.hasOwn(b,key))changes.push({pointer:at,kind:Object.hasOwn(a,key)?'removed':'added'});
    else visit(a[key],b[key],at,depth+1);
    if(changes.length>=500){truncated=true;break;}
   }
  }else changes.push({pointer,kind:'changed'});
 }
 visit(left,right,'',0);return {equal:!changes.length,changes,truncated};
}
function parseCsv(text){
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 const pushCell=()=>{if(row.length>=256)throw Error('CSV exceeds 256 columns.');row.push(cell);cell='';closed=false;};
 const pushRow=()=>{pushCell();rows.push(row);row=[];if(rows.length>20001)throw Error('CSV exceeds 20,000 data rows.');};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c===','){pushCell();continue;}
  if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;pushRow();continue;}
  if(c==='"'){if(cell||closed)throw Error('Unexpected CSV quote.');quoted=true;continue;}
  if(closed)throw Error('Characters follow a closed CSV quoted field.');cell+=c;
 }
 if(quoted)throw Error('Unterminated CSV quoted field.');
 if(cell||row.length||closed)pushRow();
 return rows;
}
function table(rows,unique=true){
 const headers=rows[0]||[],data=rows.slice(1);
 if(unique&&(new Set(headers).size!==headers.length||headers.some(key=>!key||poison.has(key))))throw Error('CSV requires nonempty unique safe headers.');
 return {headers,data};
}
function csvObjects(headers,rows){return rows.map(row=>Object.fromEntries(headers.map((key,index)=>[key,row[index]??''])));}
const csvCell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
function relativeFile(value){
 if(typeof value!=='string'||!value||value.includes(':')||path.isAbsolute(value)||value.startsWith('-')||value.split(/[\\/]/).includes('..'))throw Error('Use a repository-relative file path without traversal.');
 return value.replace(/\\/g,'/');
}
function revision(value='HEAD'){if(!/^[a-zA-Z0-9][a-zA-Z0-9._/~^\-]{0,99}$/.test(value))throw Error('Invalid Git revision.');return value;}
async function git(context,args,target,command,signal){
 check(signal);if(!(await fsp.stat(target)).isDirectory())throw Error('Git requires a repository directory.');
 return context.runProgram({program:'git',args:['--no-pager','--no-optional-locks',...(command[0]==='check-ignore'?[]:['--literal-pathspecs']),'-c','core.fsmonitor=false','-c','core.hooksPath=',...command],timeoutMs:15000},target,signal);
}
function intArg(value,fallback,minimum,maximum){
 if(value===undefined)return fallback;
 if(!Number.isInteger(value))throw Error('Expected an integer.');
 return Math.min(maximum,Math.max(minimum,value));
}
function textLines(text){return text.split(/\r\n|\r|\n/);}
function pattern(value,label='pattern'){
 if(typeof value!=='string'||!value||value.length>500||/[\0\r\n]/.test(value))throw Error(label+' must be 1-500 characters without newlines.');
 return value;
}
function regex(value,flags=''){
 const allowed=(flags||'').replace(/[^gimsuy]/g,'');
 const set=new Set(allowed.split(''));set.add('g');
 try{return new RegExp(pattern(value),[...set].join(''));}catch(error){throw Error('Invalid regular expression: '+error.message);}
}
function withTimeout(promise,ms,message){
 let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]).finally(()=>clearTimeout(timer));
}
function httpText(rawUrl,maxBytes,timeoutMs,redirects=3){
 return new Promise((resolve,reject)=>{
  let url;try{url=new URL(String(rawUrl||''));}catch{return reject(Error('Use a full http or https URL.'));}
  if(!['http:','https:'].includes(url.protocol))return reject(Error('Only http and https URLs can be fetched.'));
  const lib=url.protocol==='https:'?https:http;
  const request=lib.get(url,{timeout:timeoutMs,headers:{'user-agent':'FeatherScript/2.0','accept':'text/plain, text/html, application/json, */*'}},response=>{
   const status=response.statusCode||0;
   if([301,302,303,307,308].includes(status)&&response.headers.location&&redirects>0){
    response.resume();
    return resolve(httpText(new URL(response.headers.location,url).href,maxBytes,timeoutMs,redirects-1));
   }
   const chunks=[];let size=0,truncated=false,done=false;
   const finish=value=>{if(done)return;done=true;resolve({...value,status,url:url.href,contentType:String(response.headers['content-type']||''),bytes:size,truncated});};
   response.on('data',chunk=>{
    const room=maxBytes-size;
    if(room<=0){truncated=true;response.destroy();finish({text:Buffer.concat(chunks).toString('utf8')});return;}
    const kept=chunk.subarray(0,room);chunks.push(kept);size+=kept.length;
    if(chunk.length>room){truncated=true;response.destroy();finish({text:Buffer.concat(chunks).toString('utf8')});}
   });
   response.on('end',()=>finish({text:Buffer.concat(chunks).toString('utf8')}));
   response.on('close',()=>finish({text:Buffer.concat(chunks).toString('utf8')}));
   response.on('error',error=>{if(!done)reject(error);});
  });
  request.on('timeout',()=>request.destroy(Error('Request timed out.')));
  request.on('error',reject);
 });
}
function jsonNodes(value,pointer,depth,out,limit,leavesOnly){
 if(out.length>=limit||depth>32)return;
 if(value&&typeof value==='object'){
  if(!leavesOnly)out.push({pointer,type:Array.isArray(value)?'array':'object'});
  for(const key of Object.keys(value)){
   if(out.length>=limit)return;
   jsonNodes(value[key],pointer+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'),depth+1,out,limit,leavesOnly);
  }
 }else out.push({pointer,type:value===null?'null':typeof value});
}
function firstDifference(left,right,context,maxChanges){
 let start=0;
 while(start<left.length&&start<right.length&&left[start]===right[start])start++;
 let tail=0;
 while(tail<left.length-start&&tail<right.length-start&&left[left.length-1-tail]===right[right.length-1-tail])tail++;
 const from=Math.max(0,start-context);
 const removed=left.slice(start,left.length-tail).slice(0,Math.max(1,maxChanges));
 const added=right.slice(start,right.length-tail).slice(0,Math.max(1,maxChanges));
 return {equal:false,contextLines:context,removed:removed.map((text,index)=>({line:start+index+1,text})),added:added.map((text,index)=>({line:start+index+1,text})),truncated:left.length-tail>removed.length||right.length-tail>added.length,from};
}
async function writeBytesAtomic(target,buffer,signal){
 check(signal);
 const info=await fsp.stat(target),temporary=path.join(path.dirname(target),'.fs-edit-'+crypto.randomBytes(12).toString('hex'));
 try{
  await fsp.writeFile(temporary,buffer,{flag:'wx',mode:info.mode&0o777});
  check(signal);await fsp.rename(temporary,target);
 }finally{await fsp.unlink(temporary).catch(()=>{});}
 return {path:target,written:true,bytes:buffer.length};
}

const handlers={
 pc_file_hash:async(a,t,c,s)=>hashFile(t[0],a.algorithm||'sha256',s),
 pc_compare_files:async(a,t,c,s)=>{const [left,right]=await Promise.all(t.map(p=>hashFile(p,'sha256',s)));return {equal:left.bytes===right.bytes&&left.hash===right.hash,left,right};},
 pc_file_head:async(a,t)=>{const {text}=await readText(t[0]);return {text:text.split(/\r?\n/).slice(0,a.lines??40).join('\n')};},
 pc_file_tail:async(a,t)=>{const {text}=await readText(t[0]);return {text:text.split(/\r?\n/).slice(-(a.lines??40)).join('\n')};},
 pc_find_text:async(a,t)=>{const {text}=await readText(t[0]);const needle=a.caseSensitive?a.text:a.text.toLowerCase(),matches=[];let total=0;
 text.split(/\r?\n/).forEach((line,index)=>{if((a.caseSensitive?line:line.toLowerCase()).includes(needle)){total++;if(matches.length<(a.limit??100))matches.push({line:index+1,text:line.slice(0,2000)});}});return {matches,total,truncated:total>matches.length};},
 pc_replace_text:async(a,t,c,s)=>{const {text,bytes}=await readText(t[0]);const parts=text.split(a.oldText);if(parts.length-1!==a.expectedOccurrences)throw Error(`Expected ${a.expectedOccurrences} occurrences; found ${parts.length-1}. Nothing changed.`);return atomicWrite(t[0],parts.join(a.newText),bytes,s);},
 pc_insert_lines:async(a,t,c,s)=>{const {text,bytes}=await readText(t[0]),lines=text.split(/\r?\n/),newline=text.includes('\r\n')?'\r\n':'\n';if(a.line>lines.length+1)throw Error('Insertion line is outside the file.');lines.splice(a.line-1,0,...a.text.split(/\r?\n/));return atomicWrite(t[0],lines.join(newline),bytes,s);},
 pc_delete_lines:async(a,t,c,s)=>{const {text,bytes}=await readText(t[0]),lines=text.split(/\r?\n/);if(a.endLine<a.startLine||a.endLine>lines.length)throw Error('Invalid line range.');lines.splice(a.startLine-1,a.endLine-a.startLine+1);return atomicWrite(t[0],lines.join(text.includes('\r\n')?'\r\n':'\n'),bytes,s);},
 pc_detect_encoding:async(a,t)=>{const b=await readBytes(t[0]);let encoding='unknown/binary';if(b[0]===255&&b[1]===254)encoding='UTF-16LE BOM';else if(b[0]===254&&b[1]===255)encoding='UTF-16BE BOM';else{try{new TextDecoder('utf-8',{fatal:true}).decode(b);encoding=b.subarray(0,3).equals(Buffer.from([239,187,191]))?'UTF-8 BOM':b.includes(0)?'unknown/binary':'UTF-8';}catch{}}return {encoding,bytes:b.length};},
 pc_directory_summary:async(a,t,c,s)=>{const result=await walk(t[0],a.depth??4,s),extensions={};let bytes=0,files=0,directories=0;for(const e of result.entries){if(e.type==='directory')directories++;else{files++;bytes+=e.bytes;const key=path.extname(e.path).toLowerCase()||'(none)';extensions[key]=(extensions[key]||0)+1;}}return {files,directories,bytes,extensions,truncated:result.truncated,unreadable:result.unreadable};},
 pc_directory_tree:async(a,t,c,s)=>{const r=await walk(t[0],a.depth??4,s);return {entries:r.entries.slice(0,a.limit??500),truncated:r.truncated||r.entries.length>(a.limit??500),unreadable:r.unreadable};},
 pc_directory_recent_files:async(a,t,c,s)=>{const r=await walk(t[0],a.depth??4,s),files=r.entries.filter(e=>e.type==='file').sort((x,y)=>y.modifiedAt-x.modifiedAt);return {files:files.slice(0,a.limit??100),truncated:r.truncated||files.length>(a.limit??100),unreadable:r.unreadable};},
 pc_find_duplicates:async(a,t,c,s)=>{const r=await walk(t[0],a.depth??4,s),sizes=new Map(),hashes=new Map();let budget=134217728,skipped=0;
 for(const e of r.entries.filter(e=>e.type==='file')){const group=sizes.get(e.bytes)||[];group.push(e);sizes.set(e.bytes,group);}
 for(const group of sizes.values()){if(group.length<2)continue;for(const e of group){if(e.bytes>67108864||e.bytes>budget){skipped++;continue;}budget-=e.bytes;const hash=await hashFile(e.path,'sha256',s),matches=hashes.get(hash.hash)||[];matches.push(e.path);hashes.set(hash.hash,matches);}}
 const duplicates=[...hashes].filter(([,v])=>v.length>1).map(([hash,paths])=>({hash,paths}));return {groups:duplicates.slice(0,a.limit??50),skipped,truncated:r.truncated||skipped>0||duplicates.length>(a.limit??50),unreadable:r.unreadable};},
 pc_json_read:async(a,t)=>({value:(await readJson(t[0])).value}),
 pc_json_format:async(a,t)=>({text:JSON.stringify((await readJson(t[0])).value,null,a.indent??2)+'\n'}),
 pc_json_validate:async(a,t)=>{const {text}=await readText(t[0]);try{JSON.parse(text);return {valid:true};}catch(e){return {valid:false,error:e.message};}},
 pc_json_query:async(a,t)=>({value:query((await readJson(t[0])).value,a.pointer)}),
 pc_json_set:async(a,t,c,s)=>{const r=await readJson(t[0]);return atomicWrite(t[0],JSON.stringify(mutate(r.value,a.pointer,a.value,false),null,2)+'\n',r.bytes,s);},
 pc_json_delete:async(a,t,c,s)=>{const r=await readJson(t[0]);return atomicWrite(t[0],JSON.stringify(mutate(r.value,a.pointer,null,true),null,2)+'\n',r.bytes,s);},
 pc_json_merge:async(a,t,c,s)=>{const r=await readJson(t[0]);return atomicWrite(t[0],JSON.stringify(merge(r.value,a.value),null,2)+'\n',r.bytes,s);},
 pc_json_diff:async(a,t)=>{const [x,y]=await Promise.all(t.map(readJson));return jsonDiff(x.value,y.value);},
 pc_csv_preview:async(a,t)=>{const {headers,data}=table(parseCsv((await readText(t[0])).text),false);return {headers,rows:data.slice(0,a.limit??20),totalRows:data.length,truncated:data.length>(a.limit??20)};},
 pc_csv_info:async(a,t)=>{const {headers,data}=table(parseCsv((await readText(t[0])).text),false);return {headers,rows:data.length,columns:headers.length,raggedRows:data.filter(r=>r.length!==headers.length).length};},
 pc_csv_filter:async(a,t)=>{const {headers,data}=table(parseCsv((await readText(t[0])).text)),index=headers.indexOf(a.column);if(index<0)throw Error('CSV column does not exist.');const op=a.operator||'equals';const matches=data.filter(row=>{const v=row[index]??'';if(op==='equals')return v===a.value;if(op==='contains')return v.includes(a.value);if(op==='startsWith')return v.startsWith(a.value);if(op==='endsWith')return v.endsWith(a.value);const x=Number(v),y=Number(a.value);return v.trim()!==''&&a.value.trim()!==''&&Number.isFinite(x)&&Number.isFinite(y)&&(op==='gt'?x>y:x<y);});return {rows:csvObjects(headers,matches.slice(0,a.limit??100)),matched:matches.length,truncated:matches.length>(a.limit??100)};},
 pc_csv_sort:async(a,t)=>{const {headers,data}=table(parseCsv((await readText(t[0])).text)),index=headers.indexOf(a.column);if(index<0)throw Error('CSV column does not exist.');if(a.numeric&&data.some(r=>!(r[index]??'').trim()||!Number.isFinite(Number(r[index]))))throw Error('Numeric sorting requires finite values in every row.');data.sort((x,y)=>(a.numeric?Number(x[index])-Number(y[index]):String(x[index]??'').localeCompare(String(y[index]??'')))*(a.descending?-1:1));return {rows:csvObjects(headers,data.slice(0,a.limit??100)),truncated:data.length>(a.limit??100)};},
 pc_csv_select_columns:async(a,t)=>{const {headers,data}=table(parseCsv((await readText(t[0])).text));for(const column of a.columns)if(!headers.includes(column))throw Error('CSV column does not exist: '+column);const indices=a.columns.map(k=>headers.indexOf(k));return {headers:a.columns,rows:data.slice(0,a.limit??100).map(row=>indices.map(i=>row[i]??'')),truncated:data.length>(a.limit??100)};},
 pc_csv_to_json:async(a,t)=>{const {headers,data}=table(parseCsv((await readText(t[0])).text));return {rows:csvObjects(headers,data.slice(0,a.limit??100)),truncated:data.length>(a.limit??100)};},
 pc_json_to_csv:async(a,t)=>{const value=(await readJson(t[0])).value;if(!Array.isArray(value)||value.length>20000||value.some(r=>!r||Array.isArray(r)||typeof r!=='object'))throw Error('Expected up to 20,000 flat row objects.');const columns=a.columns||[...new Set(value.flatMap(Object.keys))];if(columns.length>256)throw Error('CSV exceeds 256 columns.');for(const row of value)for(const cell of Object.values(row))if(cell!==null&&typeof cell==='object')throw Error('Nested cells cannot be converted to flat CSV.');return {text:[columns.map(csvCell).join(','),...value.slice(0,a.limit??500).map(row=>columns.map(k=>csvCell(Object.hasOwn(row,k)?row[k]:null)).join(','))].join('\r\n')+'\r\n',truncated:value.length>(a.limit??500)};},
 pc_git_status:(a,t,c,s)=>git(c,a,t[0],['status','--short','--branch','--untracked-files=normal'],s),
 pc_git_diff:(a,t,c,s)=>git(c,a,t[0],['diff','--no-ext-diff','--no-textconv',...(a.staged?['--cached']:[]),'--'],s),
 pc_git_log:(a,t,c,s)=>git(c,a,t[0],['log','--max-count='+String(a.limit??20),'--format=%h%x09%ad%x09%s','--date=iso-strict'],s),
 pc_git_branches:(a,t,c,s)=>git(c,a,t[0],['branch','--list','--format=%(refname:short)%09%(objectname:short)'],s),
 pc_git_remotes:(a,t,c,s)=>git(c,a,t[0],['remote','-v'],s),
 pc_git_show_file:(a,t,c,s)=>git(c,a,t[0],['show','--no-ext-diff','--no-textconv',revision(a.revision)+':'+relativeFile(a.file)],s),
 pc_git_ls_files:(a,t,c,s)=>git(c,a,t[0],['ls-files','--'],s),
 pc_git_blame:(a,t,c,s)=>git(c,a,t[0],['blame','--no-textconv','-L',`${a.startLine??1},+${a.lines??100}`,'--',relativeFile(a.file)],s),
 pc_git_stash_list:(a,t,c,s)=>git(c,a,t[0],['stash','list','--max-count=100','--format=%gd%x09%s'],s),
 pc_git_tags:(a,t,c,s)=>git(c,a,t[0],['for-each-ref','--count=500','--format=%(refname:short)','refs/tags'],s),
 pc_git_head:(a,t,c,s)=>git(c,a,t[0],['rev-parse','--show-toplevel','HEAD'],s),
 pc_git_check_ignore:(a,t,c,s)=>git(c,a,t[0],['check-ignore','-v','--',relativeFile(a.file)],s),
 pc_text_stats:async(a,t)=>{const {text,bytes}=await readText(t[0]);return {bytes:bytes.length,characters:[...text].length,lines:text?text.split(/\r\n|\r|\n/).length:0,words:(text.match(/\S+/g)||[]).length,crlf:(text.match(/\r\n/g)||[]).length,lf:(text.match(/(?<!\r)\n/g)||[]).length};},
 pc_text_normalize:async(a,t)=>{let {text}=await readText(t[0]);text=text.replace(/\r\n|\r/g,'\n');if(a.trimTrailingSpace)text=text.replace(/[ \t]+$/gm,'');if(a.newline==='crlf')text=text.replace(/\n/g,'\r\n');return {text};},
 pc_text_duplicate_lines:async(a,t)=>{const {text}=await readText(t[0]),seen=new Map();text.split(/\r?\n/).forEach((line,index)=>{if(!line.trim())return;const key=a.caseSensitive?line:line.toLowerCase(),r=seen.get(key)||{text:line,lines:[],count:0};r.count++;if(r.lines.length<100)r.lines.push(index+1);seen.set(key,r);});const duplicates=[...seen.values()].filter(r=>r.count>1);return {duplicates:duplicates.slice(0,a.limit??100),truncated:duplicates.length>(a.limit??100)};},
 pc_markdown_headings:async(a,t)=>{const {text}=await readText(t[0]),lines=text.split(/\r?\n/),headings=[];let fence=null,previous='';for(let i=0;i<lines.length;i++){const line=lines[i],marker=line.match(/^\s{0,3}(`{3,}|~{3,})/);if(marker){if(!fence)fence={char:marker[1][0],length:marker[1].length};else if(marker[1][0]===fence.char&&marker[1].length>=fence.length)fence=null;previous='';continue;}if(fence)continue;const h=line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);if(h)headings.push({line:i+1,level:h[1].length,text:h[2]});else if(previous.trim()&&/^\s{0,3}(=+|-+)\s*$/.test(line))headings.push({line:i,level:line.trim()[0]==='='?1:2,text:previous.trim()});previous=line;}return {headings:headings.slice(0,a.limit??200),truncated:headings.length>(a.limit??200)};},
 pc_file_byte_sample:async(a,t)=>{const file=await fsp.open(t[0],'r');try{if(!(await file.stat()).isFile())throw Error('Expected a file.');const buffer=Buffer.alloc(a.length??256),{bytesRead}=await file.read(buffer,0,buffer.length,a.offset??0),data=buffer.subarray(0,bytesRead);return {offset:a.offset??0,bytes:bytesRead,hex:data.toString('hex'),base64:data.toString('base64')};}finally{await file.close();}},
 pc_file_exists:async(a,t)=>{try{const info=await fsp.lstat(t[0]);return {path:t[0],exists:true,type:info.isSymbolicLink()?'link':info.isDirectory()?'directory':info.isFile()?'file':'other',size:info.size,modifiedAt:info.mtimeMs};}catch(error){if(error.code==='ENOENT')return {path:t[0],exists:false};throw error;}},
 pc_file_lines:async(a,t)=>{const {text}=await readText(t[0]),lines=textLines(text),start=Math.max(1,a.startLine??1),cap=intArg(a.maxLines,500,1,5000),end=Math.min(lines.length,a.endLine??lines.length,start+cap-1);if(end<start)throw Error('endLine must not be before startLine.');return {path:t[0],startLine:start,endLine:end,totalLines:lines.length,text:lines.slice(start-1,end).join('\n'),truncated:end<Math.min(lines.length,a.endLine??lines.length)};},
 pc_text_between:async(a,t)=>{const {text}=await readText(t[0]),from=text.indexOf(a.start);if(from<0)throw Error('Start marker was not found.');const to=text.indexOf(a.end,from+a.start.length);if(to<0)throw Error('End marker was not found after the start marker.');const value=text.slice(from+a.start.length,to),limit=intArg(a.limit,20000,1,200000);return {path:t[0],length:value.length,text:value.slice(0,limit),truncated:value.length>limit};},
 pc_search_text:async(a,t,c,s)=>{const needle=a.caseSensitive?a.text:a.text.toLowerCase(),maxFiles=intArg(a.maxFiles,200,1,500),maxMatches=intArg(a.maxMatches,100,1,500),result=await walk(t[0],intArg(a.depth,4,0,8),s),matches=[];let scanned=0,budget=33554432,truncated=result.truncated;for(const entry of result.entries){if(entry.type!=='file')continue;if(scanned>=maxFiles||matches.length>=maxMatches){truncated=true;break;}if(entry.bytes>1048576||entry.bytes>budget)continue;scanned++;budget-=entry.bytes;let text;try{text=(await readText(entry.path)).text;}catch{continue;}if(text.includes('\0'))continue;const lines=textLines(text);for(let index=0;index<lines.length;index++){const line=lines[index];if((a.caseSensitive?line:line.toLowerCase()).includes(needle)){matches.push({path:entry.path,line:index+1,text:line.slice(0,2000)});if(matches.length>=maxMatches){truncated=true;break;}}}}return {matches,filesScanned:scanned,truncated};},
 pc_find_largest_files:async(a,t,c,s)=>{const result=await walk(t[0],intArg(a.depth,4,0,8),s),minimum=a.minBytes??0,limit=intArg(a.limit,50,1,500),files=result.entries.filter(e=>e.type==='file'&&e.bytes>=minimum).sort((x,y)=>y.bytes-x.bytes);return {files:files.slice(0,limit).map(e=>({path:e.path,bytes:e.bytes,modifiedAt:e.modifiedAt})),matched:files.length,truncated:result.truncated||files.length>limit};},
 pc_list_extensions:async(a,t,c,s)=>{const result=await walk(t[0],intArg(a.depth,4,0,8),s),counts=new Map();for(const entry of result.entries){if(entry.type!=='file')continue;const key=path.extname(entry.path).toLowerCase()||'(none)',row=counts.get(key)||{extension:key,files:0,bytes:0};row.files++;row.bytes+=entry.bytes;counts.set(key,row);}const rows=[...counts.values()].sort((x,y)=>y.files-x.files||y.bytes-x.bytes);return {extensions:rows.slice(0,200),truncated:result.truncated||rows.length>200};},
 pc_disk_space:async(a,t)=>{const info=await fsp.statfs(t[0]);const total=Number(info.blocks)*Number(info.bsize),free=Number(info.bfree)*Number(info.bsize),available=Number(info.bavail)*Number(info.bsize);return {path:t[0],totalBytes:total,freeBytes:free,availableBytes:available};},
 pc_env_vars:async a=>{const filter=String(a.filter||'').toLowerCase(),limit=intArg(a.limit,200,1,2000),rows=[];for(const name of Object.keys(process.env).sort()){if(filter&&!name.toLowerCase().includes(filter))continue;const row={name};if(a.includeValues===true)row.value=process.env[name]??'';rows.push(row);if(rows.length>=limit)break;}return {variables:rows,total:Object.keys(process.env).length,truncated:rows.length>=limit&&Object.keys(process.env).length>rows.length};},
 pc_which:async a=>{const name=String(a.name||'').trim();if(!name||/[\0\r\n]/.test(name)||name.length>256)throw Error('Choose a command name.');const dirs=String(process.env.PATH||'').split(path.delimiter).filter(Boolean).slice(0,200),extensions=process.platform==='win32'?String(process.env.PATHEXT||'.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean):[''],candidates=process.platform==='win32'&&!path.extname(name)?extensions.map(ext=>name+ext):[name],matches=[];for(const dir of dirs){for(const candidate of candidates){const full=path.join(dir,candidate);try{const info=await fsp.stat(full);if(info.isFile()){matches.push(full);break;}}catch{}}if(matches.length>=20)break;}return {name,matches,truncated:matches.length>=20};},
 pc_network_interfaces:async()=>{const interfaces=os.networkInterfaces(),rows=[];for(const [name,addresses] of Object.entries(interfaces))for(const entry of addresses||[])rows.push({name,address:entry.address,family:entry.family,mac:entry.mac,internal:entry.internal,netmask:entry.netmask,cidr:entry.cidr});return {interfaces:rows};},
 pc_process_list:async(a,t,c,s)=>{const windows=process.platform==='win32',program=windows?'tasklist':'ps',args=windows?['/FO','CSV','/NH']:['-eo','pid=,comm='],limit=intArg(a.limit,100,1,500),filter=String(a.filter||'').toLowerCase(),result=await c.runProgram({program,args,timeoutMs:8000},os.homedir(),s);if(result.exitCode!==0)throw Error('Could not list processes: '+result.stderr.slice(0,500));const rows=[];for(const line of textLines(result.stdout)){const trimmed=line.trim();if(!trimmed)continue;let name,pid;if(windows){const match=trimmed.match(/^"([^"]*)","(\d+)"/);if(!match)continue;name=match[1];pid=Number(match[2]);}else{const match=trimmed.match(/^(\d+)\s+(.+)$/);if(!match)continue;pid=Number(match[1]);name=match[2].trim();}if(filter&&!name.toLowerCase().includes(filter))continue;rows.push({pid,name});if(rows.length>=limit)break;}return {processes:rows,truncated:result.truncated||rows.length>=limit,timedOut:result.timedOut};},
 pc_dns_lookup:async a=>{const hostname=String(a.hostname||'').trim();if(!hostname||hostname.length>253||/[\0\r\n]/.test(hostname))throw Error('Choose a hostname.');const addresses=await withTimeout(dns.promises.lookup(hostname,{all:true,verbatim:true}),5000,'DNS lookup timed out.');return {hostname,addresses:addresses.map(entry=>({address:entry.address,family:entry.family}))};},
 pc_port_probe:async a=>new Promise((resolve,reject)=>{const host=String(a.host||'').trim(),port=Number(a.port);if(!host||host.length>253||/[\0\r\n]/.test(host))throw Error('Choose a host.');if(!Number.isInteger(port)||port<1||port>65535)throw Error('Use a TCP port from 1 to 65535.');const started=Date.now(),socket=net.connect({host,port});let done=false;const finish=open=>{if(done)return;done=true;socket.destroy();resolve({host,port,open,ms:Date.now()-started});};socket.setTimeout(intArg(a.timeoutMs,3000,200,10000),()=>finish(false));socket.once('connect',()=>finish(true));socket.once('error',error=>{if(error.code==='ECONNREFUSED'||error.code==='ENOTFOUND'||error.code==='EHOSTUNREACH'){finish(false);return;}if(!done){done=true;socket.destroy();reject(error);}});}),
 pc_http_get:async a=>{const url=String(a.url||'').trim();if(!url||url.length>2048||/[\0\r\n]/.test(url))throw Error('Choose a URL without newlines.');return httpText(url,intArg(a.maxBytes,262144,1024,1048576),intArg(a.timeoutMs,10000,1000,20000));},
 pc_regex_extract:async(a,t)=>{const expression=regex(a.pattern,'gms'),{text}=await readText(t[0]),limit=intArg(a.limit,100,1,500),matches=[];let match;while((match=expression.exec(text))&&matches.length<limit){const line=text.slice(0,match.index).split(/\r\n|\r|\n/).length;matches.push({match:match[0].slice(0,2000),groups:match.slice(1).map(group=>group===undefined?null:group.slice(0,2000)),index:match.index,line});if(match[0]==='')expression.lastIndex++;}return {matches,truncated:matches.length>=limit&&expression.lastIndex<text.length};},
 pc_markdown_links:async(a,t)=>{const {text}=await readText(t[0]),limit=intArg(a.limit,100,1,500),links=[];let fence=null;text.split(/\r\n|\r|\n/).forEach((line,index)=>{const marker=line.match(/^\s{0,3}(`{3,}|~{3,})/);if(marker){if(!fence)fence={char:marker[1][0],length:marker[1].length};else if(marker[1][0]===fence.char&&marker[1].length>=fence.length)fence=null;return;}if(fence||links.length>=limit)return;const inline=/\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;let match;while((match=inline.exec(line))&&links.length<limit)links.push({text:match[1].slice(0,500),url:match[2].slice(0,2000),line:index+1});const auto=/<((?:https?|mailto):[^>\s]+)>/g;while((match=auto.exec(line))&&links.length<limit)links.push({text:'',url:match[1].slice(0,2000),line:index+1});});return {links,truncated:links.length>=limit};},
 pc_markdown_toc:async(a,t)=>{const {text}=await readText(t[0]),limit=intArg(a.limit,200,1,500),headings=[];let fence=null,previous='';const lines=text.split(/\r\n|\r|\n/);for(let index=0;index<lines.length;index++){const line=lines[index],marker=line.match(/^\s{0,3}(`{3,}|~{3,})/);if(marker){if(!fence)fence={char:marker[1][0],length:marker[1].length};else if(marker[1][0]===fence.char&&marker[1].length>=fence.length)fence=null;previous='';continue;}if(fence)continue;const heading=line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);const setext=!heading&&previous.trim()&&/^\s{0,3}(=+|-+)\s*$/.test(line)?{level:line.trim()[0]==='='?1:2,text:previous.trim(),index:index-1}:null;if(heading)headings.push({level:heading[1].length,text:heading[2],line:index+1});else if(setext)headings.push({...setext,line:setext.index+1});previous=line;if(headings.length>=limit)break;}const anchor=value=>value.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu,'').replace(/\s+/g,'-');const toc=headings.map(heading=>'  '.repeat(heading.level-1)+'- ['+heading.text+'](#'+anchor(heading.text)+')').join('\n');return {headings,toc,truncated:headings.length>=limit};},
 pc_json_paths:async(a,t)=>{const value=(await readJson(t[0])).value,out=[];jsonNodes(value,'',0,out,intArg(a.limit,500,1,5000),false);return {paths:out,truncated:out.length>=intArg(a.limit,500,1,5000)};},
 pc_json_flatten:async(a,t)=>{const value=(await readJson(t[0])).value,out=[];jsonNodes(value,'',0,out,intArg(a.limit,500,1,5000),true);return {leaves:out,truncated:out.length>=intArg(a.limit,500,1,5000)};},
 pc_csv_group:async(a,t)=>{const {headers,data}=table(parseCsv((await readText(t[0])).text)),index=headers.indexOf(a.column),valueIndex=a.valueColumn===undefined?-1:headers.indexOf(a.valueColumn);if(index<0)throw Error('CSV group column does not exist.');if(a.aggregate!=='count'&&(valueIndex<0||!a.valueColumn))throw Error('Choose a valueColumn for this aggregation.');if(a.aggregate!=='count'&&valueIndex<0)throw Error('CSV value column does not exist.');const groups=new Map();let skipped=0;for(const row of data){const key=row[index]??'',current=groups.get(key)||{key,count:0,sum:0,min:Infinity,max:-Infinity,numeric:0};current.count++;if(a.aggregate!=='count'&&valueIndex>=0){const number=Number(row[valueIndex]);if(row[valueIndex]===undefined||String(row[valueIndex]).trim()===''||!Number.isFinite(number))skipped++;else{current.sum+=number;current.min=Math.min(current.min,number);current.max=Math.max(current.max,number);current.numeric++;}}groups.set(key,current);}const limit=intArg(a.limit,100,1,1000),rows=[...groups.values()].map(group=>({key:group.key,count:group.count,sum:group.numeric?group.sum:null,average:group.numeric?group.sum/group.numeric:null,min:group.numeric?group.min:null,max:group.numeric?group.max:null}));return {groups:rows.slice(0,limit),skipped,truncated:rows.length>limit};},
 pc_csv_distinct:async(a,t)=>{const {headers,data}=table(parseCsv((await readText(t[0])).text)),index=headers.indexOf(a.column);if(index<0)throw Error('CSV column does not exist.');const counts=new Map();for(const row of data){const key=row[index]??'';counts.set(key,(counts.get(key)||0)+1);}const limit=intArg(a.limit,100,1,1000),values=[...counts].map(([value,count])=>({value,count})).sort((x,y)=>y.count-x.count);return {values:values.slice(0,limit),truncated:values.length>limit};},
 pc_csv_row_lookup:async(a,t)=>{const {headers,data}=table(parseCsv((await readText(t[0])).text)),index=headers.indexOf(a.column);if(index<0)throw Error('CSV column does not exist.');const mode=a.mode||'equals',limit=intArg(a.limit,100,1,500),rows=data.filter(row=>mode==='contains'?String(row[index]??'').includes(a.value):String(row[index]??'')===a.value);return {rows:csvObjects(headers,rows.slice(0,limit)),matched:rows.length,truncated:rows.length>limit};},
 pc_diff_files:async(a,t)=>{const read=async target=>{const {text}=await readText(target);const lines=textLines(text),cap=intArg(a.maxLines,400,1,2000);return {lines:lines.slice(0,cap),truncated:lines.length>cap};};const [left,right]=await Promise.all(t.map(read));if(left.lines.length===right.lines.length&&left.lines.every((line,index)=>line===right.lines[index]))return {equal:true};return {...firstDifference(left.lines,right.lines,intArg(a.context,3,0,20),2000),leftTruncated:left.truncated,rightTruncated:right.truncated};},
 pc_text_replace_regex:async(a,t,c,s)=>{const expression=regex(a.pattern,a.flags),{text,bytes}=await readText(t[0]),found=(text.match(expression)||[]).length;if(found!==a.expectedOccurrences)throw Error(`Expected ${a.expectedOccurrences} matches; found ${found}. Nothing changed.`);return atomicWrite(t[0],text.replace(expression,a.replacement),bytes,s);},
 pc_text_sort_lines:async(a,t,c,s)=>{const {text,bytes}=await readText(t[0]),newline=text.includes('\r\n')?'\r\n':'\n',trailing=text.endsWith('\n'),lines=textLines(trailing?text.replace(/\r\n|\r|\n$/,''):text);let sorted=lines.slice().sort((x,y)=>a.caseSensitive?x.localeCompare(y):x.toLocaleLowerCase().localeCompare(y.toLocaleLowerCase()));if(a.descending)sorted.reverse();if(a.unique){const seen=new Set();sorted=sorted.filter(line=>{const key=a.caseSensitive?line:line.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});}return atomicWrite(t[0],sorted.join(newline)+(trailing?newline:''),bytes,s);},
 pc_text_dedupe_lines:async(a,t,c,s)=>{const {text,bytes}=await readText(t[0]),newline=text.includes('\r\n')?'\r\n':'\n',trailing=text.endsWith('\n'),seen=new Set(),lines=[];for(const line of textLines(trailing?text.replace(/\r\n|\r|\n$/,''):text)){const key=a.caseSensitive?line:line.toLowerCase();if(seen.has(key))continue;seen.add(key);lines.push(line);}return atomicWrite(t[0],lines.join(newline)+(trailing?newline:''),bytes,s);},
 pc_json_merge_into:async(a,t,c,s)=>{const [source,destination]=await Promise.all(t.map(readJson));return atomicWrite(t[1],JSON.stringify(merge(destination.value,source.value),null,2)+'\n',destination.bytes,s);},
 pc_write_bytes:async(a,t,c,s)=>{if(typeof a.base64!=='string'||a.base64.length>2796204||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64)||a.base64.length%4!==0)throw Error('Use valid base64 of at most 2 MB.');const buffer=Buffer.from(a.base64,'base64');if(buffer.length>2097152)throw Error('Decoded content exceeds 2 MB.');return writeBytesAtomic(t[0],buffer,s);},
 pc_touch_path:async(a,t,c,s)=>{check(s);const now=new Date();await fsp.utimes(t[0],now,now);return {path:t[0],modifiedAt:now.getTime()};},
 pc_truncate_file:async(a,t,c,s)=>{check(s);const info=await fsp.stat(t[0]);if(!info.isFile())throw Error('Expected a regular file.');if(a.bytes>=info.size)throw Error('Truncate requires a length smaller than the current size.');await fsp.truncate(t[0],a.bytes);return {path:t[0],bytes:a.bytes,previousBytes:info.size};},
 pc_remove_empty_directory:async(a,t,c,s)=>{check(s);const info=await fsp.stat(t[0]);if(!info.isDirectory())throw Error('Expected a directory.');const entries=await fsp.readdir(t[0]);if(entries.length)throw Error('Directory is not empty.');await fsp.rmdir(t[0]);return {removed:t[0]};},
 pc_git_show_commit:(a,t,c,s)=>git(c,a,t[0],['show','--no-ext-diff','--no-textconv','--format=fuller','--stat',revision(a.revision)],s),
 pc_git_reflog:(a,t,c,s)=>git(c,a,t[0],['reflog','--date=iso-strict','--max-count='+String(intArg(a.limit,50,1,500))],s),
 pc_git_config:async(a,t,c,s)=>{const limit=intArg(a.limit,200,1,500),result=await git(c,a,t[0],['config','--list','--show-origin'],s),lines=String(result.stdout||'').split(/\r?\n/);return {...result,stdout:lines.slice(0,limit).join('\n'),truncated:result.truncated||lines.length>limit};},
 pc_git_worktrees:(a,t,c,s)=>git(c,a,t[0],['worktree','list','--porcelain'],s),
 pc_git_count_objects:(a,t,c,s)=>git(c,a,t[0],['count-objects','-v'],s),
 pc_git_ahead_behind:(a,t,c,s)=>git(c,a,t[0],['rev-list','--left-right','--count',(a.upstream?revision(a.upstream):'@{upstream}')+'...'+revision(a.revision||'HEAD')],s),
 pc_git_shortlog:(a,t,c,s)=>git(c,a,t[0],['shortlog','-sne','--max-count='+String(intArg(a.limit,200,1,5000)),revision(a.revision||'HEAD')],s),
 pc_git_ls_tree:(a,t,c,s)=>git(c,a,t[0],['ls-tree','-r','--name-only',revision(a.revision||'HEAD')],s),
 pc_git_grep:(a,t,c,s)=>{const value=pattern(a.pattern);return git(c,a,t[0],['grep','-n','--no-color','--max-count='+String(intArg(a.limit,100,1,500)),a.fixed===true?'-F':'-E',value,'--'],s);},
};
for(const tool of catalog)if(typeof handlers[tool.name]!=='function')throw Error('Missing computer handler: '+tool.name);
if(Object.keys(handlers).length!==catalog.length)throw Error('Computer catalogue/handler mismatch.');
async function execute(tool,args,targets,context,signal){
 validate(tool,args);check(signal);
 const result=await handlers[tool](args,targets,context,signal);
 if(Buffer.byteLength(JSON.stringify(result))>MAX_OUTPUT)throw Error('Result exceeds 512 KB. Use a smaller limit or a narrower query.');
 return result;
}
module.exports={catalog,definitions,resolvePaths,execute,validate,parseCsv,query,jsonDiff};
