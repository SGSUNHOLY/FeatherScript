'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { windowEffects, bindWindowPresence } = require('./window-effects');
assert.equal(windowEffects('win32', '10.0.26300').backgroundMaterial, 'acrylic');
assert.equal(windowEffects('win32', '10.0.19045').backgroundMaterial, undefined);
assert.equal(windowEffects('linux', '6.0.0').backgroundMaterial, undefined);
const win = new EventEmitter();
let focused = false, visible = false, minimized = false, muted;
Object.assign(win, {
  isFocused: () => focused, isVisible: () => visible,
  isMinimized: () => minimized, isDestroyed: () => false,
  webContents: { isDestroyed: () => false, setAudioMuted: value => { muted = value; } },
});
bindWindowPresence(win);
assert.equal(muted, true, 'hidden startup is muted');
visible = true; win.emit('show'); assert.equal(muted, true, 'show without focus stays muted');
focused = true; win.emit('focus'); assert.equal(muted, false);
focused = false; win.emit('blur'); assert.equal(muted, true);
focused = true; win.emit('focus'); assert.equal(muted, false);
minimized = true; win.emit('minimize'); assert.equal(muted, true);
focused = false; minimized = false; win.emit('restore'); assert.equal(muted, true);
focused = true; win.emit('focus'); assert.equal(muted, false);
visible = false; win.emit('hide'); assert.equal(muted, true);
console.log('PASS native audio focus/show/hide/minimize/restore gate and supported acrylic fallback');
