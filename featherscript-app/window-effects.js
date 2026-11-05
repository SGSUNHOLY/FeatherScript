"use strict";
const os=require('node:os');

// Acrylic is supplied by Windows DWM, not CSS backdrop-filter. Keep unsupported
// systems opaque rather than producing a clear, unblurred or black window.
function windowEffects(platform=process.platform,release=os.release()) {
  const [major,,build]=release.split('.').map(Number);
  if(platform==='win32' && (major>10 || (major===10 && build>=22621))) {
    return {backgroundMaterial:'acrylic',backgroundColor:'#00000000'};
  }
  return {backgroundColor:'#e9e5dd'};
}
// The main process is authoritative even if a renderer focus event is delayed.
function bindWindowPresence(win) {
  const sync = () => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.setAudioMuted(!win.isFocused() || !win.isVisible() || win.isMinimized());
  };
  for (const event of ['focus','blur','show','hide','minimize','restore']) win.on(event,sync);
  sync();
}
module.exports={windowEffects,bindWindowPresence};
