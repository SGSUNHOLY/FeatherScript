const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.listeners={};this.hidden=false;this.value='';}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(key,value){this[key]=value;}
  addEventListener(event,listener){this.listeners[event]=listener;}
  dispatch(event){this.listeners[event]?.({preventDefault(){},target:this});}
  focus(){}
  getBoundingClientRect(){return {top:400};}
  querySelectorAll(selector){
    const camelize=name=>name.replace(/-([a-z])/g,(m,c)=>c.toUpperCase());
    const tests=selector.split(',').map(s=>s.trim());
    const matching=node=>tests.some(s=>s.startsWith('#')?node.id===s.slice(1):
      s.startsWith('.')?String(node.className||'').split(/\s+/).includes(s.slice(1)):
      s.startsWith('[data-')&&s.endsWith(']')?Object.hasOwn(node.dataset,camelize(s.slice(6,-1))):
      node.tagName.toLowerCase()===s);
    const output=[];
    const walk=node=>{for(const child of node.children){if(matching(child))output.push(child);walk(child);}};
    walk(this);return output;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
const root=()=>{const node=new Element('div'),utilities=new Element('div');utilities.id='zs-utilities';node.append(utilities);return node;};
// The chooser lists the previous chat, then its own row of buttons, so the
// Continue control is found by its marker rather than by a child index.
const pressContinue=holder=>{
  const stack=[holder.querySelector('[data-project-list]')];
  while(stack.length){
    const node=stack.pop();
    if(node.dataset.continue!==undefined){node.dispatch('click');return true;}
    stack.push(...node.children);
  }
  return false;
};
const scope=vm.createContext({
  document:{createElement:tag=>new Element(tag)},window:{addEventListener(){}},innerHeight:900,
  ZSProjects:{continuation:project=>'CONTINUE '+project.title},
});
vm.runInContext(fs.readFileSync(path.join(__dirname,'core/projects-ui.js'),'utf8'),scope);
const project={id:'saved-1',title:'Village',entries:[],handoff:{status:'ready'}};

(async()=>{
  let route='',empty=true,releaseGet,holdGet=true;
  const attached=[];
  const ui=scope.ZSProjectUI.create({
    P:{id:'notion',conversationKey:()=>route,chatIsEmpty:()=>empty},
    bg:async message=>{
      if(message.action==='list')return {ok:true,projects:[project]};
      if(message.action==='get'){
        if(holdGet)return new Promise(resolve=>{releaseGet=()=>{holdGet=false;resolve({ok:true,project});};});
        return {ok:true,project};
      }
      if(message.action==='attach'){attached.push(message);return {ok:true};}
      throw Error(message.action);
    },onStart(){}
  });
  const holder=root();ui.mount(holder);ui.sync({profile:'roblox',fresh:true});
  assert.equal(holder.querySelector('#zs-project-choice').hidden,false,
    'the new-chat chooser opens even if no composer has mounted yet');
  const choice=ui.ensureChoice('roblox');await tick();
  assert.ok(pressContinue(holder),'the chooser offers a Continue button');await tick();
  // The site assigns a real URL while the desktop request is outstanding.
  route='thread-created';ui.sync({profile:'roblox',fresh:true});
  releaseGet();assert.equal(await choice,true,'blank-to-stable chat key must preserve Continue selection');
  assert.equal(await ui.startup(),'CONTINUE Village');
  empty=false;ui.sync({started:true,profile:'roblox'});await tick();
  assert.equal(attached[0].chat,'notion|thread-created');

  // A different nonempty conversation key must invalidate the old selection.
  route='thread-old';empty=true;holdGet=true;releaseGet=null;
  const another=scope.ZSProjectUI.create({P:{id:'notion',conversationKey:()=>route,chatIsEmpty:()=>empty},
    bg:async message=>message.action==='list'?{ok:true,projects:[project]}:
      message.action==='get'?new Promise(resolve=>{releaseGet=()=>resolve({ok:true,project});}):{ok:true},onStart(){}});
  const newRoot=root();another.mount(newRoot);another.sync({profile:'roblox',fresh:true});
  const abandoned=another.ensureChoice('roblox');await tick();
  const panel=newRoot.querySelector('#zs-project-choice');
  another.sync({profile:'roblox',fresh:false});
  assert.equal(panel.hidden,false,'temporary composer unmount must preserve the chooser');
  assert.ok(pressContinue(newRoot));await tick();
  route='thread-other';another.sync({profile:'roblox',fresh:true});
  releaseGet();assert.equal(await abandoned,false,'navigation discards a pending choice');

  // Genspark starts with a nonempty provisional ID; the URL gets a stable ID
  // while the user's Continue selection is waiting for the desktop broker.
  let sparkRoute='genspark-temporary',sparkEmpty=true,sparkRelease;
  const sparkAttached=[];
  const spark=scope.ZSProjectUI.create({
    P:{id:'genspark',conversationKey:()=>sparkRoute,chatIsEmpty:()=>sparkEmpty},
    bg:async message=>{
      if(message.action==='list')return {ok:true,projects:[project]};
      if(message.action==='get')return new Promise(resolve=>{sparkRelease=()=>resolve({ok:true,project});});
      if(message.action==='attach'){sparkAttached.push(message);return {ok:true};}
      throw Error(message.action);
    },onStart(){}
  });
  const sparkRoot=root();spark.mount(sparkRoot);spark.sync({profile:'roblox',fresh:true});
  const sparkChoice=spark.ensureChoice('roblox');await tick();
  assert.ok(pressContinue(sparkRoot));await tick();
  sparkRoute='genspark:abc123';spark.sync({profile:'roblox',fresh:true});
  sparkRelease();assert.equal(await sparkChoice,true,
    'Genspark provisional-to-stable URL must preserve a pending Continue choice');
  sparkEmpty=false;spark.sync({started:true,profile:'roblox'});await tick();
  assert.equal(sparkAttached[0].chat,'genspark|genspark:abc123');

  // In a real bootstrap the user turn can appear BEFORE Genspark assigns the
  // URL. The acknowledged startup send must keep the selected project bound.
  let sentRoute='genspark-temporary',sentEmpty=true;
  const sentAttached=[];
  const sentSpark=scope.ZSProjectUI.create({
    P:{id:'genspark',conversationKey:()=>sentRoute,chatIsEmpty:()=>sentEmpty},
    bg:async message=>message.action==='list'?{ok:true,projects:[project]}:
      message.action==='get'?{ok:true,project}:
      message.action==='attach'?(sentAttached.push(message),{ok:true}):{ok:true},onStart(){}
  });
  const sentRoot=root();sentSpark.mount(sentRoot);sentSpark.sync({profile:'roblox',fresh:true});
  const sentChoice=sentSpark.ensureChoice('roblox');await tick();
  assert.ok(pressContinue(sentRoot));
  assert.equal(await sentChoice,true);
  sentSpark.markStartupSent();
  sentRoute='genspark:after-first-message';sentEmpty=false;
  sentSpark.sync({started:true,profile:'roblox'});await tick();
  assert.equal(sentAttached[0].chat,'genspark|genspark:after-first-message',
    'an acknowledged first prompt must retain project memory through URL assignment');

  let otherRoute='genspark-temporary',otherEmpty=true,otherRelease;
  const otherSpark=scope.ZSProjectUI.create({
    P:{id:'genspark',conversationKey:()=>otherRoute,chatIsEmpty:()=>otherEmpty},
    bg:async message=>message.action==='list'?{ok:true,projects:[project]}:
      message.action==='get'?new Promise(resolve=>{otherRelease=()=>resolve({ok:true,project});}):{ok:true},onStart(){}
  });
  const otherRoot=root();otherSpark.mount(otherRoot);otherSpark.sync({profile:'roblox',fresh:true});
  const otherChoice=otherSpark.ensureChoice('roblox');await tick();
  assert.ok(pressContinue(otherRoot));await tick();
  otherRoute='genspark:another-chat';otherEmpty=false;otherSpark.sync({profile:'roblox',fresh:true});
  otherRelease();assert.equal(await otherChoice,false,
    'moving to a populated Genspark chat must discard a stale selection');

  const none=scope.ZSProjectUI.create({P:{id:'notion',conversationKey:()=>'',chatIsEmpty:()=>true},
    bg:async()=>({ok:true,projects:[]}),onStart(){}});
  const emptyRoot=root();none.mount(emptyRoot);none.sync({profile:'roblox',fresh:true});await tick();
  assert.equal(emptyRoot.querySelector('[data-project-list]').children.length,0,
    'an empty project store must not offer a fake Continue option');
  // A task may start before the chat acquires a URL ID, and the URL may arrive
  // while the desktop project-service request is still resolving.
  let pendingRoute='',pendingEmpty=false,releaseMemory;
  const pendingAttachments=[];
  const pendingUI=scope.ZSProjectUI.create({
    P:{id:'notion',displayName:'Notion',conversationKey:()=>pendingRoute,
      chatIsEmpty:()=>pendingEmpty,allItems:()=>[{text:'Build a village fountain'}],
      isUserItem:()=>true,itemText:item=>item.text},
    bg:async message=>{
      if(message.action==='resolve')return new Promise(resolve=>{releaseMemory=()=>resolve({ok:true,project});});
      if(message.action==='attach'){pendingAttachments.push(message);return {ok:true};}
      if(message.action==='find')return {ok:true,project:null};
      return {ok:true,projects:[]};
    },onStart(){}
  });
  pendingUI.mount(root());
  const memory=pendingUI.capture('','roblox','Build a village fountain');await tick();
  pendingRoute='chat:new-id';pendingUI.sync({profile:'roblox'});
  releaseMemory();assert.equal((await memory).id,project.id);await tick();
  assert.equal(pendingAttachments.length,1,'keyless capture binds automatically after the first URL assignment');
  assert.equal(pendingAttachments[0].chat,'notion|chat:new-id');

  // A different populated chat cannot inherit the first task's memory.
  let unrelatedRoute='',unrelatedPrompt='Build a shop',releaseUnrelated;
  const unrelatedAttachments=[];
  const unrelated=scope.ZSProjectUI.create({
    P:{id:'notion',conversationKey:()=>unrelatedRoute,chatIsEmpty:()=>false,
      allItems:()=>[{text:unrelatedPrompt}],isUserItem:()=>true,itemText:item=>item.text},
    bg:async message=>message.action==='resolve'?new Promise(resolve=>{releaseUnrelated=()=>resolve({ok:true,project});}):
      message.action==='attach'?(unrelatedAttachments.push(message),{ok:true}):{ok:true,project:null},onStart(){}
  });
  unrelated.mount(root());const unrelatedMemory=unrelated.capture('','roblox','Build a village fountain');await tick();
  unrelatedRoute='chat:someone-else';unrelated.sync({profile:'roblox'});
  releaseUnrelated();await unrelatedMemory;await tick();
  assert.equal(unrelatedAttachments.length,0,'memory cannot be attached to a different chat transcript');

  // THE handoff itself, against the real projects module. A continuation that
  // throws inside startup() sends no handoff at all - the bootstrap swallows it
  // and the chat just says "ready", which is exactly what "press Continue and
  // nothing arrives" looked like.
  const saved={id:'real-1',title:'Village fountain',profile:'roblox',updatedAt:Date.now(),
    origin:{kind:'roblox',key:'place-7',name:'Village'},handoff:null,
    entries:[{id:'t1',prompt:'Build the fountain basin',reply:'Basin placed in Workspace.',provider:'notion',outcome:'completed',at:Date.now()-1000}]};
  const realScope=vm.createContext({document:{createElement:tag=>new Element(tag)},window:{addEventListener(){}},
    innerHeight:900,ZSProjects:require('./core/projects')});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'core/projects-ui.js'),'utf8'),realScope);
  const real=realScope.ZSProjectUI.create({
    P:{id:'notion',conversationKey:()=>'',chatIsEmpty:()=>true},
    bg:async message=>({ok:true,projects:[saved],project:saved}),onStart(){}});
  const realRoot=root();real.mount(realRoot);real.sync({profile:'roblox',fresh:true});await tick();
  assert.ok(pressContinue(realRoot),'a saved project with checkpoints offers Continue');
  await tick();
  const handoff=await real.startup();
  assert.ok(handoff.includes('FEATHERSCRIPT PROJECT CONTINUATION'),'Continue injects a handoff, not a greeting');
  assert.ok(handoff.includes('Build the fountain basin'),'the handoff carries the saved checkpoint');
  assert.ok(/"format":"featherscript-handoff"/.test(handoff),'the handoff is the same JSON document the file export writes');
  assert.equal(real.currentProject(),'Village fountain','the finished bootstrap chip can name the project it continued');
  console.log('PASS project chooser: Genspark URL migration after first send, navigation isolation, composer remount, no phantom handoff and a real Continue handoff');
})().catch(error=>{console.error(error);process.exitCode=1;});
