// Pure helpers behind the agent-loop guards: dropped-reply detection and the
// stable tool-call identity used by the repeated-call breaker.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'core/main.js'), 'utf8');

function take(name) {
  let start = source.indexOf(`  function ${name}(`);
  if (start < 0) start = source.indexOf(`  const ${name} = (`);
  assert.ok(start > 0, `${name} missing`);
  if (source[start + 2] === 'c') {
    const end = source.indexOf(';', source.indexOf('=>', start));
    assert.ok(end > start, `${name} expression missing`);
    return source.slice(start, end + 1);
  }
  let depth = 0, end = -1;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.ok(end > start, `${name} body missing`);
  return source.slice(start, end);
}

const context = vm.createContext({
  JSON, Object, String, RegExp,
  ZSParse: { hasToolSignature: text => /"command"\s*:/.test(text) },
  P: { isBusyMsg: text => /too frequent|try again later|过于频繁|请稍后再试|服务器繁忙/i.test(text) },
});
vm.runInContext(take('hasReplyContent') + '\n' + take('callSignature') + '\n' + take('isSiteNoticeReply') + '\n' + take('studioBlocked') + '\n' + take('studioBlockedLead') +
  '\n;globalThis.hasReplyContent = hasReplyContent; globalThis.callSignature = callSignature; globalThis.isSiteNoticeReply = isSiteNoticeReply; globalThis.studioBlocked = studioBlocked; globalThis.studioBlockedLead = studioBlockedLead;', context);
const { hasReplyContent, callSignature, isSiteNoticeReply, studioBlocked, studioBlockedLead } = context;

// Studio-state failures must never be phrased as "your command was wrong": the
// model answered them by re-sending the same call 3-4 times (2026-11-03).
assert.equal(studioBlocked("Studio's Assistant tool module was not loaded, so nothing ran. This is a Studio-side hiccup, normal while the place is in Play mode or just after entering/leaving Play. Stop Play, or wait a few seconds, then run the command again."), true);
assert.equal(studioBlocked('Edit datamodel is not available in Play mode'), true);
assert.equal(studioBlocked('datamodel_type is required'), false, "a missing parameter is still the model's to fix");
assert.equal(studioBlocked(''), false);
assert.equal(studioBlockedLead('Edit datamodel is not available in Play mode'), true);
assert.equal(studioBlockedLead('1→-- The Edit datamodel is not available in Play mode, so read from Runtime.'), true,
  'a short answer that starts with the complaint is the complaint');
assert.equal(studioBlockedLead("Output of 'get_console_output':\n1→print('hello')\n2→-- Edit datamodel is not available in Play mode\n3→ready"), false,
  'tool output that merely quotes the phrase stays output');
assert.equal(studioBlocked('x'.repeat(400) + ' not available in Play mode'), false, 'a long payload is not a state notice');

// A rate-limit notice answering instead of the model must be recognised as a
// SITE condition (DeepSeek: "Messages too frequent. Try again later."), while a
// model's own prose and a real command must never end a run.
assert.equal(isSiteNoticeReply('Messages too frequent. Try again later.'), true);
assert.equal(isSiteNoticeReply(''), false, 'blank is not a notice');
assert.equal(isSiteNoticeReply('{"command":"script_read","params":{"target_file":"x"}}'), false, 'a command is not a notice');
assert.equal(isSiteNoticeReply(`If the place is still locked when you test it, close Studio and run it again later, then tell me what the console printed so I can look at the exact error and fix the script for you.`), false,
  'long prose that merely says "again later" is not a notice');
assert.equal(isSiteNoticeReply('The bridge refused that call, so try again later and I will run it again.'), false,
  "a model's own short answer is not a site notice");
assert.equal(isSiteNoticeReply('Server is busy. Please try again later.'), true);
assert.equal(isSiteNoticeReply('请求过于频繁，请稍后再试。'), true, "the notice in the account's language is still a notice");
assert.equal(isSiteNoticeReply('Studio 目前拒绝了这次写入，请稍后再试。我建议你先把脚本保存到本地，然后重新打开 Place 再运行一次，这样我们就能确认是不是桥接进程卡住了。'), false,
  'a long Chinese model answer is not a site notice (CJK has no spaces to count)');

for (const text of ['', '   ', '\n\n', '…', '---', '`', '👍🎉', '```\n```'])
  assert.equal(hasReplyContent(text), false, `dropped reply misread as content: ${JSON.stringify(text)}`);
for (const text of ['ok', 'Done.', '{"command":"x"}', '日本語', '3'])
  assert.equal(hasReplyContent(text), true, `real reply misread as empty: ${JSON.stringify(text)}`);

const one = callSignature({ tool: 'execute_luau', arguments: { code: 'return 1', datamodel: 'Edit' } });
const reordered = callSignature({ tool: 'execute_luau', arguments: { datamodel: 'Edit', code: 'return 1' } });
assert.equal(one, reordered, 'argument order must not change the identity');
assert.equal(callSignature({ tool: 'a', arguments: { nested: { x: 1, y: 2 } } }),
  callSignature({ tool: 'a', arguments: { nested: { y: 2, x: 1 } } }), 'nested argument order must not matter');
assert.notEqual(one, callSignature({ tool: 'execute_luau', arguments: { code: 'return 2', datamodel: 'Edit' } }));
assert.notEqual(one, callSignature({ tool: 'multi_edit', arguments: { code: 'return 1', datamodel: 'Edit' } }));
assert.equal(callSignature({ tool: 'a', arguments: { list: [1, 2] } }) === callSignature({ tool: 'a', arguments: { list: [2, 1] } }), false,
  'array order is meaningful');
assert.doesNotThrow(() => callSignature({ tool: 'a', arguments: { self: undefined, fn: () => 1 } }));
assert.doesNotThrow(() => callSignature(null));
console.log('PASS loop guards: content-free replies count as empty and repeated calls share one identity');
