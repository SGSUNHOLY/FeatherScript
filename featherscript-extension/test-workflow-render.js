// Regression: render() runs inside the agent loop and used to throw
// "Cannot set properties of null (setting 'title')" when the chat page
// re-rendered the bar and dropped #zs-script-profile. Panel chrome must never
// abort a task.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function el(tag = 'div') {
  const node = {
    tagName: tag.toUpperCase(), id: '', className: '', children: [],
    dataset: {}, style: {}, hidden: false, checked: false, value: '',
    classList: { toggle() {}, add() {}, remove() {} },
    textContent: '', title: '', _q: new Map(), _overrides: new Map(), listeners: new Map(),
    append(...n) { for(const child of n){child.parentElement=node;node.children.push(child);} },
    prepend(...n) { node.children.unshift(...n); },
    insertBefore(n) { node.append(n); return n; },
    appendChild(n) { node.children.push(n); return n; },
    replaceChildren(...n) { node.children = n.slice(); },
    addEventListener(name, fn) {
      if (!node.listeners.has(name)) node.listeners.set(name, []);
      node.listeners.get(name).push(fn);
    },
    querySelector(sel) {
      if (node._overrides.has(sel)) return node._overrides.get(sel);
      if(sel==='select')return null;
      if(sel==='#zs-workflow-panel')return node.children.find(child=>child.id==='zs-workflow-panel')||null;
      if (!node._q.has(sel)) node._q.set(sel, el('span'));
      return node._q.get(sel);
    },
    querySelectorAll(sel) { const all=[];for(const child of node.children){if(sel==='#zs-script-profile'&&child.id==='zs-script-profile'||sel==='[data-script-mode]'&&child.dataset.scriptMode||sel==='[data-deepseek-mode]'&&child.dataset.deepseekMode)all.push(child);all.push(...child.querySelectorAll(sel));}return all; },
    remove() { if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node); },
    getBoundingClientRect() { return { top: 10, left: 0, right: 100, bottom: 34, width: 90, height: 24 }; },
    closest() { return null; }, contains() { return true; }, focus() {}, click() {},
    setAttribute(k, v) { node[k] = v; }, getAttribute() { return null; },
    removeAttribute() {},
    set innerHTML(v) { node._html = v; if(typeof v==='string'&&v.includes('data-deepseek-mode="natural"'))for(const mode of ['off','quick','natural','careful']){const b=el('button');b.dataset.deepseekMode=mode;node.append(b);} }, get innerHTML() { return node._html || ''; },
  };
  return node;
}

function boot() {
  const created = [], warnings = [], saved = [];
  const root = el('div');
  const top = el('div');
  const bar = el('div');
  root.append(top,bar);
  root._overrides.set('#zs-script-profile', null); // stripped by a host re-render
  root._overrides.set('.zs-top', top);
  root._overrides.set('#zs-bar', bar);

  const context = {
    console: { log() {}, warn: (...a) => warnings.push(a.join(' ')), error() {} },
    document: { createElement: tag => { const n = el(tag); created.push(n); return n; }, addEventListener() {}, querySelector: () => null },
    chrome: { storage: { local: { get: () => Promise.resolve({}), set: value => {saved.push(value);return Promise.resolve();} }, onChanged: { addListener() {} } } },
    navigator: {},
    window: { addEventListener() {}, innerHeight: 800, innerWidth: 1200 },
    innerHeight: 800, innerWidth: 1200,
    performance: { now: () => 0 },
    setTimeout, clearTimeout, queueMicrotask,
  };
  const workflow = vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'core/workflow.js'), 'utf8') + ';ZSWorkflow;',
    {
      ...context,
      ZSTasks: {
        scriptMode: value => (value === 'agent' ? 'agent' : 'roblox'),
        scriptPolicy: () => '', policy: () => '', taskGuidance: () => '', finish: () => ({}),
        allowsTool: () => true, skillsForProfile: list => list,
      },
      ZSCowork: { Queue: class { constructor() { this.jobs = []; this.enabled = false; this.paused = false; } pause() {} restore() {} pump() {} remove() {} move() {} setEnabled() {} } },
    },
  );
  const instance = workflow.create({
    P: {
      id: 'deepseek', conversationKey: () => '', editorText: () => '',
      allItems: () => [], isUserItem: () => false, itemText: () => '',
      lastAssistant: () => null, isUserItem: () => false,
    },
    bg: {}, getSkills: () => [], canRun: () => true,
    submit: () => Promise.resolve(''), runLoop: () => Promise.resolve(),
  });
  return { workflow: instance, root, warnings, created, saved };
}

(async () => {
  const first = boot();
  first.workflow.mount(first.root);
  await first.workflow.ready;
  assert.doesNotThrow(() => first.workflow.render());
  const profiles = first.created.filter(node => node.id === 'zs-script-profile');
  assert.ok(profiles.length > 0, 'a missing profile control is re-created');
  assert.ok(profiles.at(-1).title, 're-created profile gets its title tooltip');
  const buttons=profiles.at(-1).querySelectorAll('[data-script-mode]');
  assert.equal(buttons.length,2,'exactly one button per script mode');
  assert.equal(profiles.at(-1).querySelector('select'),null,'no dropdown remains');
  assert.equal(buttons[0]['aria-pressed'],'true');
  assert.equal(buttons[0]['aria-label'],'RobloxScript (active)');
  assert.equal(buttons[0].children.at(-1).textContent,'ACTIVE');
  await buttons[1].listeners.get('click')[0]();
  assert.equal(first.root.dataset.scriptProfile,'agent');
  assert.equal(buttons[1]['aria-pressed'],'true');
  assert.equal(buttons[1]['aria-label'],'AgentScript (active)');
  assert.equal(buttons[0]['aria-label'],'RobloxScript');
  await buttons[0].listeners.get('click')[0]();
  const pacing=first.created.find(node=>node.id==='zs-workflow-panel').querySelectorAll('[data-deepseek-mode]');
  assert.equal(pacing.length,4,'DeepSeek gets four visible pace choices');
  assert.equal(first.workflow.deepseekPace.mode,'natural','new installations use Natural pacing');
  assert.equal(pacing[2]['aria-pressed'],'true','Natural is visibly selected');
  await pacing[1].listeners.get('click')[0]();
  assert.equal(first.workflow.deepseekPace.mode,'quick');
  assert.equal(pacing[1]['aria-pressed'],'true','selection immediately updates');
  assert.ok(first.saved.some(value=>value.zsDeepseekPaceMode==='quick'),'selection persists');
  const duplicate=el();duplicate.id='zs-script-profile';duplicate.dataset.profileVersion='2';first.root.querySelector('.zs-top').append(duplicate);
  first.workflow.render();
  assert.equal(first.root.querySelectorAll('#zs-script-profile').length,1,'stale duplicates are removed');
  assert.deepEqual(first.warnings, []);
  assert.equal(first.root.dataset.scriptProfile, 'roblox');

  // Fully stripped bar: no profile, no panel anchoring, no status nodes.
  first.root._overrides.set('#zs-workflow-panel', null);
  first.root._overrides.set('.zs-top', null);
  first.root._overrides.set('#zs-skill-status', null);
  first.root._overrides.set('[data-cowork-caption]', null);
  first.root._overrides.set('#zs-bar', null);
  assert.doesNotThrow(() => first.workflow.render());
  assert.deepEqual(first.warnings, []);

  // Panel present but Chrome's bar is gone: positioning must not throw either.
  const second = boot();
  second.workflow.mount(second.root);
  await second.workflow.ready;
  second.root._overrides.set('#zs-bar', null);
  assert.doesNotThrow(() => second.workflow.render());
  assert.deepEqual(second.warnings, []);

  console.log('PASS workflow render survives stripped profile/panel/bar nodes');
})().catch(error => { console.error(error); process.exitCode = 1; });
