const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const T=require('./core/task-policy'),{Queue}=require('./core/cowork');
const source=fs.readFileSync(path.join(__dirname,'core/workflow.js'),'utf8');
const library=[{folder:'world',name:'World building',description:'Village buildings roads terrain environment assets'},
 {folder:'assets',name:'Assets',description:'Village buildings roads terrain environment assets'}];
const tick=()=>new Promise(r=>setImmediate(r));
function harness(respond,{budget=40,skills=library}={}){
 const calls=[],saved=[];let conversation='chat-a',turn=1;
 const context=vm.createContext({ZSTasks:{...T,CONTEXT_PREFETCH_MS:budget},ZSCowork:{Queue},performance,crypto:webcrypto,TextEncoder,AbortController,setTimeout,clearTimeout,
  chrome:{storage:{local:{get:async()=>({zsScriptProfile:'roblox'}),set:async v=>saved.push(v)},onChanged:{addListener(){}}}}});
 vm.runInContext(source,context);
 const runtime=context.ZSWorkflow.create({P:{id:'fixture',conversationKey:()=>conversation,assistantCount:()=>turn},
  getSkills:()=>skills,canRun:()=>true,bg:(...args)=>{calls.push(args);return respond(...args);}});
 return {runtime,calls,saved,setConversation:v=>conversation=v,setTurn:v=>turn=v};
}
(async()=>{
 const pending=[];const h=harness(()=>new Promise(r=>pending.push(r)),{budget:1000});
 const first=h.runtime.begin('Build a village','one');const joined=h.runtime.begin('This must join preparation','two');await tick();
 assert.equal(h.calls.length,2,'both read-only skill requests start together; reentry starts no duplicates');
 pending[1]({ok:true,text:'second body'});await tick();pending[0]({ok:true,text:'first body'});
 const task=await first;assert.equal(await joined,task);assert.equal(task.metrics.skillsLoaded,2);
 assert.ok(task.context.indexOf('Relevant skill '+task.selectedSkills[0].folder)<task.context.indexOf('Relevant skill '+task.selectedSkills[1].folder),'completion order does not reorder context');
 h.runtime.delivered(task);h.runtime.finalise('completed');
 const reused=await h.runtime.begin('Build a village','three');assert.equal(h.calls.length,2,'same files use cache');assert.equal(reused.context,'');assert.equal(reused.metrics.skillsReused,2);assert.equal(reused.policyDelivered,true,'confirmed context avoids a redundant AI turn');h.runtime.finalise('completed');
 h.setConversation('chat-b');const other=await h.runtime.begin('Build a village','four');assert.equal(h.calls.length,2,'file cache survives chat changes');assert.equal(other.metrics.skillsReused,0);assert.ok(other.context.length,'different chats still receive instructions');h.runtime.delivered(other);h.runtime.finalise('completed');
 h.setTurn(20);const later=await h.runtime.begin('Build a village','five');assert.ok(later.context.length,'old conversation context must be refreshed after eight replies');h.runtime.finalise('completed');

 const slow=harness(()=>new Promise(()=>{}));const start=performance.now();const deferred=await slow.runtime.begin('Build a village','slow');const elapsed=performance.now()-start;
 assert.ok(elapsed<400,`prefetch exceeded its 40ms test budget: ${elapsed}`);assert.equal(deferred.context,'');assert.match(deferred.contextWarning,/Not preloaded/);assert.equal(deferred.policyDelivered,false);slow.runtime.finalise('cancelled');
 const cancelPending=[];const cancel=harness(()=>new Promise(r=>cancelPending.push(r)),{budget:1000});const cancelled=cancel.runtime.begin('Build a village','cancel');await tick();cancel.runtime.cancel();cancel.runtime.finalise('cancelled');const stopped=await cancelled;assert.equal(stopped.outcome,'cancelled');assert.equal(stopped.context,'');for(const resolve of cancelPending)resolve({ok:true,text:'late body'});await tick();assert.equal(stopped.context,'');
 const oversized=harness(async()=>({ok:true,text:'x'.repeat(T.CONTEXT_CHARS)}));const large=await oversized.runtime.begin('Build a village','large');assert.ok(large.context.length<=T.CONTEXT_CHARS);assert.equal(large.metrics.skillsLoaded,0);assert.match(large.contextWarning,/Not preloaded/);oversized.runtime.finalise('completed');
 const failed=harness(async()=>{throw Error('Disconnected');});const failure=await failed.runtime.begin('Build a village','failed');assert.match(failure.contextWarning,/Not preloaded/);failed.runtime.finalise('failed');
 const simple=harness(()=>{throw Error('No irrelevant reads');});const small=await simple.runtime.begin('Hello','small');assert.equal(simple.calls.length,0);assert.equal(small.metrics.aiRoundTrips,0);simple.runtime.finalise('completed');
 assert.match(T.taskGuidance(T.createTask({text:'Refactor the entire backend'})),/acceptance criteria/);assert.match(T.taskGuidance(T.createTask({text:'Hello'})),/act directly/);assert.match(T.policy(),/evaluate alternatives and failure modes/);
 for(const name of ['pc_text_replace_regex','pc_text_sort_lines','pc_text_dedupe_lines'])assert.equal(T.readOnly(name),false,'writes cannot be classified as context reads');
 console.log(`PASS concurrent/single-flight skill preparation, bounded wait (${Math.round(elapsed)}ms / 40ms fixture), cache reuse, confirmed context reuse, chat/turn isolation, cancel/late reads, size bounds and task planning`);
})().catch(e=>{console.error(e);process.exitCode=1;});
