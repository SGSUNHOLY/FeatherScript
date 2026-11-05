const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createBroker,continuation,continuationFile,handoffDocument,KEY,normalize}=require('./core/projects');
async function run(){
  let saved={},counter=0,clock=100;
  const storage={get:async()=>JSON.parse(JSON.stringify(saved)),set:async data=>{saved=JSON.parse(JSON.stringify({...saved,...data}));}};
  const broker=createBroker(storage,{id:()=>`p-${++counter}`,now:()=>++clock});
  const call=message=>broker.dispatch({profile:'roblox',...message});
  const [first,second]=await Promise.all([call({action:'create',title:'Village'}),call({action:'create',title:'Obby'})]);
  assert.equal(saved[KEY].projects.length,2,'concurrent tabs cannot overwrite project creation');
  const id=first.project.id;
  await call({action:'checkpoint',projectId:id,entry:{id:'task-1',prompt:'Build the shop',reply:'',outcome:'running'}});
  await call({action:'checkpoint',projectId:id,entry:{id:'task-1',prompt:'Build the shop',reply:'Shop built in Workspace.Shop.',outcome:'completed'}});
  await call({action:'checkpoint',projectId:id,entry:{id:'task-1',prompt:'stale request',reply:'',outcome:'running'}});
  let project=(await call({action:'get',projectId:id})).project;
  assert.equal(project.entries.length,1);assert.equal(project.entries[0].outcome,'completed','late running checkpoint cannot overwrite completed state');
  await call({action:'checkpoint',projectId:id,entry:{id:'task-2',prompt:'Make the path',outcome:'running'}});
  const context=continuation((await call({action:'get',projectId:id})).project);
  assert.match(context,/Shop built/);assert.match(context,/interrupted_or_still_running/);assert.match(context,/Never replay/);assert.match(context,/inspect the currently connected place/);
  await call({action:'attach',projectId:id,chat:'notion|thread-1'});
  const restarted=createBroker(storage);
  assert.equal((await restarted.dispatch({action:'find',profile:'roblox',chat:'notion|thread-1'})).project.id,id,'a reload restores chat-to-project binding');
  assert.equal((await restarted.dispatch({action:'find',profile:'agent',chat:'notion|thread-1'})).project,null,'PC and Roblox projects stay isolated');
  await assert.rejects(call({action:'get',projectId:id,profile:'agent'}),/not found/);
  await call({action:'attach',projectId:second.project.id,chat:'notion|thread-1'});
  assert.equal((await call({action:'find',chat:'notion|thread-1'})).project.id,second.project.id,'a chat has one project binding');
  // Browser navigation can jump straight between two populated chats, without
  // ever rendering a fresh/empty chat in between.
  const vmContext={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'core/projects-ui.js'),'utf8'),vmContext);
  await call({action:'attach',projectId:id,chat:'notion|thread-A'});
  await call({action:'attach',projectId:second.project.id,chat:'notion|thread-B'});
  let route='thread-A';
  const requests=[];
  const makeUI=()=>vmContext.ZSProjectUI.create({
    P:{id:'notion',displayName:'Notion',conversationKey:()=>route,chatIsEmpty:()=>false},
    bg:message=>{requests.push(message);return broker.dispatch(message);},
    onStart:()=>{}
  });
  const ui=makeUI();
  ui.sync({started:true,profile:'roblox'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await ui.capture('thread-A','roblox')).id,id,'first existing chat restores its project');
  route='thread-B';
  ui.sync({started:true,profile:'roblox'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await ui.capture('thread-B','roblox')).id,second.project.id,'new existing chat restores its own project');
  assert.equal(requests.some(r=>r.action==='attach'&&r.chat==='notion|thread-B'&&r.projectId===id),false,'navigation cannot attach the previous project to a different chat');
  // A newly bootstrapped chat starts without a URL key and receives one later.
  route='';
  const freshUI=makeUI();
  freshUI.sync({started:false,profile:'roblox',fresh:true});
  route='thread-C';
  const chosen=await freshUI.capture('thread-C','roblox');
  freshUI.sync({started:true,profile:'roblox'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await call({action:'find',chat:'notion|thread-C'})).project.id,chosen.id,'first stable chat URL keeps its newly chosen project');
  // New chats do not always have a provider conversation ID when the first task
  // begins. The detected organization must still get durable memory.
  const detected={kind:'roblox',key:'studio-place-42',name:'Village Place'};
  const unbound=await call({action:'resolve',chat:'',detected,title:'Village Place'});
  assert.equal(unbound.project.chats.length,0,'a missing chat ID must not create a fake chat binding');
  const sameOrigin=await call({action:'resolve',chat:'',detected,title:'Village Place'});
  assert.equal(sameOrigin.project.id,unbound.project.id,'keyless tasks reuse unique detected project memory');
  await call({action:'attach',chat:'notion|newly-assigned-thread',projectId:unbound.project.id});
  assert.equal((await call({action:'find',chat:'notion|newly-assigned-thread'})).project.id,unbound.project.id,
    'keyless project memory attaches after the provider assigns its thread ID');
  for(let i=0;i<20;i++)await call({action:'checkpoint',projectId:id,entry:{id:'extra-'+i,prompt:'x'.repeat(9000),reply:'r'.repeat(9000),outcome:'failed'}});
  project=(await call({action:'get',projectId:id})).project;assert.equal(project.entries.length,12);assert.equal(project.entries[0].prompt.length,3000);assert.ok(continuation(project).length<13000,'handoff stays within prompt budget');
  await assert.rejects(call({action:'checkpoint',projectId:id,entry:{id:'bad',outcome:'made-up'}}),/Invalid/);
  await assert.rejects(call({action:'create',title:' '}),/name/);
  assert.equal(normalize(null).projects.length,0);
  assert.equal((await call({action:'get',projectId:second.project.id})).project.entries.length,0,'new project never inherits another handoff');
  // Firing a handoff has to end with a file, and that file has to be the same
  // document the extension injects into the next chat - otherwise "what I fired"
  // and "what I saved" drift apart and the user loads something else.
  const risky=await call({action:'create',title:'  ../../evil:Village ✓/\\..  '});
  await call({action:'checkpoint',projectId:risky.project.id,entry:{id:'t-9',prompt:'Light the pier',reply:'Lanterns lit.',outcome:'completed'}});
  await call({action:'fire',projectId:risky.project.id});
  const fired=(await call({action:'get',projectId:risky.project.id})).project;
  const file=continuationFile(fired);
  assert.match(file.name,/^FeatherScript-continuation-[a-zA-Z0-9_.\-]+\.json$/,'a file name stays one flat file');
  assert.ok(!file.name.includes('..'),'a project title cannot climb out of the folder the user picked');
  assert.equal(file.checkpoints,1);
  assert.equal(file.text,JSON.stringify(handoffDocument(fired),null,2),'the saved file is the injected continuation document');
  assert.equal(JSON.parse(file.text).project.entries[0].prompt,'Light the pier','the fired checkpoint is inside the file');
  const loaded=await call({action:'import',data:JSON.parse(file.text)});
  assert.equal(continuation(loaded.project).includes('Light the pier'),true,'the file loads back as continuation context');
  assert.equal(continuationFile((await call({action:'get',projectId:second.project.id})).project).checkpoints,0,'an unfired project reports no checkpoints instead of writing an empty handoff');
  assert.equal(file.name,'FeatherScript-continuation-evilVillage.json','a hostile title becomes one flat file name');
  console.log('PASS projects: concurrent persistence, immutable outcomes, continuation context, reload bindings, chat navigation, workspace isolation, fresh projects, fired handoff files and bounds');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
