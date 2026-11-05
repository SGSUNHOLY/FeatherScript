const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('./core/commands');
assert.equal(C.providerNoticeKind("You've reached your message limit. You can continue at 5:21 PM"),'rate_limit');
assert.equal(C.providerNoticeKind("You've reached your limit. Responses will use another model until reset"),null);
for(const text of ['Your limit resets at 5:21 PM','You have reached your message limit','Too many requests. Try again later.','Resource_exhausted','You’ve used up your credits']){
 assert.equal(C.providerNoticeKind(text),'rate_limit',text);
 assert.equal(C.classifySiteError(text,{generating:true},{},0).kind,'rate_limit','a stuck generating indicator cannot hide a confirmed provider wall');
}
for(const text of ['Verify you are human','Sign in to continue','Session has expired'])assert.equal(C.providerNoticeKind(text),'provider_blocked');
for(const text of ['Use a larger context window','You can still continue using another model','The limit parameter is 50'])assert.equal(C.providerNoticeKind(text),null);
for(const text of ['Edit datamodel is not available','Edit DataModel is unavailable. Available DataModels: Server, Client',"The datamodel 'Edit' is not accessible"])
 assert.equal(C.studioStateFailure(text),'edit_unavailable');
assert.equal(C.studioStateFailure('{"text":"Edit datamodel is not available"}'),null,'structured application output is not a rejection');
assert.equal(C.studioStateFailure('The property is invalid'),null);
const source=fs.readFileSync(path.join(__dirname,'core/main.js'),'utf8');
const from=source.indexOf('    const editState=ZSCommands.studioStateFailure'),to=source.indexOf('    // The Roblox MCP reports missing/invalid',from);assert.ok(from>0&&to>from);
const ctx=vm.createContext({ZSCommands:C});vm.runInContext('globalThis.feedback=(r,bareName,name)=>{'+source.slice(from,to)+';return null;}',ctx);
const feedback=ctx.feedback({ok:false,error:'Edit datamodel is not available'},'multi_edit','multi_edit');assert.match(feedback,/confirm get_studio_state explicitly lists Edit/);assert.match(feedback,/Do not resend/);assert.ok(!feedback.includes('fix the call and retry'));
assert.equal(ctx.feedback({ok:true,text:'Edit datamodel is not available'},'script_read','script_read'),null,'a read returning quoted text stays a read');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'),'utf8'));
let entries=0;for(const entry of manifest.content_scripts){if(!entry.js?.includes('core/main.js'))continue;entries++;assert.ok(entry.js.includes('core/provider-status.js'));assert.ok(entry.js.indexOf('core/commands.js')<entry.js.indexOf('core/provider-status.js'));assert.ok(entry.js.indexOf('core/provider-status.js')<entry.js.indexOf('core/main.js'));}
assert.equal(entries,13);
(async()=>{
 const notice={kind:'rate_limit',detail:'Your limit resets at 5:21 PM'};let pauses=0;
 const guard=vm.createContext({providerStatus:{scan:()=>notice},pauseForProvider:()=>pauses++});
 const begin=source.indexOf('  async function runTool(call) {'),end=source.indexOf('  async function runToolImpl',begin);assert.ok(begin>0&&end>begin);
 vm.runInContext(source.slice(begin,end)+';globalThis.run=runTool;',guard);
 assert.match(await guard.run({tool:'multi_edit',arguments:{}}),/command was not sent/);assert.equal(pauses,1);
 const loop=vm.createContext({A:{running:false,providerBlocked:notice}}),a=source.indexOf('  async function agentLoop(base)');
 // Isolate the loop rather than evaluating unrelated page state.
 const stop=source.indexOf('  // Mark the current assistant turn',a);assert.ok(stop>a);vm.runInContext(source.slice(a,stop)+';globalThis.loop=agentLoop;',loop);assert.equal(await loop.loop(0),undefined,'blocked provider must not auto-resume commands');
 console.log('PASS quota/auth classification, nonblocking advisories, Studio Edit-state recovery, read isolation, pre-tool blocking, auto-resume guard and adapter order across all 13 providers');
})().catch(e=>{console.error(e);process.exitCode=1;});
