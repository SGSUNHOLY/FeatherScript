/* Shared validation and color math for the main process and renderer. */
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.FSAppearance = model;
})(globalThis, () => {
  'use strict';
  const defaults = Object.freeze({ layout: 'default', enabled: false, name: 'My studio', accent: '#c3a6ff',
    canvas: '#101016', surface: '#1a1b24', text: '#eef3f6', mode: 'gradient',
    from: '#10151b', to: '#1a3040', angle: 135, photo: '', overlay: 65 });
  const hex = (value, fallback) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  let cachedPhoto = "";
  function photo(value) {
    if (value && value === cachedPhoto) return value;
    if (typeof value !== 'string' || value.length > 2200000 || !/^data:image\/(png|jpeg|webp);base64,[a-z\d+/]+=*$/i.test(value)) return '';
    try {
      const raw = atob(value.slice(value.indexOf(',') + 1));
      if (value.startsWith('data:image/jpeg;') && raw.charCodeAt(0) === 255 && raw.charCodeAt(1) === 216 && raw.charCodeAt(2) === 255) { cachedPhoto = value; return value; }
      if (value.startsWith('data:image/png;') && raw.slice(0, 8) === '\x89PNG\r\n\x1a\n') { cachedPhoto = value; return value; }
      if (value.startsWith('data:image/webp;') && raw.slice(0, 4) === 'RIFF' && raw.slice(8, 12) === 'WEBP') { cachedPhoto = value; return value; }
    } catch {}
    return '';
  }
  function normalize(input) {
    const value = input && typeof input === 'object' ? input : {};
    const output = { ...defaults, layout: ['default','studio','canvas'].includes(value.layout) ? value.layout : 'default', enabled: value.enabled === true,
      name: typeof value.name === 'string' ? value.name.trim().slice(0, 40) || defaults.name : defaults.name,
      mode: ['solid', 'gradient', 'photo'].includes(value.mode) ? value.mode : defaults.mode,
      angle: Number.isFinite(Number(value.angle)) ? Math.max(0, Math.min(360, Number(value.angle))) : defaults.angle,
      overlay: Number.isFinite(Number(value.overlay)) ? Math.max(20, Math.min(95, Number(value.overlay))) : defaults.overlay,
      photo: photo(value.photo) };
    for (const key of ['accent', 'canvas', 'surface', 'text', 'from', 'to']) output[key] = hex(value[key], defaults[key]);
    return output;
  }
  const rgb = color => color.slice(1).match(/../g).map(part => parseInt(part, 16));
  function mix(a, b, amount) {
    const second = rgb(b);
    return '#' + rgb(a).map((part, i) => Math.round(part * amount + second[i] * (1 - amount)).toString(16).padStart(2, '0')).join('');
  }
  function luminance(color) {
    return rgb(color).map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; })
      .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  }
  function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  function tokens(input) {
    const p = normalize(input), soft = mix(p.text, p.surface, .68), line = mix(p.text, p.surface, .17);
    const buttonText = contrast(p.accent, '#101010') > contrast(p.accent, '#ffffff') ? '#101010' : '#ffffff';
    return {
      '--paper': p.canvas, '--paper-hi': p.surface, '--paper-lo': p.canvas,
      '--workspace': p.canvas, '--sidebar': p.surface, '--sidebar-text': p.text,
      '--sidebar-soft': soft, '--sidebar-line': line, '--sidebar-active': p.accent,
      '--panel': p.surface, '--panel-solid': p.surface, '--panel-text': p.text,
      '--panel-soft': soft, '--panel-line': line, '--card-bg': p.surface,
      '--card-solid': p.surface, '--card-edge': line, '--ink': p.text,
      '--ink-soft': soft, '--ink-faint': soft, '--line': line,
      '--line-strong': mix(p.text, p.surface, .38), '--accent': p.accent,
      '--accent-soft': soft, '--mark': p.accent, '--btn-bg': p.accent,
      '--btn-ink': buttonText, '--nav-fill': p.accent, '--nav-ink-text': buttonText,
      '--highlight': mix(p.accent, p.surface, .25), '--focus': mix(p.accent, p.surface, .35),
      '--hover': mix(p.accent, p.surface, .09), '--chip-bg': mix(p.text, p.surface, .06),
      '--studio-scene': p.mode === 'photo' && p.photo ? `url("${p.photo}")` : p.mode === 'gradient' ? `linear-gradient(${p.angle}deg,${p.from},${p.to})` : 'none',
      '--studio-dim': String(p.overlay / 100),
      '--ok': luminance(p.canvas) < .4 ? '#95d5a3' : '#256536',
      '--warn': luminance(p.canvas) < .4 ? '#ffd180' : '#78520b',
      '--danger': luminance(p.canvas) < .4 ? '#ffa6a6' : '#a32128',
    };
  }
  return { defaults, normalize, photo, contrast, tokens, luminance };
});
