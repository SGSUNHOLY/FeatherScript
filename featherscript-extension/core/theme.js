// One storage listener per tab, no polling and no provider-page style changes.
(() => {
  let current = 'auto';
  const syncVisibility=()=>{document.documentElement.dataset.zsFxPaused=String(document.hidden);};
  document.addEventListener('visibilitychange',syncVisibility);
  syncVisibility();
  function apply(theme, custom = {}) {
    const preset = FSThemePresets.find((p) => p.id === theme);
    current = preset ? preset.id : 'auto';
    const html = document.documentElement;
    html.dataset.zsTheme = current;
    globalThis.FSThemeMotion?.mount(document.querySelector('#zs-root #zs-bar'), current, {compact:true});
    html.toggleAttribute('data-zs-preset', !!preset?.background);
    if (current !== 'auto') html.classList.toggle('zs-light', !!preset.light);
    for (const key of ['ink', 'ink-soft', 'dark', 'bar-1', 'bar-2', 'bar-3']) {
      const value = custom[key];
      if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) html.style.setProperty(`--zs-${key}`, value);
      else html.style.removeProperty(`--zs-${key}`);
    }
  }
  globalThis.ZSTheme = { get current() { return current; } };
  const reload = () => chrome.storage.local.get(['zsTheme', 'zsCustomTheme']).then((s) => apply(s.zsTheme, s.zsCustomTheme));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.zsTheme || changes.zsCustomTheme)) reload();
  });
  reload();
})();
