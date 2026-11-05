const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
(async()=>{
  let reduced=false,starts=0,skips=0,updates=0;
  const document={body:{dataset:{motion:'full'}},hidden:false,startViewTransition(update){
    starts++;
    const updateCallbackDone=Promise.resolve().then(update);
    return {ready:Promise.resolve(),updateCallbackDone,finished:updateCallbackDone,skipTransition(){skips++;}};
  }};
  const context=vm.createContext({document,matchMedia:()=>({matches:reduced})});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'renderer/modules/layout-transition.js'),'utf8'),context);
  const transitions=context.FSRenderer.layoutTransition;
  await transitions.run(()=>updates++);assert.equal(starts,1);assert.equal(updates,1);
  const first=transitions.run(()=>updates++),second=transitions.run(()=>updates++);
  await Promise.all([first,second]);assert.ok(skips>0,'rapid switches cancel old snapshots');
  reduced=true;await transitions.run(()=>updates++);assert.equal(starts,3);
  reduced=false;document.body.dataset.motion='off';await transitions.run(()=>updates++);assert.equal(starts,3);
  document.body.dataset.motion='full';document.hidden=true;await transitions.run(()=>updates++);assert.equal(starts,3);
  document.hidden=false;document.startViewTransition=undefined;await transitions.run(()=>updates++);assert.equal(updates,7);
  console.log('PASS layout snapshots, rapid cancellation, reduced motion, Motion Off and unsupported/hidden fallbacks');
})().catch(error=>{console.error(error);process.exitCode=1;});
