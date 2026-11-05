// DeepSeek composer scoping: `.ds-button--primary` is a design-system class used
// by the sidebar and modals too, so the old global first-match lookup read and
// clicked the WRONG button - "is it still generating?" answered off a sidebar
// icon and a send could fire "New chat". Also covers the fixed-position toast
// that offsetParent-based visibility skipped.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function matchesSimple(el, sel) {
  const parts = sel.match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/);
  if (!parts) return false;
  if (parts[1] && el.tagName !== parts[1].toUpperCase()) return false;
  const rest = (parts[2] || '').match(/[.#][\w-]+|\[[^\]]+\]/g) || [];
  for (const token of rest) {
    if (token[0] === '.' && !el._classes.has(token.slice(1))) return false;
    if (token[0] === '#' && el.id !== token.slice(1)) return false;
    if (token[0] === '[') {
      const m = token.slice(1, -1).match(/^([\w-]+)([*^$]?=)?(?:("([^"]*)"|'([^']*)'))?$/);
      if (!m) return false;
      const value = el.getAttribute(m[1]);
      if (value === null) return false;
      if (m[2]) {
        const want = m[4] !== undefined ? m[4] : m[5];
        if (m[2] === '*=' ? !value.includes(want) : m[2] === '^=' ? !value.startsWith(want) : value !== want) return false;
      }
    }
  }
  return true;
}

class El {
  constructor(tag, opts = {}) {
    this.tagName = tag.toUpperCase();
    this.id = opts.id || '';
    this._classes = new Set(opts.classes || []);
    this.classList = {
      contains: c => this._classes.has(c),
      add: c => this._classes.add(c),
      remove: c => this._classes.delete(c),
      toggle: c => (this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c)),
    };
    this.attrs = new Map(Object.entries(opts.attrs || {}));
    this.children = [];
    this.parentElement = null;
    this._text = opts.text || '';
    this.value = opts.value || '';
    this.clicks = 0;
    this.disabled = !!opts.disabled;
    this._rects = opts.rects === undefined ? 1 : opts.rects;
    // Chrome reports offsetParent === null for position:fixed elements.
    this.offsetParent = opts.fixed ? null : {};
  }
  get className() { return [...this._classes].join(' '); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  get innerText() { return this.textContent; }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } return this; }
  getClientRects() { return new Array(this._rects).fill({}); }
  matches(sel) { return sel.split(',').some(s => matchesSimple(this, s.trim())); }
  closest(sel) { for (let n = this; n; n = n.parentElement) if (n.matches && n.matches(sel)) return n; return null; }
  contains(other) { for (let n = other; n; n = n.parentElement) if (n === this) return true; return false; }
  descendants() {
    const out = [];
    const walk = n => { for (const c of n.children) { out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  _all(sel) {
    const out = [];
    for (const step of sel.split(',').map(s => s.trim()).filter(Boolean)) {
      let current = [this];
      for (const compound of step.split(/\s+/)) {
        const next = [];
        for (const node of current) for (const el of node.descendants()) if (matchesSimple(el, compound) && !next.includes(el)) next.push(el);
        current = next;
      }
      for (const el of current) if (!out.includes(el)) out.push(el);
    }
    return out;
  }
  querySelectorAll(sel) { return this._all(sel); }
  querySelector(sel) { return this._all(sel)[0] || null; }
  focus() {}
  dispatchEvent() { return true; }
  click() { this.clicks++; if (this.onsend) this.onsend(); }
}

function icon(kind) {
  const svg = new El('svg');
  svg.append(kind === 'rect' ? new El('rect') : new El('path', { attrs: { d: kind === 'send' ? 'M8.3125 0.981587C8.66 1.11 8.9 1.46 8.9 1.84V11.5' : 'M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z' } }));
  return svg;
}

function build({ streaming = false } = {}) {
  const body = new El('div');

  const sidebar = new El('div', { classes: ['sidebar'] });
  const newChat = new El('button', { classes: ['ds-button', 'ds-button--primary'], attrs: { 'aria-label': 'New chat' } });
  newChat.append(icon('rect')); // a square icon, i.e. isStopBtn() reads it as STOP
  sidebar.append(newChat);

  const main = new El('div', { classes: ['main'] });
  const editArea = new El('div', { classes: ['ds-message', 'd29f3d7d'] });
  const editWrap = new El('div', { classes: ['ds-textarea', 'ds-textarea--bordered'] });
  const editBox = new El('textarea', { value: 'an older turn being edited' });
  editWrap.append(editBox);
  editArea.append(editWrap);
  const assistant = new El('div', { classes: ['ds-message'] });
  assistant.append(new El('div', { classes: ['ds-markdown'], text: 'Working on it.' }));
  const composer = new El('div', { classes: ['composer'] });
  const ta = new El('textarea', { value: '' });
  const send = new El('button', { classes: ['ds-button', 'ds-button--primary'], attrs: { 'aria-label': 'Send' } });
  send.append(icon(streaming ? 'stop' : 'send'));
  send.onsend = () => { ta.value = ''; };
  composer.append(ta, send);
  main.append(editArea, assistant, composer);

  const toast = new El('div', { attrs: { role: 'alert' }, text: 'Too many requests. Please try again later.', fixed: true });
  body.append(sidebar, main, toast);

  const document = {
    body,
    documentElement: new El('div'),
    querySelector: sel => body.querySelector(sel),
    querySelectorAll: sel => body.querySelectorAll(sel),
    addEventListener() {},
  };
  const provider = vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'providers/deepseek.js'), 'utf8') + ';ZSProvider;',
    {
      document, console, Date, RegExp, Error, String, Math, JSON, Number, Array, Object, Set, Map,
      setTimeout, clearTimeout, location: { pathname: '/a/chat/s/abc123' },
      window: {}, Event: class { constructor(t) { this.type = t; } },
    },
  );
  return { provider, ta, send, newChat, toast, body };
}

(async () => {
  const idle = build();
  assert.equal(idle.provider.getEditor(), idle.ta, 'the composer wins over an inline edit box mounted in the turn list');
  assert.equal(idle.provider.isHardGenerating(), false, 'a sidebar square icon is not the stop control');

  await idle.provider.typeAndSend('{"command":"list_roblox_studios","params":{}}');
  assert.equal(idle.send.clicks, 1, 'send clicks the composer control');
  assert.equal(idle.newChat.clicks, 0, 'send never clicks the sidebar primary button');
  assert.equal(idle.ta.value, '', 'the composer cleared, i.e. the message left');

  assert.match(idle.provider.scanError() || '', /Too many requests/, 'a position:fixed rate-limit toast is detected');

  const live = build({ streaming: true });
  assert.equal(live.provider.isHardGenerating(), true, 'the composer stop square is the real generating signal');
  await live.provider.typeAndSend('{"command":"list_roblox_studios","params":{}}');
  assert.equal(live.send.clicks, 0, 'nothing is clicked while the turn is streaming');
  assert.equal(live.newChat.clicks, 0, 'and never the sidebar button');
  live.provider.stopGeneration();
  assert.equal(live.send.clicks, 1, 'Stop clicks the composer control');
  assert.equal(live.newChat.clicks, 0, 'Stop never clicks the sidebar control');

  console.log('PASS DeepSeek composer-scoped send/stop, inline-edit-box and fixed-toast handling');
})().catch(error => { console.error(error); process.exitCode = 1; });
