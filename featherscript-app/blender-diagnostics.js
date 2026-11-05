"use strict";
const {spawn} = require('node:child_process');
const path = require('node:path');

// A diagnostic gets its own temporary Blender scene and never touches the live
// bridge session. Only this test process is cancelled on timeout or window exit.
function diagnose({root,python,executable='',signal}) {
  if(typeof executable!=='string' || executable.length>4096 || /[\0\r\n]/.test(executable))return Promise.reject(Error('Choose a valid Blender executable path.'));
  if(!python)return Promise.reject(Error('Python 3.9 or newer was not found.'));
  if(signal?.aborted)return Promise.reject(Error('Blender check cancelled.'));
  return new Promise((resolve,reject)=>{
    const child=spawn(python.cmd,[...python.args,path.join(root,'blender_headless.py'),'--diagnose'],{
      cwd:root,windowsHide:true,env:{...process.env,BLENDER_EXECUTABLE:executable,PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1'},stdio:['ignore','pipe','pipe'],
    });
    let output='',errors='',timedOut=false,tooLarge=false;
    const stop=()=>{
      if(child.exitCode!==null)return;
      if(process.platform==='win32' && child.pid) {
        let fallbackUsed=false;
        const fallback=()=>{if(!fallbackUsed && child.exitCode===null){fallbackUsed=true;child.kill();}};
        const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
        killer.once('error',fallback);
        killer.once('close',code=>{if(code!==0)fallback();});
      } else child.kill('SIGTERM');
    };
    const timer=setTimeout(()=>{timedOut=true;stop();},45000);
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);};
    signal?.addEventListener('abort',stop,{once:true});
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output=(output+chunk).slice(0,65537);if(output.length>65536 && !tooLarge){tooLarge=true;stop();}});
    child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-8000);});
    child.once('error',error=>{cleanup();reject(error);});
    child.once('close',code=>{
      cleanup();
      if(signal?.aborted)return reject(Error('Blender check cancelled.'));
      if(timedOut)return reject(Error('Blender startup/render check timed out. Check the executable and try again.'));
      if(tooLarge)return reject(Error('Blender returned too much diagnostic output. Check the executable.'));
      try {
        const result=JSON.parse(output.trim());
        if(!result || typeof result!=='object' || Array.isArray(result))throw Error('Blender returned an invalid diagnostic response.');
        if(code!==0 || !result.ok)throw Error(result.error || errors.trim() || 'Blender could not start.');
        if(result.headless!==true || result.rendered!==true || !Number.isInteger(result.previewBytes) || result.previewBytes<8 ||
          typeof result.version!=='string' || !result.version.trim() || typeof result.executable!=='string' || !result.executable.trim() ||
          !Number.isInteger(result.objects) || result.objects<0)throw Error('Blender did not verify a headless PNG render and scene response.');
        resolve(result);
      }catch(error){reject(Error(error instanceof SyntaxError ? (errors.trim() || 'Blender returned an invalid diagnostic response.') : error.message));}
    });
    if(signal?.aborted)stop();
  });
}
module.exports={diagnose};
