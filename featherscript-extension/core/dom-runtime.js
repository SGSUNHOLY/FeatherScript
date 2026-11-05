// Shared isolated-world DOM adapter. Never writes framework internals or innerHTML.
const ZSDom = (() => {
  const visible = (el) => !!el && el.isConnected && !el.closest('#zs-root,[hidden],[aria-hidden="true"]') && el.getClientRects().length > 0;
  function first(selectors, root = document) {
    for (const selector of selectors) {
      const found = [...root.querySelectorAll(selector)].find(visible);
      if (found) return found;
    }
    return null;
  }
  function write(editor, text) {
    if (!editor?.isConnected) throw new Error('Composer was replaced; retry with the current editor.');
    editor.focus();
    if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
      const proto = editor.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(editor, text);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand('insertText', false, text)) throw new Error('Composer refused text insertion.');
    }
  }
  // Observe only while a concrete operation awaits a layout/state transition.
  function waitFor(read, timeout = 5000) {
    return new Promise((resolve, reject) => {
      let observer, timer, poll, queued = false, settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        observer?.disconnect(); clearTimeout(timer); clearInterval(poll);
        document.removeEventListener('input', check, true);
        document.removeEventListener('change', check, true);
        error ? reject(error) : resolve(value);
      };
      const check = () => {
        queued = false;
        if (settled) return;
        try { const value = read(); if (value) finish(value); } catch (error) { finish(null, error); }
      };
      observer = new MutationObserver(() => {
        if (!settled && !queued) { queued = true; queueMicrotask(check); }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'aria-label', 'placeholder', 'hidden', 'aria-hidden', 'contenteditable', 'class', 'style'] });
      document.addEventListener('input', check, true);
      document.addEventListener('change', check, true);
      // React sometimes clears a textarea's value property without changing a
      // DOM attribute or firing input/change. Poll only while waiting so that
      // an accepted send can be recognized promptly instead of timing out.
      poll = setInterval(check, 100);
      timer = setTimeout(() => finish(null, new Error('Timed out waiting for the chat composer.')), timeout);
      check();
    });
  }
  return { visible, first, write, waitFor };
})();
