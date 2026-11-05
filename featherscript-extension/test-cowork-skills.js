const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const T=require('./core/task-policy'),{Queue}=require('./core/cowork'),C=require('./core/commands');
(async()=>{
 const library=[{folder:'world',name:'World building',description:'Map village roads buildings terrain environment assets'},{folder:'ui',name:'UI',description:'HUD menu interface'},{folder:'assets',name:'Assets',description:'Village decoration world buildings roads'},{folder:'roblox-vfx-mastery',name:'VFX mastery',description:'Particles beams auras timing cleanup'}];
 assert.ok(T.selectSkills('Build a detailed village',library).length<=T.MAX_PREFETCH_SKILLS);
 assert.equal(T.selectSkills('Create a detailed particle aura',library)[0].folder,'roblox-vfx-mastery');
 assert.equal(T.selectSkills('Build a village',library).some(skill=>skill.folder==='ui'),false);
 const task=T.createTask({text:'Build a village',now:100,id:'task'});for(const field of ['mode','config','thinking'])assert.equal(field in task,false);
 assert.ok(T.policy().includes('Never invent tool results'));assert.equal(T.allowsTool('agent','feather_capture','roblox'),false);
 let release,calls=0;const persisted=[];
 const queue=new Queue({save:async state=>persisted.push(state),run:async job=>{calls++;assert.equal('mode' in job,false);await new Promise(resolve=>release=resolve);return {outcome:'completed'};}});
 queue.restore('chat',{});queue.setEnabled(true);queue.add('Create a blue Part.');queue.resume();const first=queue.pump();await new Promise(resolve=>setImmediate(resolve));await queue.pump();assert.equal(calls,1);release();await first;assert.equal(queue.jobs[0].status,'completed');assert.ok(persisted.some(value=>value.jobs[0]?.status==='running'));
 const old=new Queue({run:async()=>{throw Error('must not replay');}});old.restore('chat',{enabled:true,jobs:[{id:'old',text:'Preserve this task',status:'running',mode:'ultra',effortMode:'flash'}]});assert.equal(old.paused,true);assert.equal(old.jobs[0].status,'interrupted');assert.equal(old.jobs[0].text,'Preserve this task');assert.equal('mode' in old.jobs[0],false);assert.equal('effortMode' in old.jobs[0],false);
 const next=new Queue({run:async()=>({outcome:'failed'})});next.restore('b');next.setEnabled(true);next.add('one');next.add('two');next.resume();await next.pump();assert.equal(next.paused,true);assert.equal(next.jobs[1].status,'queued');
 const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'core/parser.js'),'utf8')+';globalThis.parser=ZSParse;',context);
 for(const ending of ['### END MCP TOOL ###','### END -- MCP _ TOOL ###']){const text='###MCP_TOOL###{"command":"list_commands","params":{}}'+ending;assert.equal(context.parser.parseToolCalls(text)[0].tool,'list_commands');assert.equal(context.parser.hasOpenToolBlock(text),false);}
 const id=await C.idFor({provider:'test',conversation:'a',turn:'1',tool:'write',args:{b:2,a:1}});assert.equal(id,await C.idFor({provider:'test',conversation:'a',turn:'1',tool:'write',args:{a:1,b:2}}));
 const site={};assert.equal(C.classifySiteError('Composer missing',{comparison:true},site,1),null);assert.equal(C.classifySiteError('Composer missing',{},site,100),null);assert.equal(C.classifySiteError('Composer missing',{},site,3100).kind,'site_error');
 C.configure({'execute_luau':9999999});assert.equal(C.timeoutFor('server/execute_luau'),900000);C.configure({});
 const lifecycle={state:'queued'};C.transition(lifecycle,'completed');assert.equal(C.transition(lifecycle,'acknowledged'),false);
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'),'utf8'));for(const entry of manifest.content_scripts){assert.ok(!(entry.js||[]).includes('core/effort.js'));if((entry.js||[]).includes('core/workflow.js'))assert.ok(entry.js.includes('core/task-policy.js'));}
 assert.equal(fs.existsSync(path.join(__dirname,'core/effort.js')),false);
 console.log('PASS relevant skills, VFX priority, single task pipeline, queue migration/persistence/failure, parser and command safety');
})().catch(error=>{console.error(error);process.exitCode=1;});
