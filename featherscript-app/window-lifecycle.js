"use strict";

function revealWindow(win, {focus=true}={}) {
  if(!win || win.isDestroyed())return false;
  if(win.isMinimized())win.restore();
  win.show();
  if(focus)win.focus();
  return true;
}

// A hidden window must not depend on a single compositor notification.
function bindStartupWindow(win, {decorate=()=>{},report=()=>{},schedule=setTimeout,cancel=clearTimeout,delay=5000}={}) {
  let shown=false,closed=false,timer=null,retries=0;
  const clear=()=>{if(timer!==null){cancel(timer);timer=null;}};
  const markShown=()=>{if(!win.isDestroyed()&&win.isVisible()){shown=true;clear();}};
  const show=()=>{
    if(closed || shown || win.isDestroyed())return;
    try{decorate();}catch(error){report('Native window effect unavailable: '+error.message);}
    revealWindow(win,{focus:false});
    markShown();
    // Windows can suppress the first show when a parent used STARTF_USESHOWWINDOW.
    // Retry briefly rather than considering an invisible show event successful.
    if(!shown && retries++<2){clear();timer=schedule(show,100);timer?.unref?.();}
  };
  const onClosed=()=>{closed=true;clear();win.removeListener('show',markShown);win.removeListener('ready-to-show',show);win.webContents.removeListener('did-finish-load',show);};
  win.on('show',markShown);
  win.once('ready-to-show',show);
  win.webContents.once('did-finish-load',show);
  win.once('closed',onClosed);
  timer=schedule(()=>{timer=null;if(!closed&&!shown)report('Startup visibility fallback: showing the window while its renderer loads.');show();},delay);
  timer?.unref?.();
  return {show,dispose:onClosed};
}
module.exports={revealWindow,bindStartupWindow};
