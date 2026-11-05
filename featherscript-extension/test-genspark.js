const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function run() {
  const location = { pathname: '/agents', search: '' };
  const frame = { querySelectorAll: () => [send] };
  const makeEditor = (placeholder = 'Ask anything') => ({
    tagName: 'TEXTAREA', value: '', disabled: false, parentElement: frame,
    getAttribute: (name) => name === 'placeholder' ? placeholder : null,
    closest: (selector) => selector === 'form' ? frame : null,
    contains(target) { return target === this; },
  });
  let editor = makeEditor();
  let clicks = 0,clearOnSend=false,delayedClearOnSend=false;
  const send = {
    tagName: 'BUTTON', disabled: false, textContent: '',
    getAttribute: (name) => name === 'aria-label' ? 'Send message' : name === 'type' ? 'submit' : null,
    closest: () => null,
    click: () => {
      clicks++;
      if(clearOnSend)editor.value='';
      if(delayedClearOnSend)setTimeout(()=>{editor.value='';},3);
    },
  };
  const turn = (role, message, id) => ({
    nodeType: 1, tagName: 'ARTICLE', className: '', id: '',
    childNodes: [{ nodeType: 3, nodeValue: message }],
    getAttribute: (name) => name === 'data-role' ? role : name === 'data-message-id' ? id : null,
    querySelector: () => null, closest: () => null, matches: () => false,
    contains: () => false,
  });
  let turns = [];
  const document = {
    body: {},
    querySelectorAll(selector) {
      if (selector.includes('textarea[placeholder')) return editor ? [editor] : [];
      if (selector.includes('data-message-author-role')) return turns;
      return [];
    },
    querySelector: () => null,
    addEventListener: () => {},
  };
  let paused = false;
  const D = {
    visible: () => true,
    first: () => null,
    write(target, text) { target.value = text; },
    async waitFor(read) {
      if (paused) await new Promise((resolve) => setTimeout(resolve, 5));
      let result = read();
      if(!result && delayedClearOnSend){
        for(let attempt=0;attempt<25&&!result;attempt++){
          await new Promise(resolve=>setTimeout(resolve,1));
          result=read();
        }
      }
      if (!result) throw new Error('No matching composer or send button');
      return result;
    },
  };
  const source = fs.readFileSync(path.join(__dirname, 'providers/genspark.js'), 'utf8');
  const P = vm.runInNewContext(source + '\nZSProvider;', { document, location, ZSDom: D, URLSearchParams, Date, Math });

  assert.equal(P.getEditor(), editor);
  assert.equal(P.isFreshChat(), true);
  assert.equal((await P.ensureComposerReady()).ready, true);
  assert.equal((await P.typeAndSend('first prompt')).attempted,true,
    'an unconfirmed click must be recorded as attempted so the core cannot resend it');
  assert.equal(clicks, 1);
  assert.equal(editor.value, 'first prompt');
  delayedClearOnSend=true;
  assert.equal((await P.typeAndSend('delayed receipt')).sent,true,
    'a delayed Genspark composer reset confirms the first click');
  assert.equal(clicks,2,'asynchronous acknowledgement must not trigger a second click');
  delayedClearOnSend=false;
  clearOnSend=true;
  assert.equal((await P.typeAndSend('confirmed send')).sent,true,'cleared input is a real acceptance receipt');
  assert.equal(clicks,3);
  clearOnSend=false;
  location.search='?type=ai_chat';
  assert.equal(P.getEditor(),editor,'explicit AI chat route remains supported');
  turns = [turn('user', 'hello', 'u1'), turn('assistant', 'print(123)', 'a1')];
  assert.equal(P.chatIsEmpty(), false);
  assert.equal(P.userCount(), 1);
  assert.equal(P.assistantCount(), 1);
  assert.equal(P.readAssistant().reply, 'print(123)');
  assert.equal(P.lastAssistantId(), 'a1');
  const firstKey = P.conversationKey();
  turns = [];
  assert.equal(P.isFreshChat(), true);
  assert.notEqual(P.conversationKey(), firstKey, 'a new empty chat gets a fresh local identity');

  editor = makeEditor('Search conversations');
  assert.equal(P.getEditor(), null, 'sidebar search must never be used as the composer');
  await assert.rejects(P.typeAndSend('no search injection'), /No matching composer/);
  assert.equal(clicks, 3);
  editor = makeEditor();
  paused = true;
  const first = P.typeAndSend('one at a time');
  await assert.rejects(P.typeAndSend('duplicate'), /already in progress/);
  await first;
  assert.equal(clicks, 4);
  paused = false;
  send.disabled = true;
  await assert.rejects(P.typeAndSend('disabled'), /No matching/);
  assert.equal(clicks, 4, 'disabled send must never be clicked');
  send.disabled = false;
  await P.typeAndSend('retry');
  assert.equal(clicks, 5, 'failed send releases the lock');

  location.search = '?type=other_agent';
  assert.equal(P.getEditor(), null);
  assert.equal(P.allItems().length, 0);
  await assert.rejects(P.typeAndSend('wrong surface'), /Open Genspark AI Chat/);
  assert.equal(clicks, 5);
  console.log('PASS Genspark default and explicit AI-chat routes, transcript parsing, local chat identity, send receipts, lock and retry');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
