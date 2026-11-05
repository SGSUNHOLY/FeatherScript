const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'core/main.js'),'utf8');
const start=source.indexOf('    function renderConn()'),end=source.indexOf('    // Thin wrappers',start);
const context=vm.createContext({connTxt:{textContent:''},connEl:{dataset:{}},statusFocus:'rs',connState:{connected:true,mcpOk:true,totalTools:84,broken:[]},A:{starting:true,started:false,toolList:[]},P:{displayName:'Notion AI'}});
vm.runInContext(source.slice(start,end)+';globalThis.render=renderConn;',context);
context.render();assert.match(context.connTxt.textContent,/checking agent/);assert.equal(context.connEl.dataset.tone,'warn');
context.A.starting=false;context.render();assert.match(context.connTxt.textContent,/Bridge online · 84 tools/);assert.ok(!/ready/i.test(context.connTxt.textContent));
// A dead addon must be visible in the same words the dot's tooltip uses, instead
// of the chip claiming everything is fine.
context.connState.broken=[{id:'blender'},{id:'computer'}];context.render();
assert.match(context.connTxt.textContent,/2 not working/,'a crashed server is named on the chip, not hidden behind a tool count');
context.connState.broken=[];context.statusFocus='as';context.render();assert.match(context.connTxt.textContent,/not started/);
context.A.started=true;context.render();assert.match(context.connTxt.textContent,/agent active/);
context.statusFocus='rs';context.connState.connected=false;context.render();assert.match(context.connTxt.textContent,/Offline/);
console.log('PASS bridge availability is separate from agent startup and never advertises false readiness');
