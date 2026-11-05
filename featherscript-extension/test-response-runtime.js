const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'core/main.js'),'utf8');
const Commands=require('./core/commands');
function watcher(frames,overrides={}){
 let clock=10000,reads=0;
 const state={stop:false,sendToken:'baseline',toolNames:new Set()};
 const frame=()=>frames(clock-10000,reads);
 const ctx=vm.createContext({providerStatus:{scan:()=>frame().block||null,assertCanSend(){}},A:state,workflow:null,T:{RESPONSE_TIMEOUT_MS:5000,STABLE_MS:9000,WARMUP_MS:1000,REASON_NOREPLY_MS:1000,...overrides},
 Date:{now:()=>clock},performance:{now:()=>clock},diag(){},log(){},knownTool:()=>false,bareToolName:s=>s,
 waitDom:async ms=>{clock+=ms;},ZSCommands:{...Commands,classifySiteError:(message,options,state)=>Commands.classifySiteError(message,options,state,clock)},
 P:{displayName:'Fixture',isGenerating:()=>!!frame().gen,readAssistant:()=>{reads++;const f=frame();if(f.error)throw Error('Detached subtree');return f.read;},
 lastAssistantId:()=>frame().token,assistantCount:()=>frame().count??0,scanError:()=>frame().siteError||'',turnHalted:()=>false,
 findContinueBtn:()=>null,isTooLongMsg:()=>false,isBusyMsg:()=>false,startStalled:()=>false}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'core/parser.js'),'utf8'),ctx);
 vm.runInContext(source.match(/  const hasReplyContent = .*;/)[0],ctx);
 vm.runInContext(source.match(/  const isSiteNoticeReply = [^;]+;/)[0],ctx);
 const start=source.indexOf('  async function waitForResponseImpl(base)');
 const end=source.indexOf('  // ═',start);
 vm.runInContext(source.slice(start,end)+';globalThis.waitReply=waitForResponseImpl;',ctx);
 return {run:()=>ctx.waitReply(0),elapsed:()=>clock-10000};
}
(async()=>{
 const a={},b={};
 const limit=watcher(()=>({gen:true,block:{kind:'rate_limit',detail:'Your limit resets at 5:21 PM'},read:{item:null,reply:'',thinking:''}}));assert.equal((await limit.run()).kind,'rate_limit');assert.ok(limit.elapsed()<1000);
 const auth=watcher(()=>({block:{kind:'provider_blocked',detail:'Sign in to continue'},read:{item:null,reply:'',thinking:''}}));assert.equal((await auth.run()).kind,'provider_blocked');
 for(const remount of [false,true]){
  const w=watcher(t=>({token:'turn-1',count:1,read:{item:t<120?a:remount?b:a,reply:t<120?'Ready.':'',thinking:''}}));
  const result=await w.run();assert.equal(result.kind,'text');assert.equal(result.text,'Ready.');assert.ok(w.elapsed()<1500,'remount must not trigger warmup/empty retry');
 }
 const replaced=watcher(t=>({token:t<120?'turn-1':'turn-2',count:1,read:{item:a,reply:t<120?'Old reply':t<800?'':'New reply',thinking:''}}));
 assert.equal((await replaced.run()).text,'New reply','reused DOM nodes must not inherit old logical-turn text');
 for(const mode of ['throw','undefined']){
  const w=watcher((t,n)=>({token:'turn-1',count:1,error:n<3&&mode==='throw',read:n<3&&mode==='undefined'?undefined:{item:a,reply:'Recovered',thinking:''}}));
  assert.equal((await w.run()).text,'Recovered');
 }
 const broken=watcher(()=>({error:true}));assert.equal((await broken.run()).kind,'site_error');assert.ok(broken.elapsed()<4000);
 const site=watcher(()=>({token:null,count:0,siteError:'Service unavailable',read:{item:null,reply:'',thinking:''}}));
 assert.equal((await site.run()).kind,'site_error');assert.ok(site.elapsed()<7000);
 const malformed=watcher(t=>({token:'turn-1',count:1,gen:t<160,read:{item:a}}));assert.equal((await malformed.run()).kind,'empty');
 // Some models pause >9s midway through a plain-text response while still
 // generating. Previously that pause finalized the first fragment as complete.
 const paused=watcher(t=>({token:'turn-1',count:1,gen:t<26000,
  read:{item:a,reply:t<22000?'First chunk':'First chunk and final chunk',thinking:''}}),{RESPONSE_TIMEOUT_MS:80000});
 assert.equal((await paused.run()).text,'First chunk and final chunk','a live generation pause must not truncate the reply');
 // Storage hydration and single-flight refresh have their own cache regression.
 const events=[];let readyTools,readyComposer;
 const bootstrap=vm.createContext({projects:null,A:{startGen:0,toolList:[{name:'test'}]},P:{displayName:'Fixture',chatIsEmpty:()=>true,lastAssistantId:()=>null,setInputLock(){},conversationKey:()=>'/fresh',ensureComposerReady:()=>{events.push('composer');return new Promise(r=>{readyComposer=r;});}},
 ui:{setStarting(){},updateStartGate(){},inputCover(){},setStarted(){},toast(){},banner:(_a,_b,message)=>{throw Error(message);}},
 workflow:{ready:Promise.resolve(),markProfileDelivered(){}},ensureTools:()=>{events.push('tools');return new Promise(r=>{readyTools=r;});},
 systemPrompt:()=>'',submitAndGetBase:async()=>{events.push('sent');return 0;},waitForResponse:async()=>({kind:'text'}),decorate:{sweep(){}},rememberSession(){},diag(){},performance,
 });
 // The Studio gate and the bootstrap are one extractable region: startSession is
 // untestable without waitForStudio sitting in the same slice.
 const bootStart=source.indexOf('  const STUDIO_WAIT_MS');const bootEnd=source.indexOf('  // ═',bootStart);
 assert.ok(bootStart>0&&bootEnd>bootStart,'the bootstrap is still cuttable from the Studio gate down');
 vm.runInContext(source.slice(bootStart,bootEnd)+';globalThis.start=startSession;',bootstrap);
 const boot=bootstrap.start();assert.deepEqual(events,['tools','composer'],'startup prerequisites must start together');
 await bootstrap.start();assert.deepEqual(events,['tools','composer'],'double Start cannot duplicate startup');
 readyComposer({ready:true});readyTools();await boot;assert.equal(bootstrap.A.started,true);assert.equal(events.filter(e=>e==='sent').length,1);
 for(const reply of [{kind:'tool',calls:[{tool:'execute_luau'}]},{kind:'truncated'}]){
  bootstrap.A.started=false;bootstrap.ensureTools=async()=>{};bootstrap.P.ensureComposerReady=async()=>({ready:true});
  bootstrap.waitForResponse=async()=>reply;const errors=[];bootstrap.ui.banner=(_a,_b,message)=>errors.push(message);
  await bootstrap.start();assert.equal(bootstrap.A.started,false,'incomplete or unexpected startup never becomes ready');
  assert.equal(bootstrap.A.starting,false);assert.match(errors[0],/did not finish its handshake/);
 }
 console.log('PASS remount/blank reply recovery, logical-turn isolation, transient/missing reads, early site errors and concurrent single-start bootstrap');
})().catch(e=>{console.error(e);process.exitCode=1;});
