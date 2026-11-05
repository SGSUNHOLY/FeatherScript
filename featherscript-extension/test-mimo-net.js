// Transport regression fixtures. No real requests or provider account needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodes = new Map();
const attributes = new Map([['data-zs-mimo-agent', '1']]);
let requests = 0;
let captured;
const context = vm.createContext({
  Request, Response, ReadableStream, TextDecoder, Date, setTimeout, clearTimeout,
  document: {
    getElementById: (id) => nodes.get(id),
    createElement: () => ({ textContent: '' }),
    documentElement: {
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value),
      appendChild: (node) => nodes.set(node.id, node),
    },
  },
  fetch: (request) => { requests++; captured = request; return Promise.reject(Error('fixture network failure')); },
});
context.window = context;
let source = fs.readFileSync(require('node:path').join(__dirname, 'providers/mimo-net.js'), 'utf8');
source = source.replace(/\}\)\(\);\s*$/, 'globalThis.testTap = {readStream, openState, splitAnswer};\n})();');
vm.runInContext(source, context);

(async () => {
  const abort = new AbortController();
  const request = new Request('https://aistudio.xiaomimimo.com/open-apis/bot/chat', {
    method: 'POST', body: JSON.stringify({ query: 'fixture', conversationId: 'test' }),
  });
  await assert.rejects(context.fetch(request, { signal: abort.signal, headers: { 'x-fixture': 'kept' } }), /fixture network failure/);
  assert.equal(requests, 1, 'a rejected Request must never be submitted twice');
  assert.equal(captured.headers.get('x-fixture'), 'kept');
  abort.abort();
  assert.equal(captured.signal.aborted, true, 'caller abort signal must survive request shaping');

  const frame = (content, reasoningContent) => `event: message\r\ndata: ${JSON.stringify({ content, reasoningContent })}\r\n\r\n`;
  const wire = frame('<think>\u0000private') + frame('</think>\u0000') + frame('a', 'x') + frame('a', 'x') + frame('a') + frame(' 🌙') + 'event: finish\r\ndata: {}\r\n\r\n';
  const bytes = new TextEncoder().encode(wire);
  const response = new Response(new ReadableStream({ start(controller) {
    // Splits CRLF delimiters and multibyte Unicode at every possible boundary.
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
  const state = { rid: 'fixture-stream', startedAt: Date.now() };
  context.testTap.openState(state);
  await context.testTap.readStream(response, state);
  const result = JSON.parse(nodes.get('zs-mimo-net').textContent);
  assert.equal(result.text, 'aaa 🌙');
  assert.ok(result.reasoning.includes('xx'));
  assert.ok(result.reasoning.includes('private'));
  assert.equal(result.done, true);
  const thinking = context.testTap.splitAnswer({ raw: '<details type="reasoning"><summary>Thinking</summary>private command', reasoning: '' });
  assert.equal(thinking.text, '');
  assert.ok(thinking.thinking.includes('private command'));
  console.log('PASS MiMo single-send failure, Request options/abort, repeated deltas, fragmented CRLF/UTF-8 and reasoning exclusion');
})().catch((error) => { console.error(error); process.exitCode = 1; });
