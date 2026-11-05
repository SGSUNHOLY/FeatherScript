const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const T=require('./core/task-policy');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'core/config.js'),'utf8')+';globalThis.config=ZS;',context);
const tools=[{name:'pc_read_file',server:'computer',description:'Read a bounded file',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}}];
const agent=context.config.buildSystemPrompt({profile:'agent',tools,skills:[{folder:'pc-files',name:'Local files'}],customPrompt:'Keep my custom preference.',providerNotes:'Keep the provider rule.'});
const roblox=context.config.buildSystemPrompt({tools,skills:[]});
assert.ok(agent.startsWith(context.config.SYS_MARKER));assert.ok(agent.includes('pc_read_file'));assert.ok(agent.includes('pc-files'));
assert.ok(agent.includes('Keep my custom preference.'));assert.ok(agent.includes('Keep the provider rule.'));
assert.ok(!agent.includes('execute_luau'));assert.ok(!agent.includes('PROJECT MEMORY'));assert.ok(agent.includes('denied request is not permission'));
assert.ok(agent.length<roblox.length*.6,`${agent.length} vs ${roblox.length}`);
const offline=context.config.buildSystemPrompt({profile:'agent'});assert.match(offline,/No PC tools are currently advertised/);
const source=fs.readFileSync(path.join(__dirname,'core/main.js'),'utf8');const from=source.indexOf('  function systemPrompt() {'),to=source.indexOf('  // ── Periodic system-prompt',from);assert.ok(from>0&&to>from);
const state={profile:'agent'};
const scope=vm.createContext({ZS:{buildSystemPrompt:options=>{scope.options=options;return 'fixture';}},A:{toolList:[...tools,{name:'execute_luau',server:'roblox'},{name:'feather_getskills',server:'roblox'}],skills:[{folder:'roblox-vfx',name:'VFX'},{folder:'pc-files',name:'Files',scope:'pc'}]},ZSTasks:T,P:{displayName:'Fixture'},ui:{getCustomPrompt:()=>''},workflow:{get scriptMode(){return state.profile;},policy:()=>T.policy()}});
vm.runInContext(source.slice(from,to)+';globalThis.prompt=systemPrompt;',scope);scope.prompt();assert.equal(scope.options.profile,'agent');assert.deepEqual(Array.from(scope.options.tools,t=>t.name),['pc_read_file']);assert.deepEqual(Array.from(scope.options.skills,s=>s.folder),['pc-files']);
state.profile='roblox';scope.prompt();assert.deepEqual(Array.from(scope.options.tools,t=>t.name),['execute_luau','feather_getskills']);
// ── project memory: feather_memory owns the format ─────────────────────────
// The prompt used to route memory through multi_edit, whose old_string must match
// the existing source character for character - the live place showed the result
// (three hand-pended "-- UPDATE:" notes in 3,441 characters and none of the
// section edits asked for). The tool was later dropped from the bridge while its
// tests stayed, so both halves are pinned here.
const memoryTools=[{name:'roblox/feather_memory'},{name:'execute_luau'}];
const withTool=context.config.buildSystemPrompt({tools:memoryTools,skills:[]});
assert.ok(withTool.includes('`feather_memory` is your long-term memory'),'the command is named, with its server prefix stripped');
assert.ok(withTool.includes('"action": "append"')&&withTool.includes('"action": "read"'),'read/append wording the parser can emit');
assert.ok(!withTool.includes('multi_edit auto-creates'),'no exact-match edit is ever asked for again');
const oldBridge=context.config.buildSystemPrompt({tools:[{name:'execute_luau'}],skills:[]});
assert.ok(!oldBridge.includes('feather_memory` is your'),'a bridge without the command is not told to call it');
assert.match(oldBridge,/execute_luau` with a one-line read/,'and the fallback reads the script directly');
assert.match(context.config.memoryNudge(memoryTools),/feather_memory \{"action": "append"/);
assert.match(context.config.memoryNudge([{name:'execute_luau'}]),/Do NOT route it through multi_edit/,'the nudge follows the same catalogue');
console.log(`PASS profile-specific command/skill scope, PC offline guidance, prompt protocol/custom rules, compact PC bootstrap and feather_memory guidance (${agent.length} vs ${roblox.length} characters)`);
