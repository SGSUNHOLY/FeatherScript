// SPDX-License-Identifier: GPL-3.0-or-later
// Provisional Genspark AI Chat adapter. The default /agents route also opens
// AI Chat; explicit other agent types remain excluded.
const ZSProvider = (() => {
  'use strict';
  const D = ZSDom;
  const timings = Object.freeze({
    GEN_IDLE_MS: 2500, REASON_IDLE_MS: 18000, WARMUP_MS: 60000,
    REASON_NOREPLY_MS: 120000, STABLE_MS: 15000, RESPONSE_TIMEOUT_MS: 300000,
  });
  const inChat = () => {
    if(!/^\/agents\/?$/.test(location.pathname || ''))return false;
    const type=new URLSearchParams(location.search || '').get('type');
    return !type||type==='ai_chat';
  };
  const editorSelectors = [
    'main textarea[placeholder*="ask" i]',
    'main textarea[placeholder*="message" i]',
    'main textarea[placeholder*="chat" i]',
    'main [contenteditable="true"][data-placeholder*="ask" i]',
    'main [contenteditable="true"][aria-label*="message" i]',
    'main [role="textbox"][contenteditable="true"]',
    'main form textarea',
    'main form [contenteditable="true"]',
    'textarea[placeholder*="ask" i]',
    'textarea[placeholder*="message" i]',
    '[contenteditable="true"][data-placeholder*="ask" i]',
    '[contenteditable="true"][role="textbox"]',
  ];
  const controlSelectors = 'button, [role="button"]';
  const messageSelectors = [
    '[data-message-author-role="user"]', '[data-message-author-role="assistant"]',
    '[data-role="user"]', '[data-role="assistant"]',
    '[data-testid*="chat-message" i]', '[data-testid*="message-item" i]',
    '.chat-message', '.message-item', '.user-message', '.assistant-message',
  ].join(',');
  const hidden = (el) => !D.visible(el) || !!el.closest?.('nav, aside, header, #zs-root, [role="search"]');
  const controlName = (el) => [
    el?.getAttribute?.('aria-label'), el?.getAttribute?.('title'),
    el?.getAttribute?.('data-testid'), el?.textContent,
  ].filter(Boolean).join(' ').trim();
  const enabled = (el) => !!el && !el.disabled && el.getAttribute?.('aria-disabled') !== 'true';
  const sendLike = (el) => /(?:^|[\s_-])(send|submit)(?:[\s_-]|$)|send message|send prompt/i.test(controlName(el));
  const stopLike = (el) => /stop (?:generating|generation|response)|cancel generation|stop generating/i.test(controlName(el));

  function frames(editor) {
    if (!editor) return [];
    const form = editor.closest?.('form');
    if (form) return [form];
    const result = [];
    let root = editor.parentElement;
    for (let depth = 0; root && depth < 5 && root !== document.body; depth++, root = root.parentElement) {
      if (!root.closest?.('#zs-root')) result.push(root);
    }
    return result;
  }
  function findControl(editor, match) {
    for (const frame of frames(editor)) {
      const buttons = [...frame.querySelectorAll(controlSelectors)].filter((el) => !hidden(el));
      const button = buttons.find(match);
      if (button) return button;
    }
    return null;
  }
  const sendButton = (editor = getEditor()) => findControl(editor,
    (b) => sendLike(b) || (b.tagName === 'BUTTON' && b.getAttribute('type') === 'submit'));
  const stopButton = (editor = getEditor()) => findControl(editor, stopLike);
  function getEditor() {
    if (!inChat()) return null;
    const candidates = [...document.querySelectorAll(editorSelectors.join(','))];
    for (const editor of candidates) {
      if (hidden(editor) || editor.disabled || editor.getAttribute('contenteditable') === 'false') continue;
      if (editor.tagName !== 'TEXTAREA' && editor.getAttribute('contenteditable') !== 'true') continue;
      const hint = [editor.getAttribute('placeholder'), editor.getAttribute('data-placeholder'),
        editor.getAttribute('aria-label')].filter(Boolean).join(' ');
      if (/search (?:the )?(?:web|site)|search history|search conversations/i.test(hint)) continue;
      const chatHint = /ask|message|chat|prompt|type here|how can i help/i.test(hint);
      const localControl = findControl(editor, (b) => sendLike(b) || stopLike(b) ||
        (b.tagName === 'BUTTON' && b.getAttribute('type') === 'submit'));
      if (chatHint || localControl) return editor;
    }
    return null;
  }
  const editorText = () => { const editor = getEditor(); return editor ?
    String(editor.value ?? editor.innerText ?? editor.textContent ?? '') : ''; };
  const composerFrame = () => frames(getEditor())[0] || null;

  const roleOf = (el) => {
    if (!el) return '';
    const role = String(el.getAttribute?.('data-message-author-role') ||
      el.getAttribute?.('data-role') || el.getAttribute?.('data-author') || '').toLowerCase();
    if (/^(user|human)$/.test(role)) return 'user';
    if (/^(assistant|model|bot)$/.test(role)) return 'assistant';
    const hint = String(el.getAttribute?.('data-testid') || '') + ' ' + String(el.className || '');
    if (/(?:^|[\s_-])(user|human)(?:[\s_-]|$)/i.test(hint)) return 'user';
    if (/(?:^|[\s_-])(assistant|model|bot)(?:[\s_-]|$)/i.test(hint)) return 'assistant';
    const user = el.querySelector?.('[data-message-author-role="user"], [data-role="user"]');
    const assistant = el.querySelector?.('[data-message-author-role="assistant"], [data-role="assistant"]');
    return user && !assistant ? 'user' : assistant && !user ? 'assistant' : '';
  };
  function allItems() {
    if (!inChat()) return [];
    const candidates = [...document.querySelectorAll(messageSelectors)]
      .filter((el) => !el.closest?.('#zs-root, nav, aside, form') && !!roleOf(el));
    return candidates.filter((el) => !candidates.some((parent) =>
      parent !== el && parent.contains(el) && roleOf(parent) === roleOf(el)));
  }
  const isUserItem = (el) => roleOf(el) === 'user';
  const isAssistantItem = (el) => roleOf(el) === 'assistant';
  function classifyText(item, exclude = '') {
    if (!item) return '';
    const skip = '.zs-chip, button, script, style, [aria-hidden="true"], [data-thought="true"], details' +
      (exclude ? ', ' + exclude : '');
    let text = '';
    const newline = () => { if (text && !text.endsWith('\n')) text += '\n'; };
    function walk(node) {
      if (node.nodeType === 3) { text += node.nodeValue || ''; return; }
      if (node.nodeType !== 1 || node.matches?.(skip)) return;
      if (node.tagName === 'BR') { newline(); return; }
      const block = /^(P|DIV|PRE|LI|TR|ARTICLE|SECTION)$/.test(node.tagName);
      if (block) newline();
      for (const child of node.childNodes || []) walk(child);
      if (block) newline();
    }
    walk(item);
    return text.trim();
  }
  const itemText = (item) => classifyText(item);
  const assistants = () => allItems().filter(isAssistantItem);
  const assistantCount = () => assistants().length;
  const userCount = () => allItems().filter(isUserItem).length;
  const lastAssistant = () => assistants().at(-1) || null;
  const identities = new WeakMap(); let sequence = 0;
  const lastAssistantId = () => {
    const item = lastAssistant();
    if (!item) return null;
    const id = item.getAttribute?.('data-message-id') || item.getAttribute?.('data-id') || item.id;
    if (id) return id;
    if (!identities.has(item)) identities.set(item, ++sequence);
    return identities.get(item);
  };

  let localChatKey = `genspark-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let sawItems = false;
  function chatIsEmpty() {
    const empty = allItems().length === 0;
    if (!empty) sawItems = true;
    else if (sawItems) {
      localChatKey = `genspark-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sawItems = false;
    }
    return empty;
  }
  const isFreshChat = () => inChat() && chatIsEmpty() && !!getEditor();
  function conversationKey() {
    if (!inChat()) return '';
    chatIsEmpty();
    const params = new URLSearchParams(location.search || '');
    for (const key of ['conversation_id', 'conversationId', 'chat_id', 'chatId', 'thread_id', 'threadId', 'session_id', 'sessionId']) {
      if (params.get(key)) return `genspark:${params.get(key)}`;
    }
    return localChatKey;
  }
  const isGenerating = () => !!stopButton() || (inChat() && !!document.querySelector(
    'main [data-state="streaming"], main [data-generating="true"], main [aria-busy="true"][data-message-author-role="assistant"]'));
  let locked = false, injecting = false, sending = false;
  const setInputLock = (on) => { locked = !!on; };
  async function typeAndSend(text) {
    if (!inChat()) throw new Error('Open Genspark AI Chat at genspark.ai/agents.');
    if (sending) throw new Error('Genspark submission is already in progress.');
    if (isGenerating()) throw new Error('Genspark is still generating a response.');
    sending = true;
    let editor;
    const fill = (current) => {
      injecting = true;
      try { D.write(current, text); } finally { injecting = false; }
      editor = current;
    };
    try {
      fill(await D.waitFor(getEditor, 15000));
      const send = await D.waitFor(() => {
        const current = getEditor();
        if (!current) return null;
        if (current !== editor) fill(current);
        const button = sendButton(current);
        return enabled(button) && editorText() === text ? button : null;
      }, 10000);
      if (!inChat()) throw new Error('Genspark navigated away from AI Chat before sending.');
      const usersBefore=userCount(),assistantsBefore=assistantCount();
      send.click();
      // A click can be accepted asynchronously. Wait for Genspark's own receipt
      // before returning, but never automatically click a second time if the
      // first click's result remains unknown (it could duplicate a prompt).
      const acknowledged=()=>(getEditor()&&editorText().trim()==='') ||
        userCount()>usersBefore || assistantCount()>assistantsBefore || isGenerating();
      if (acknowledged()) return {sent:true};
      try {
        await D.waitFor(acknowledged, 5000);
        return {sent:true};
      } catch (error) {
        if (!inChat()) throw new Error('Genspark navigated away from AI Chat after the send attempt.');
        // The core can do its own final check, then stop safely if unconfirmed.
        return {sent:false,attempted:true};
      }
    } finally { sending = false; }
  }
  function installSendHooks(hooks) {
    document.addEventListener('beforeinput', (event) => {
      const editor = getEditor();
      if (locked && !injecting && event.isTrusted && editor &&
          (event.target === editor || editor.contains(event.target))) event.preventDefault();
    }, true);
    const notify = () => {
      if (sending || hooks.isBlocked()) return;
      if (hooks.isStarted()) hooks.onUserMessage(assistantCount());
      else if (chatIsEmpty()) hooks.onBlockedAttempt();
    };
    document.addEventListener('keydown', (event) => {
      const editor = getEditor();
      if (editor && (event.target === editor || editor.contains(event.target)) &&
          event.key === 'Enter' && !event.shiftKey && !event.isComposing && editorText().trim()) notify();
    }, true);
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.(controlSelectors);
      if (!button) return;
      if (button === stopButton()) hooks.onNativeStop();
      else if (button === sendButton() && enabled(button) && editorText().trim()) notify();
    }, true);
  }
  const readAssistant = () => { const item = lastAssistant(); return {
    item, present: !!item, reply: itemText(item), thinking: '',
  }; };
  return {
    id: 'genspark', displayName: 'Genspark AI Chat', supportsVision: false, timings,
    chipAtItemLevel: true, reliableCounts: false, init() {},
    allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, readAssistant,
    streamLen: (item = lastAssistant()) => itemText(item).length,
    snapshot: () => ({ th: 0, rp: itemText(lastAssistant()).length }),
    getEditor, editorText, composerFrame, barAnchor: composerFrame,
    chatIsEmpty, isFreshChat, conversationKey, setInputLock, typeAndSend,
    stopGeneration: () => stopButton()?.click(),
    isGenerating, isBusyNow: isGenerating, isHardGenerating: isGenerating,
    enforceComposer: () => ({ ready: !!getEditor() }),
    ensureComposerReady: async () => {
      await D.waitFor(getEditor, 15000);
      return { ready: !isGenerating() };
    },
    turnHalted: () => false,
    findContinueBtn: () => null, clickContinueBtn: () => false,
    scanError: () => inChat() ? D.first(['main [role="alert"]', '[data-sonner-toast]'])?.textContent || null : null,
    isTooLongMsg: (s) => /context.{0,20}(limit|exceed)|too many tokens|conversation too long/i.test(s),
    isBusyMsg: (s) => /quota|rate limit|too many requests|temporarily unavailable/i.test(s),
    installSendHooks,
    findToolBlockSpot(item) {
      const block = [...(item?.querySelectorAll?.('pre, code') || [])]
        .find((el) => /###(?:LUA|MCP_TOOL)###|"(?:command|tool)"\s*:/.test(el.textContent || ''));
      if (!block) return null;
      block.classList.add('zs-tool-hide');
      return { parent: block.parentElement, ref: block };
    },
  };
})();
