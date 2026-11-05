// Google AI Studio uses Angular controls; native input events preserve its state.
const ZSProvider = (() => {
  const D = ZSDom;
  const timings = Object.freeze({ GEN_IDLE_MS: 2000, REASON_IDLE_MS: 15000, WARMUP_MS: 60000, REASON_NOREPLY_MS: 120000, STABLE_MS: 15000, RESPONSE_TIMEOUT_MS: 300000 });
  const turns = 'ms-chat-turn, [data-turn-role]';
  const thinkingSel = 'ms-thought-chunk, .thought-panel, [data-thought="true"]';
  const getEditor = () => D.first([
    'ms-prompt-box textarea', 'ms-textarea-wrapper textarea',
    'textarea[aria-label*="Type something" i]', 'textarea[placeholder*="Start typing" i]',
    'ms-prompt-input-wrapper textarea', 'ms-autosize-textarea textarea',
    'textarea[aria-label*="prompt" i]', 'textarea[placeholder*="prompt" i]',
    'ms-prompt-input [contenteditable="true"]', 'ms-prompt-input-wrapper [role="textbox"]',
  ]);
  const composerFrame = () => getEditor()?.closest('ms-prompt-box, ms-prompt-input-wrapper, ms-prompt-input, form') || getEditor()?.parentElement;
  function button(stop = false) {
    // Run can live in a sibling toolbar, outside the textarea's wrapper.
    const selectors = stop ? [
      'ms-run-button button[aria-label*="Stop" i]', 'button[aria-label*="Stop generating" i]',
      'button[aria-label="Stop"]', 'button[data-testid="stop-button"]',
    ] : [
      'ms-run-button button:not([aria-label*="Stop" i])',
      'button[aria-label="Run"]', 'button[aria-label*="Run prompt" i]',
      'button[aria-label^="Run " i]', 'button.run-button',
    ];
    return D.first(selectors) || (!stop && composerFrame() ? D.first(['button[type="submit"]'], composerFrame()) : null);
  }
  const allItems = () => [...document.querySelectorAll(turns)].filter((el) => !el.parentElement?.closest(turns));
  const isUserItem = (el) => !!el && (el.getAttribute('data-turn-role') === 'user' || el.getAttribute('data-role') === 'user' || el.classList.contains('user') || !!el.querySelector('.user-prompt-container, [data-role="user"]'));
  const isAssistantItem = (el) => !!el && !isUserItem(el) && (el.getAttribute('data-turn-role') === 'model' || el.getAttribute('data-role') === 'model' || !!el.querySelector('ms-model-response, .model-response, .model-prompt-container'));
  function classifyText(item, exclude = '') {
    if (!item) return '';
    const skip = `.zs-chip, button, ms-chat-turn-header, ${thinkingSel}${exclude ? ', ' + exclude : ''}`;
    let text = '';
    const newline = () => { if (text && !text.endsWith('\n')) text += '\n'; };
    const walk = (node) => {
      if (node.nodeType === 3) { text += node.nodeValue; return; }
      if (node.nodeType !== 1 || node.matches(skip)) return;
      if (node.tagName === 'BR') { text += '\n'; return; }
      const block = /^(P|DIV|PRE|LI|TR|MS-TEXT-CHUNK|MS-CODE-BLOCK)$/.test(node.tagName);
      if (block) newline();
      for (const child of node.childNodes) walk(child);
      if (block) newline();
    };
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
    const id = item.getAttribute('data-turn-id') || item.id;
    if (id) return id;
    if (!identities.has(item)) identities.set(item, ++sequence);
    return identities.get(item);
  };
  const editorText = () => { const e = getEditor(); return e ? e.value ?? e.textContent ?? '' : ''; };
  const isGenerating = () => !!button(true) || !!document.querySelector('ms-model-response[aria-busy="true"], ms-chat-turn[aria-busy="true"]');
  let locked = false, injecting = false, sending = false;
  // Lock user input through delegated capture; leave Angular's control enabled.
  function setInputLock(on) { locked = on; }
  async function typeAndSend(text) {
    if (sending) throw new Error('AI Studio submission is already in progress.');
    if (isGenerating()) throw new Error('AI Studio is still generating.');
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
        // Angular may remount after the initial input event. Reacquire once per
        // replacement instead of throwing against the disconnected old node.
        if (current !== editor) fill(current);
        const b = button();
        return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && editorText() === text ? b : null;
      }, 10000);
      send.click();
    } finally { sending = false; }
  }
  function installSendHooks(h) {
    document.addEventListener('beforeinput', (event) => {
      if (locked && !injecting && getEditor()?.contains(event.target) && event.isTrusted) event.preventDefault();
    }, true);
    const notify = () => {
      if (h.isBlocked()) return;
      if (h.isStarted()) h.onUserMessage(assistantCount());
      else if (!allItems().length) h.onBlockedAttempt();
    };
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && getEditor()?.contains(event.target) && editorText().trim()) notify();
    }, true);
    document.addEventListener('click', (event) => {
      const b = event.target.closest?.('button');
      if (!b) return;
      if (b === button(true)) h.onNativeStop();
      else if (b === button() && !b.disabled && editorText().trim()) notify();
    }, true);
  }
  const readAssistant = () => { const item = lastAssistant(); return { item, present: !!item, reply: itemText(item), thinking: '' }; };
  return {
    id: 'aistudio', timings, displayName: 'Google AI Studio', supportsVision: false,
    thinkingSel, chipAtItemLevel: true, reliableCounts: false,
    init() {}, allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, readAssistant,
    streamLen: (item = lastAssistant()) => itemText(item).length,
    snapshot: () => ({ th: 0, rp: itemText(lastAssistant()).length }),
    getEditor, editorText, composerFrame, barAnchor: composerFrame,
    chatIsEmpty: () => !allItems().length,
    isFreshChat: () => !allItems().length && !!getEditor(),
    conversationKey: () => /\/new_chat\/?$/.test(location.pathname) ? '' : location.pathname,
    setInputLock, typeAndSend, stopGeneration: () => button(true)?.click(),
    isGenerating, isBusyNow: isGenerating, isHardGenerating: isGenerating,
    enforceComposer: () => ({ ready: !!getEditor() }),
    ensureComposerReady: async () => { await D.waitFor(getEditor, 15000); return { ready: !isGenerating() }; },
    turnHalted: () => false, findContinueBtn: () => null, clickContinueBtn() {},
    scanError: () => D.first(['[role="alert"]'])?.textContent || null,
    isTooLongMsg: (s) => /context.{0,20}(limit|exceed)|too many tokens/i.test(s),
    isBusyMsg: (s) => /quota|resource exhausted|rate limit|temporarily unavailable/i.test(s),
    installSendHooks,
    findToolBlockSpot(item) {
      const block = [...item.querySelectorAll('pre, ms-code-block')].find((el) => /###(?:LUA|MCP_TOOL)###|"(?:command|tool)"\s*:/.test(el.textContent));
      if (!block) return null;
      block.classList.add('zs-tool-hide');
      return { parent: block.parentElement, ref: block };
    },
  };
})();
