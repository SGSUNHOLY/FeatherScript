// DeepSeek pacing must be configurable and must never send through a provider
// block or after the user stops an automated run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const workflowSource = fs.readFileSync(path.join(__dirname, 'core/workflow.js'), 'utf8');
const workflow = vm.runInNewContext(workflowSource + ';ZSWorkflow;', {ZSTasks: {}});
assert.equal(workflow.deepseekPaceMode(undefined), 'natural');
assert.equal(workflow.deepseekPaceMode(undefined, true), 'natural');
assert.equal(workflow.deepseekPaceMode(undefined, false), 'off');
assert.equal(workflow.deepseekPaceMode('quick', true), 'quick');
assert.equal(workflow.deepseekPaceMode('unknown', false), 'off');
assert.equal(workflow.DEEPSEEK_PACES.natural.gapMs, 8000);

const source = fs.readFileSync(path.join(__dirname, 'core/main.js'), 'utf8');
const start = source.indexOf('  // DeepSeek-only automated send cadence.');
const end = source.indexOf('  // ── Diagnostics', start);
assert.ok(start > 0 && end > start, 'automated send pacing helper exists');

function harness({mode='natural',provider='deepseek',blockAt=Infinity,stopAt=Infinity}={}) {
  let now=100000, checks=0;
  const A={stop:false};
  const context=vm.createContext({
    P:{id:provider},
    workflow:{deepseekPace:workflow.DEEPSEEK_PACES[mode]},
    A, Date:{now:()=>now}, Math, Error,
    sleep:async ms=>{assert.ok(ms>0 && ms<=250, 'wait remains responsive');now+=ms;if(now>=stopAt)A.stop=true;},
  });
  vm.runInContext(source.slice(start,end)+';globalThis.pace=paceBeforeDeepseekSend;',context);
  const checkProvider=()=>{checks++;if(now>=blockAt)throw Error('DeepSeek usage limit');};
  return {send:()=>context.pace(checkProvider),advance:ms=>{now+=ms;},get now(){return now;},get checks(){return checks;},A};
}

(async()=>{
  const natural=harness();
  await natural.send();
  assert.equal(natural.now,101400,'brief pause before the first send');
  await natural.send();
  assert.equal(natural.now,109400,'minimum gap for subsequent sends');
  natural.advance(20000);
  await natural.send();
  assert.equal(natural.now,130800,'long model work only adds the brief pause');

  const quick=harness({mode:'quick'});
  await quick.send();assert.equal(quick.now,100700);
  await quick.send();assert.equal(quick.now,104700);

  const careful=harness({mode:'careful'});
  await careful.send();assert.equal(careful.now,102500);
  await careful.send();assert.equal(careful.now,116500);

  const off=harness({mode:'off'});await off.send();assert.equal(off.now,100000);
  const other=harness({provider:'chatgpt'});await other.send();assert.equal(other.now,100000);

  const blocked=harness({blockAt:100500});
  await assert.rejects(blocked.send(),/usage limit/);
  assert.ok(blocked.now<101400,'a provider block interrupts the wait');
  const stopped=harness({stopAt:100600});
  await assert.rejects(stopped.send(),/Stopped before DeepSeek send/);
  assert.ok(stopped.now<101400,'Stop interrupts the wait');

  console.log('PASS DeepSeek pace presets, migration, send gaps, provider blocks and Stop');
})().catch(error=>{console.error(error);process.exitCode=1;});
