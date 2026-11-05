const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'core/workflow.js'),'utf8');
const context=vm.createContext({ZSTasks:{},setTimeout,clearTimeout});
vm.runInContext(source,context);
const create=context.ZSWorkflow.createOutbox;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const saved={};
const storage={
  async get(){return {...saved};},
  async set(values){Object.assign(saved,values);},
  async remove(key){delete saved[key];},
};
let clock=100,connected=false,failures=0,recoveries=0;
const timers=new Map();let timerId=0;
const settings={storage,now:()=>clock,
  later:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},
  clear:id=>timers.delete(id),
  onError:()=>{failures++;},onRecovered:()=>{recoveries++;},
};
const project={id:'p-1',profile:'roblox'};
const record=(outcome)=>({project,id:'task-1',prompt:'Build a shop',reply:outcome==='completed'?'Shop built':'',outcome});

(async()=>{
  const received=[];
  const first=create({...settings,send:async value=>{
    received.push(value.outcome);
    if(!connected)throw Error('Bridge offline');
  }});
  await first.enqueue(record('running'));
  await first.flush();
  assert.equal(failures,1);
  assert.equal(first.pending(),1);
  assert.equal(Object.keys(saved).length,1,'failed forwarding retains a local checkpoint');

  // A new page reconstructs the pending checkpoint from extension storage.
  connected=true;
  const reopened=create({...settings,send:async value=>received.push('recovered:'+value.outcome)});
  await reopened.flush();
  assert.ok(received.includes('recovered:running'));
  assert.equal(Object.keys(saved).length,0,'replayed checkpoint is removed only after broker ack');
  assert.equal(reopened.pending(),0);

  // Replacing an in-flight running checkpoint must preserve the final outcome.
  let resolveRunning;
  const deferred=new Promise(resolve=>{resolveRunning=resolve;});
  const updates=[];
  const outbox=create({...settings,send:async value=>{
    updates.push(value.outcome);
    if(value.outcome==='running')await deferred;
  }});
  await outbox.enqueue(record('running'));
  const flushing=outbox.flush();
  await tick();
  await outbox.enqueue(record('completed'));
  resolveRunning();
  await flushing;
  assert.deepEqual(updates,['running','completed']);
  assert.equal(outbox.pending(),0);
  assert.equal(Object.keys(saved).length,0);
  assert.ok(recoveries>=2);
  console.log('PASS durable project checkpoints: offline retry, reload recovery, in-flight outcome replacement and acknowledged deletion');
})().catch(error=>{console.error(error);process.exitCode=1;});
