// Arena send readiness: a composer that cannot send must fail fast with the
// real cause (dialog / challenge / rate limit) instead of one blind 60s wait,
// and the send control is found even when Arena renders it as a role="button".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'providers/arena.js'), 'utf8');

class Textarea {
  constructor() { this._v = ''; this.disabled = false; this.offsetParent = {}; }
  get value() { return this._v; }
  set value(v) { this._v = String(v); }
  get isConnected() { return true; }
  getAttribute() { return null; }
  closest(selector) { return selector === 'form' ? this.form : null; }
  focus() {}
  dispatchEvent() { return true; }
}

function build({ send, dialog, notice, stop }) {
  const list = [];
  const state = { stop: stop || null };
  const textarea = new Textarea();
  const form = {
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  textarea.form = form;
  form.querySelectorAll = (selector) => {
    // While streaming, Arena swaps the send control for Stop - only one exists.
    if (selector === 'button, [role="button"]') return send && !state.stop ? [send] : [];
    return [];
  };
  if (send) {
    const click = send.click.bind(send);
    // Arena clears the composer the instant it accepts the message.
    send.click = () => { click(); textarea.value = ''; };
  }
  const document = {
    documentElement: { parentElement: null },
    querySelector: (selector) => selector === 'ol.flex-col-reverse' ? null : null,
    querySelectorAll: (selector) => {
      if (selector === 'form textarea') return [textarea];
      if (selector === 'button') {
        const buttons = [];
        if (send && send.tag === 'button') buttons.push(send);
        if (state.stop) buttons.push(state.stop);
        return buttons;
      }
      if (selector === '[role="dialog"]') return dialog ? [dialog] : [];
      if (selector.includes('role="alert"')) return notice ? [notice] : [];
      return [];
    },
  };
  const context = {
    document, location: { pathname: '/text/direct' }, console, Date, RegExp, Error, String, Math, JSON,
    setTimeout, clearTimeout, innerHeight: 900, innerWidth: 1400,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    window: { HTMLTextAreaElement: Textarea },
    HTMLTextAreaElement: Textarea,
    Event: class { constructor(type) { this.type = type; } },
    MutationObserver: class { observe() {} disconnect() {} },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    ZSDom: { first: () => null, visible: () => false },
  };
  const provider = vm.runInNewContext(source + ';ZSProvider;', context);
  return { provider, textarea, state, clicks: () => send.clicks };
}

function button(disabled, tag = 'button') {
  return {
    tag, disabled, offsetParent: {}, clicks: 0,
    getAttribute(name) { return name === 'aria-label' ? 'Send message' : null; },
    closest() { return null; },
    click() { this.clicks++; },
  };
}

(async () => {
  // 1. A blocking dialog is reported immediately, not after 60s.
  const dialog = { parentElement: null, closest: () => null, getBoundingClientRect: () => ({ width: 320, height: 220, top: 10, left: 10, right: 330, bottom: 230 }) };
  const blocked = build({ send: button(true), dialog });
  const started = Date.now();
  await assert.rejects(blocked.provider.typeAndSend('hello'), /dialog open over the chat/);
  assert.ok(Date.now() - started < 2000, 'must fail fast, not wait out the readiness window');
  try { await blocked.provider.typeAndSend('hello'); } catch (error) { assert.equal(error.zsNoRetry, true, 'marked so the core picks the send banner'); }

  // 2. A site notice explaining the refusal is quoted back to the user.
  const notice = { offsetParent: {}, innerText: 'Too many requests. Please try again later.', closest: () => null };
  const limited = build({ send: button(true), notice });
  await assert.rejects(limited.provider.typeAndSend('hello'), /refused the message: Too many requests/);

  // 3. A role="button" send control is found and clicked (modern Arena markup).
  const divSend = button(false, 'div');
  const ready = build({ send: divSend });
  const sent = await ready.provider.typeAndSend('hello');
  assert.equal(sent.sent, true);
  assert.equal(divSend.clicks, 1);
  assert.equal(ready.textarea.value, '', 'send confirmed by the cleared composer');

  // 4. While Arena is still streaming (Stop showing, no send control) the send
  //    waits for the turn to end, then sends - the live case that produced
  //    "Arena send is unavailable" when the loop injected mid-stream.
  const streamSend = button(false);
  const stop = button(false);
  stop.getAttribute = (name) => name === 'aria-label' ? 'Stop generation' : null;
  const streaming = build({ send: streamSend, stop });
  const pending = streaming.provider.typeAndSend('hello');
  await new Promise((resolve) => setTimeout(resolve, 400));
  streaming.state.stop = null;   // stream finished, composer ready again
  const afterStop = await pending;
  assert.equal(afterStop.sent, true);
  assert.equal(streamSend.clicks, 1);

  console.log('PASS Arena send: fast, explained failures, role="button" control and stop-gated sends');
})().catch(error => { console.error(error); process.exitCode = 1; });
