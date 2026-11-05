/* Owns per-task policy, context, queue persistence and local measurements. */
globalThis.ZSWorkflow=(()=>{
  'use strict';
  const T=ZSTasks;
  const DEEPSEEK_PACES=Object.freeze({
    off:Object.freeze({mode:'off',pauseMs:0,gapMs:0,description:'No extra delay. Provider limits and verification still stop the agent.'}),
    quick:Object.freeze({mode:'quick',pauseMs:700,gapMs:4000,description:'Quick: 0.7s pause; at least 4s between automated sends.'}),
    natural:Object.freeze({mode:'natural',pauseMs:1400,gapMs:8000,description:'Natural: 1.4s pause; at least 8s between automated sends.'}),
    careful:Object.freeze({mode:'careful',pauseMs:2500,gapMs:14000,description:'Careful: 2.5s pause; at least 14s between automated sends.'}),
  });
  function deepseekPaceMode(value,legacy){
    if(typeof value==='string'&&Object.hasOwn(DEEPSEEK_PACES,value))return value;
    if(legacy===true)return 'natural';
    if(legacy===false)return 'off';
    return 'natural';
  }
  // Save each task checkpoint locally before forwarding it to the desktop broker.
  // The desktop remains the authoritative project store; this is a retry outbox,
  // so a bridge restart or page reload cannot silently discard a final outcome.
  function createOutbox({storage,send,onError=()=>{},onRecovered=()=>{},now=()=>Date.now(),later=setTimeout,clear=clearTimeout}){
    const prefix='zsProjectOutbox:',items=new Map(),writes=new Map();
    let running=false,timer=null;
    const keyOf=record=>prefix+[record.project.profile,record.project.id,record.id].map(encodeURIComponent).join(':');
    const lane=(key,operation)=>{
      const next=(writes.get(key)||Promise.resolve()).catch(()=>{}).then(operation);
      writes.set(key,next);next.finally(()=>{if(writes.get(key)===next)writes.delete(key);}).catch(()=>{});
      return next;
    };
    const ready=storage.get(null).then(values=>{
      for(const [key,record] of Object.entries(values||{})){
        if(key.startsWith(prefix)&&record?.project?.id&&record?.project?.profile&&record?.id)
          items.set(key,{record,attempt:0,nextAt:0});
      }
    }).catch(error=>onError(Error('Local checkpoint recovery failed: '+error.message)));
    function schedule(){
      if(timer!==null){clear(timer);timer=null;}
      if(running||!items.size)return;
      const nextAt=Math.min(...[...items.values()].map(item=>item.nextAt));
      timer=later(()=>{timer=null;void drain();},Math.max(0,nextAt-now()));
    }
    async function drain(){
      if(running)return;running=true;
      try{
        while(items.size){
          const entry=[...items].find(([,item])=>item.nextAt<=now());
          if(!entry)break;
          const [key,item]=entry;
          try{
            await send(item.record);
            if(items.get(key)!==item)continue; // A final outcome replaced a running checkpoint.
            await lane(key,()=>storage.remove(key));
            if(items.get(key)===item)items.delete(key);
            if(!items.size)onRecovered();
          }catch(error){
            if(items.get(key)!==item)continue;
            item.attempt++;
            item.nextAt=now()+Math.min(30000,1000*2**Math.min(5,item.attempt-1));
            onError(error);
          }
        }
      }finally{running=false;schedule();}
    }
    void ready.then(schedule);
    async function enqueue(record){
      await ready;
      const key=keyOf(record),item={record,attempt:0,nextAt:0};
      items.set(key,item);
      try{await lane(key,()=>storage.set({[key]:record}));}
      catch(error){onError(Error('Local checkpoint could not be saved: '+error.message));throw error;}
      schedule();
    }
    return {enqueue,ready,flush:async()=>{await ready;await drain();},pending:()=>items.size};
  }
  function create({P,bg,getSkills,canRun,submit,runLoop,onResume,getProject=()=>null,onCheckpoint=()=>{}}) {
    let scriptMode='roblox',deliveredScript='roblox',profileSaving=false;
    let preparation=null;
    let active=null,pending=null,history=[],root=null,dock=null,key='',loading=null,storageError='',librarySize=-1;
    let queueSearch='',autoPlaytest=false,deepseekMode='natural',playtestReport=null;
    const cache=new Map(),reads=new Map(),deliveredContexts=new Map();let historyWrite=Promise.resolve(),queueWrite=Promise.resolve();
    const store=chrome.storage.local;
    const projectOutbox=createOutbox({storage:store,send:onCheckpoint,
      onError:error=>{storageError='Project handoff pending retry: '+error.message;render();},
      onRecovered:()=>{if(storageError.startsWith('Project handoff pending retry:')){storageError='';render();}}
    });
    const queue=new ZSCowork.Queue({
      canRun,run:async job=>{
        P.setInputLock(true);
        try {
          if(job.images?.length && !P.supportsVision && P.id!=='chatgpt')
            throw Error(`${P.displayName||P.id} cannot receive Cowork photos in this chat. Use an image-capable provider or remove the photos.`);
          const task=await begin(job.text,job.id);
          if(task.outcome!=='running')throw Error('Task cancelled before submission.');
          if(task.conversation!==P.conversationKey())throw Error('Conversation changed during preparation. No queued prompt was sent.');
          const base=await submit(`${job.text}\n\n⟦ZS-TASK⟧\n${contextEnvelope(task)}`,job.images||[],true);
          delivered(task);
          await runLoop(base);return {outcome:task.outcome};
        }catch(error){if(active)finalise(active.outcome==='cancelled'?'cancelled':'failed');throw error;}
        finally{P.setInputLock(false);}
      },
      save:snapshot=>{
        if(!snapshot.key)return Promise.resolve();
        queueWrite=queueWrite.catch(()=>{}).then(()=>store.set({['zsCoworkQueue:'+snapshot.key]:{...snapshot,savedAt:Date.now()}}));return queueWrite;
      },onChange:()=>render(),
    });
    const ready=store.get(['zsTaskHistory','zsScriptProfile','zsAutoPlaytest','zsDeepseekPacing','zsDeepseekPaceMode','zsPlaytestReport']).then(value=>{autoPlaytest=value.zsAutoPlaytest===true;deepseekMode=deepseekPaceMode(value.zsDeepseekPaceMode,value.zsDeepseekPacing);playtestReport=value.zsPlaytestReport||null;scriptMode=T.scriptMode(value.zsScriptProfile);history=Array.isArray(value.zsTaskHistory)?value.zsTaskHistory.slice(-100):[];render();}).catch(()=>{storageError='Extension storage unavailable. Queue is paused.';queue.pause();render();});
    function latestPrompt(){return String(P.editorText?.()||'').trim()||P.allItems().filter(item=>P.isUserItem(item)&&!ZSParse.isInjectedFeedback(P.itemText(item))).map(item=>P.itemText(item)).at(-1)||'';}
    function captureManual() {
      if(active||pending)return;
      // This hook runs before the site's send handler, so retain the prompt and
      // selection now instead of reading a cleared editor 300ms later.
      pending={text:latestPrompt(),scriptMode,sentAt:performance.now()};
    }
    function readSkill(skill) {
      // Skills are local shared files, not conversation state. Reuse across chats
      // for the same short TTL; changed library metadata gets a different key.
      const key=JSON.stringify([skill.folder,skill.name||'',skill.description||'']);
      const cached=cache.get(key);
      if(cached&&Date.now()-cached.at<120000)return {promise:Promise.resolve({ok:true,text:cached.text}),fresh:false};
      if(reads.has(key))return {promise:reads.get(key),fresh:false};
      if(reads.size>=4)return {promise:Promise.resolve({ok:false,error:'Skill prefetch is busy; load this file on demand.'}),fresh:false};
      const promise=Promise.resolve().then(()=>bg({type:'call_tool',name:'feather_getskills',arguments:{skill:skill.folder,main_only:true},timeout:5000},6000))
        .then(result=>{
          const text=String(result?.text||'');
          if(result?.ok&&text.length<=T.CONTEXT_CHARS){cache.set(key,{text,at:Date.now()});if(cache.size>60)cache.delete(cache.keys().next().value);}
          return result;
        },error=>({ok:false,error:String(error?.message||error)})).finally(()=>reads.delete(key));
      reads.set(key,promise);return {promise,fresh:true};
    }
    function waitForContext(promise,signal,ms) {
      return new Promise(resolve=>{
        let finished=false;
        const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);resolve(value);};
        const abort=()=>finish({ok:false,error:'Context loading cancelled.'});
        const timer=setTimeout(()=>finish({ok:false,error:'Prefetch budget reached; load this skill on demand.'}),Math.max(0,ms));
        signal.addEventListener('abort',abort,{once:true});
        promise.then(finish,error=>finish({ok:false,error:String(error?.message||error)}));
        if(signal.aborted)abort();
      });
    }
    async function begin(text,id,sentAt=null,profile) {
      await ready;
      if(active)return preparation||active;
      const task=T.createTask({text,provider:P.id,conversation:P.conversationKey(),id});
      task.autoPlaytest=autoPlaytest;task.scriptMode=T.scriptMode(profile??scriptMode);task.controller=new AbortController();active=task;
      task.projectPrompt=String(text||'').slice(0,3000);
       preparation=(async()=>{try{task.project=await getProject(task.conversation,task.scriptMode,task.projectPrompt);}catch(error){storageError='Automatic project memory unavailable: '+error.message;}
        if(task.controller.signal.aborted)return task;saveProject(task,'running');return prepare(task,text,sentAt);
      })().finally(()=>{if(active===task)preparation=null;});
      return preparation;
    }
    async function prepare(task,text,sentAt) {
      task.startedAtPerformance=performance.now();task._sentAt=sentAt;
      task.metrics.aiRoundTrips=sentAt===null?0:1;
      task.policyDelivered=task.scriptMode===deliveredScript;task.context='';
      task.selectedSkills=T.selectSkills(text,T.skillsForProfile(getSkills(),task.scriptMode));task.contextSkills=[];render();
      const started=performance.now(),deadline=started+T.CONTEXT_PREFETCH_MS;
      try {
        const [fingerprint,results]=await Promise.all([crypto.subtle.digest('SHA-256',new TextEncoder().encode(text.trim())),Promise.all(task.selectedSkills.map(async skill=>{
          if(task.controller.signal.aborted)return {skill,result:{ok:false}};
          const read=readSkill(skill),at=performance.now();
          if(read.fresh)task.metrics.toolCalls++;
          const result=await waitForContext(read.promise,task.controller.signal,deadline-performance.now());
          return {skill,result,elapsed:read.fresh?performance.now()-at:0};
        }))]);
        task.fingerprint=[...new Uint8Array(fingerprint)].map(value=>value.toString(16).padStart(2,'0')).join('');
        if(active!==task||task.controller.signal.aborted)return task;
        const deferred=[];
        // Deterministic skill order regardless of which concurrent read finishes first.
        for(const {skill,result,elapsed} of results){
          task.metrics.toolMs+=elapsed||0;
          if(!result?.ok){deferred.push(skill.folder);continue;}
          const text=String(result.text||''),prior=deliveredContexts.get(contextKey(task,skill.folder)),turn=turnCount();
          if(prior&&prior.text===text&&Date.now()-prior.at<120000&&turn!==null&&turn>=prior.turn&&turn-prior.turn<=8){task.metrics.skillsLoaded++;task.metrics.skillsReused++;continue;}
          const block='\nRelevant skill '+skill.folder+':\n'+text+'\n';
          if(task.context.length+block.length>T.CONTEXT_CHARS){deferred.push(skill.folder);continue;}
          task.context+=block;task.contextSkills.push({folder:skill.folder,text});task.metrics.skillsLoaded++;
        }
        if(deferred.length)task.contextWarning='Not preloaded: '+deferred.join(', ')+'. Read these with feather_getskills if needed; do not assume their instructions were loaded.';
        if(task.context||task.contextWarning||task.scriptMode!==deliveredScript)task.policyDelivered=false;
      }catch(error){if(active===task&&!task.controller.signal.aborted){task.contextWarning=error.message;task.policyDelivered=false;}}
      finally{task.metrics.contextMs+=performance.now()-started;}
      render();return task;
    }
    function turnCount(){try{const n=P.assistantCount?.();return Number.isFinite(n)?n:null;}catch{return null;}}
    const contextKey=(task,folder)=>JSON.stringify([P.id,task.conversation,task.scriptMode,folder]);
    function delivered(task){
      task.policyDelivered=true;deliveredScript=task.scriptMode;
      const turn=turnCount();
      if(turn!==null&&task.conversation)for(const skill of task.contextSkills||[])deliveredContexts.set(contextKey(task,skill.folder),{text:skill.text,turn,at:Date.now()});
      while(deliveredContexts.size>32)deliveredContexts.delete(deliveredContexts.keys().next().value);
    }
    // Context delivery never changes native provider controls or completion safety.
    function contextEnvelope(task){return `${T.scriptPolicy(task.scriptMode)}\n${T.policy()}\n${T.taskGuidance(task)}${task.project?.notes||''}${task.context?`\n${task.context}`:''}${task.contextWarning?`\nContext limitation: ${task.contextWarning}`:''}`;}
    function canContinue(){return !active||active.outcome==='running';}
    async function beginManual(){const data=pending||{text:latestPrompt()};pending=null;return begin(data.text,undefined,data.sentAt,data.scriptMode);}
    function saveProject(task,outcome){
      if(!task.project)return;
      let reply='';
      if(outcome!=='running' && task.conversation===P.conversationKey())try{const text=P.itemText(P.lastAssistant());if(!ZSParse.hasToolSignature(text))reply=String(text).slice(0,3000);}catch{}
      void projectOutbox.enqueue({project:task.project,id:task.id,prompt:task.projectPrompt,reply,outcome})
        .catch(error=>{storageError='Project handoff could not be queued: '+error.message;render();});
    }
    function finalise(outcome) {
      if(!active)return;
      const task=active;task.controller.abort();
      if(task.indeterminate)outcome='indeterminate';
      else if(outcome==='completed' && task.toolsFailed)outcome='failed';
      const record=T.finish(task,outcome);history.push(record);history=history.slice(-100);active=null;pending=null;
      saveProject(task,outcome);
      historyWrite=historyWrite.catch(()=>{}).then(()=>store.set({zsTaskHistory:history.slice(-100)})).catch(()=>{storageError='Measurements could not be saved.';});render();
    }
    async function sync() {
      const count=getSkills().length;if(count!==librarySize){librarySize=count;render();}
      const next=`${P.id}|${P.conversationKey()||''}`;
      if(active && active.conversation && P.conversationKey() && active.conversation!==P.conversationKey()){active.outcome='cancelled';active.controller.abort();queue.pause();}
      if(next!==key&&!loading) {
        key=next;queue.pause();
        loading=store.get('zsCoworkQueue:'+next).then(value=>{if(key===next)queue.restore(next,value['zsCoworkQueue:'+next]||{});}).catch(()=>{storageError='Queue could not be loaded.';}).finally(()=>{loading=null;render();});
      }
      if(!loading && !storageError && !active&&!pending && !queue.busy && queue.enabled && !queue.paused && canRun()) {
        if(!navigator.locks){queue.pause();storageError='This browser cannot provide the cross-tab queue lock. Use normal chat tasks.';render();return;}
        navigator.locks.request('featherscript-cowork:'+key,{ifAvailable:true},async lock=>{
          if(!lock)return;
          await queue.write;
          const value=await store.get('zsCoworkQueue:'+key),saved=value['zsCoworkQueue:'+key];
          const first=queue.jobs.find(job=>job.status==='queued');
          if(first && saved?.jobs?.some(job=>job.id===first.id && job.status!=='queued')){queue.restore(key,saved);return;}
          await queue.pump();
        }).catch(error=>{queue.pause();storageError=error.message;render();});
      }
    }
    function makeProfile(){
      const profiles=document.createElement('div');profiles.id='zs-script-profile';profiles.dataset.profileVersion='2';profiles.setAttribute('role','group');profiles.setAttribute('aria-label','Workspace for next task');
      for(const [mode,label,mark,description] of [['roblox','RobloxScript','◇','Build and script in Roblox Studio'],['agent','AgentScript','⌘','Work with local files and tools']]){
        const button=document.createElement('button');button.type='button';button.dataset.scriptMode=mode;button.title=description;
        const icon=document.createElement('span');icon.className='zs-profile-mark';icon.setAttribute('aria-hidden','true');icon.textContent=mark;
        const name=document.createElement('span');name.className='zs-profile-label';name.textContent=label;
        const state=document.createElement('span');state.className='zs-profile-state';state.setAttribute('aria-hidden','true');state.textContent='ACTIVE';
        button.append(icon,name,state);
        button.addEventListener('click',async()=>{await ready;if(profileSaving||scriptMode===mode)return;const previous=scriptMode;profileSaving=true;scriptMode=mode;render();try{await store.set({zsScriptProfile:mode});storageError='';}catch{scriptMode=previous;storageError='Profile could not be saved.';}finally{profileSaving=false;render();}});
        profiles.append(button);
      }
      return profiles;
    }
    // The bar is rebuilt / re-rendered by the host page in ways we don't control
    // (SPA navigation, extension update, a stale duplicate root). If the profile
    // control goes missing, render() used to die on `null.title` INSIDE the agent
    // loop and abort the task with "Internal loop error". Re-create it instead.
    function ensureProfile(){
      if(!root)return null;
      const barScope=dock||root;
      const matches=[...barScope.querySelectorAll('#zs-script-profile')];
      const existing=matches.find(node=>{const buttons=[...node.querySelectorAll('[data-script-mode]')];return node.dataset.profileVersion==='2'&&buttons.length===2&&buttons.some(button=>button.dataset.scriptMode==='roblox')&&buttons.some(button=>button.dataset.scriptMode==='agent');});
      for(const node of matches)if(node!==existing)node.remove();
      if(existing)return existing;
      const top=barScope.querySelector('.zs-top');
      if(!top)return null;
      const profiles=makeProfile();
      try{top.insertBefore(profiles,barScope.querySelector('#zs-conn'));}
      catch{try{top.append(profiles);}catch{return null;}}
      return profiles;
    }
    function mount(element, barElement=null) {
      if(!element)return;
      // In-flow providers move the dock outside the root that owns the panels.
      dock=barElement;
      const barScope=dock||element;
      const actions=barScope.querySelector('.zs-acts');
      if(!actions)return;
      if(root===element && element.querySelector('#zs-workflow-panel')){render();return;}
      root=element;
      ensureProfile();
      const permissions=document.createElement('button');permissions.type='button';permissions.id='zs-pc-permissions';permissions.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3l8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg><span>PC permissions</span>';permissions.title='Both profiles use the desktop PC permission policy. Open Settings to configure it.';permissions.addEventListener('click',()=>barScope.querySelector('#zs-settings')?.click());actions.append(permissions);
      const toggle=document.createElement('button');toggle.type='button';toggle.id='zs-cowork-toggle';toggle.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/><path d="M11 7h4a2 2 0 0 1 2 2v4"/></svg><span data-cowork-caption>Cowork</span>';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','zs-workflow-panel');actions.append(toggle);
      const panel=document.createElement('section');panel.id='zs-workflow-panel';panel.hidden=true;panel.setAttribute('aria-label','Cowork queue and task activity');
      panel.innerHTML=`<header class="zs-cw-header"><div><span class="zs-cw-eyebrow">FEATHERSCRIPT / WORKSPACE</span><b>Cowork <em>Queue</em></b><small>Give your agent tasks and photos to work through.</small></div><button type="button" data-close aria-label="Close Cowork">×</button></header>
<div class="zs-cw-state"><i class="zs-cw-light" aria-hidden="true"></i><p data-task-status role="status"></p></div>
<form class="zs-cw-composer"><label for="zs-cw-task">YOUR NEXT TASK</label><textarea id="zs-cw-task" rows="4" maxlength="12000" placeholder="Describe what to build, inspect, or change…"></textarea><div class="zs-cw-draft-images" data-draft-images aria-label="Attached photos"></div><div class="zs-cw-composer-footer"><label class="zs-cw-upload"><input type="file" data-images accept="image/png,image/jpeg,image/webp,image/gif" multiple aria-label="Attach photos to Cowork task"><span>＋ Attach photos</span></label><small data-image-note>Paste or drop photos here · up to 4</small></div><div class="zs-cw-send-row"><button type="submit" data-submit-run>▶ Add & run</button><button type="button" data-queue-only>Queue for later</button></div></form>
<div class="zs-starters" aria-label="Task starters"><button type="button" data-starter="inspect">Inspect first</button><button type="button" data-starter="organize">Organize</button><button type="button" data-starter="review">Review</button></div>
<section class="zs-cw-queue"><div class="zs-cw-section-title"><b>Task queue</b><span data-queue-summary>0 tasks</span></div><div class="zs-workflow-actions"><button type="button" data-resume>Resume</button><button type="button" data-pause>Pause</button></div><p data-queue-status role="status"></p><label class="zs-queue-search">Find a task<input type="search" data-search placeholder="Search queued and finished prompts"></label><button type="button" data-clear-finished>Clear completed</button><ol data-jobs></ol></section>
<details class="zs-automation-settings"><summary>Settings & checks</summary><label class="zs-cowork-enable"><input type="checkbox" data-enabled> Allow Cowork queue to run</label><label class="zs-cowork-enable"><input type="checkbox" data-autoplaytest> Auto Playtest after confirmed Roblox edits</label><small>Playtest runs a bounded smoke test. It cannot guarantee a bug-free game.</small><details data-playtest-report><summary>Latest playtest report</summary><pre data-report-body></pre></details><section class="zs-deepseek-pace" data-deepseek-setting hidden><div class="zs-pace-heading"><b>DeepSeek send pace</b><span>Automated turns</span></div><div class="zs-pace-options" role="group" aria-label="DeepSeek automated send pacing"><button type="button" data-deepseek-mode="off" aria-pressed="false">Off</button><button type="button" data-deepseek-mode="quick" aria-pressed="false">Quick</button><button type="button" data-deepseek-mode="natural" aria-pressed="true">Natural</button><button type="button" data-deepseek-mode="careful" aria-pressed="false">Careful</button></div><small data-deepseek-note role="status"></small><small>Provider limits and verification still apply.</small></section></details>
<details class="zs-cw-history"><summary>Local task activity</summary><p data-current></p><div data-metrics></div><button type="button" data-export>Export metrics</button><small>Local timings and skill context; provider computation is not measured.</small></details>`;
      element.append(panel);
      const bar=dock||element.querySelector('#zs-bar');
      const skillStatus=document.createElement('span');skillStatus.id='zs-skill-status';skillStatus.title='Relevant main instructions load automatically; references stay available on demand.';bar.querySelector('.zs-status-row').insertBefore(skillStatus,bar.querySelector('.zs-acts'));
      const tray=document.createElement('section');tray.id='zs-utilities';tray.hidden=true;tray.setAttribute('aria-label','More FeatherScript actions');tray.append(permissions);
      for(const [id,label] of [['zs-switch','Switch AI'],['zs-prompt','Custom prompt'],['zs-discord','Community'],['zs-support','Support']]){const control=barScope.querySelector('#'+id);if(!control)continue;const text=document.createElement('span');text.textContent=label;control.append(text);tray.append(control);}
      const more=document.createElement('button');more.type='button';more.id='zs-utilities-toggle';more.textContent='•••';more.setAttribute('aria-label','More FeatherScript actions');more.setAttribute('aria-controls',tray.id);more.setAttribute('aria-expanded','false');actions.append(more);element.append(tray);
      const closeTray=()=>{tray.hidden=true;more.setAttribute('aria-expanded','false');};
      more.addEventListener('click',()=>{tray.hidden=!tray.hidden;more.setAttribute('aria-expanded',String(!tray.hidden));if(!tray.hidden){const rect=bar.getBoundingClientRect();tray.style.bottom=Math.max(12,innerHeight-rect.top+10)+'px';tray.style.right=Math.max(12,innerWidth-more.getBoundingClientRect().right)+'px';tray.querySelector('button,a')?.focus();}});
      tray.addEventListener('click',event=>{if(event.target.closest('button,a'))closeTray();});
      document.addEventListener('click',event=>{if(!tray.hidden&&!tray.contains(event.target)&&!more.contains(event.target))closeTray();});
      tray.addEventListener('keydown',event=>{if(event.key==='Escape'){closeTray();more.focus();}});

      // The browser's top layer keeps Cowork above provider overlays and stacking contexts.
      if (typeof panel.showPopover === 'function') panel.setAttribute('popover', 'manual');
      const close = () => {
        if (typeof panel.hidePopover === 'function' && panel.matches(':popover-open')) panel.hidePopover();
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus({ preventScroll: true });
      };
      toggle.addEventListener('click', event => {
        event.stopPropagation();
        if (!panel.hidden) {
          close();
          return;
        }
        panel.hidden = false;
        positionPanel();
        if (panel.hasAttribute('popover')) {
          try { panel.showPopover(); }
          catch { panel.removeAttribute('popover'); }
        }
        toggle.setAttribute('aria-expanded', 'true');
        panel.querySelector('textarea')?.focus({ preventScroll: true });
      });
      panel.querySelector('[data-close]').addEventListener('click', close);
      panel.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      });
      const feedback=message=>{panel.querySelector('[data-queue-status]').textContent=message;};
      const saveOption=async(key,value)=>{try{await store.set({[key]:value});return true;}catch{storageError='Setting could not be saved.';render();return false;}};
      panel.querySelector('[data-autoplaytest]').addEventListener('change',async event=>{const value=event.target.checked;if(await saveOption('zsAutoPlaytest',value))autoPlaytest=value;render();});
      for(const button of panel.querySelectorAll('[data-deepseek-mode]'))button.addEventListener('click',async()=>{
        const mode=button.dataset.deepseekMode;
        if(!Object.hasOwn(DEEPSEEK_PACES,mode))return;
        if(await saveOption('zsDeepseekPaceMode',mode))deepseekMode=mode;
        render();
      });
      panel.querySelector('[data-enabled]').addEventListener('change',event=>{queue.setEnabled(event.target.checked);void sync();});
      const composer=panel.querySelector('.zs-cw-composer');
      const editor=panel.querySelector('textarea');
      const picker=panel.querySelector('[data-images]');
      const previews=panel.querySelector('[data-draft-images]');
      const runButton=panel.querySelector('[data-submit-run]');
      const laterButton=panel.querySelector('[data-queue-only]');
      let draftImages=[],imageBusy=false,submitting=false;
      const photosAllowed=()=>!!P.supportsVision||P.id==='chatgpt';
      const previewDraft=()=>{
        previews.replaceChildren();
        for(const [index,photo] of draftImages.entries()){
          const tile=document.createElement('div');tile.className='zs-cw-photo';
          const thumbnail=document.createElement('img');thumbnail.src=`data:${photo.mimeType};base64,${photo.data}`;thumbnail.alt=photo.name;
          const label=document.createElement('small');label.textContent=photo.name;label.title=photo.name;
          const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Remove ${photo.name}`);
          remove.addEventListener('click',()=>{draftImages.splice(index,1);previewDraft();});
          tile.append(thumbnail,label,remove);previews.append(tile);
        }
        previews.hidden=!draftImages.length;
        const allowed=photosAllowed();
        const unavailable=!allowed?`${P.displayName||P.id} cannot accept photos from Cowork.`:'';
        panel.querySelector('[data-image-note]').textContent=imageBusy?'Processing photos…':unavailable||(draftImages.length?`${draftImages.length} of ${ZSCowork.MAX_IMAGES} photos attached`:'Paste or drop photos here · up to 4');
        picker.disabled=imageBusy||submitting||!allowed||draftImages.length>=ZSCowork.MAX_IMAGES;
        runButton.disabled=laterButton.disabled=imageBusy||submitting;
        composer.classList.toggle('zs-cw-processing',imageBusy||submitting);
      };
      const attachFiles=async(files)=>{
        if(!files.length)return;
        if(!photosAllowed()){feedback(`${P.displayName||P.id} does not support photo uploads. Switch to an image-capable chat.`);return;}
        if(imageBusy||submitting){feedback('Finish the current photo or task save before adding more.');return;}
        imageBusy=true;previewDraft();
        try{
          if(files.length+draftImages.length>ZSCowork.MAX_IMAGES)throw Error(`Attach at most ${ZSCowork.MAX_IMAGES} photos per task.`);
          const additions=[];
          for(const file of files){
            const photo=await ZSCowork.imageFromFile(file);
            additions.push(photo);
          }
          draftImages=ZSCowork.validateImages([...draftImages,...additions]);
          feedback(`${additions.length} photo${additions.length===1?'':'s'} ready. Add a prompt or send the photos alone.`);
        }catch(error){feedback(`Photo not attached: ${error.message||error}`);}
        finally{imageBusy=false;picker.value='';previewDraft();}
      };
      picker.addEventListener('change',event=>{void attachFiles([...event.target.files||[]]);});
      composer.addEventListener('paste',event=>{
        const files=[...(event.clipboardData?.files||[])].filter(file=>file.type?.startsWith('image/'));
        if(files.length){event.preventDefault();void attachFiles(files);}
      });
      composer.addEventListener('dragover',event=>{if(event.dataTransfer?.types?.includes('Files')){event.preventDefault();composer.classList.add('zs-cw-dragging');}});
      composer.addEventListener('dragleave',()=>composer.classList.remove('zs-cw-dragging'));
      composer.addEventListener('drop',event=>{composer.classList.remove('zs-cw-dragging');if(event.dataTransfer?.files?.length){event.preventDefault();void attachFiles([...event.dataTransfer.files]);}});
      const submitDraft=async(startNow)=>{
        if(imageBusy||submitting)return;
        submitting=true;previewDraft();
        try{
          await ready;
          await sync();if(loading)await loading;
          if(!P.conversationKey())throw Error('Open or start a provider conversation before adding Cowork tasks.');
          if(draftImages.length&&!photosAllowed())throw Error('This chat cannot receive photos. Remove them or switch to an image-capable provider.');
          const job=queue.add(editor.value,draftImages);
          try{await queue.write;}
          catch(error){queue.remove(job.id);throw Error('Task could not be saved locally: '+(error.message||error));}
          editor.value='';draftImages=[];
          if(startNow){
            onResume?.();
            if(!queue.enabled)queue.setEnabled(true);
            queue.resume();await queue.write;
            feedback(canRun()?'Task saved. Cowork will start when the provider is idle.':'Task saved and queued. Press Start on the FeatherScript bar and connect the desktop bridge to run it.');
            void sync();
          }else feedback('Task and photos saved. Press Resume to run the queue later.');
        }catch(error){feedback(error.message||String(error));}
        finally{submitting=false;previewDraft();render();}
      };
      composer.addEventListener('submit',event=>{event.preventDefault();void submitDraft(true);});
      laterButton.addEventListener('click',()=>{void submitDraft(false);});
      panel.querySelector('[data-resume]').addEventListener('click',async()=>{
        try{await ready;await sync();if(loading)await loading;onResume?.();if(!queue.enabled)queue.setEnabled(true);queue.resume();await queue.write;feedback(canRun()?'Queue resumed. Waiting for an idle provider.':'Queue resumed. Press Start on the FeatherScript bar and connect the desktop bridge to run it.');void sync();}
        catch(error){feedback(error.message||String(error));}
      });
      editor.addEventListener('keydown',event=>{if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();composer.requestSubmit();}});
      previewDraft();
      panel.querySelector('[data-search]').addEventListener('input',event=>{queueSearch=event.target.value.toLowerCase();render();});
      panel.querySelector('[data-clear-finished]').addEventListener('click',()=>{for(const job of [...queue.jobs])if(job.status==='completed')queue.remove(job.id);feedback('Completed tasks cleared. Failed and uncertain tasks remain for review.');});
      for(const button of panel.querySelectorAll('[data-starter]'))button.addEventListener('click',()=>{const agent=scriptMode==='agent';const prompts={inspect:agent?'Inspect the files in the folder I specify and summarize what is there. Ask me for the folder path before accessing it.':'Inspect my Roblox Studio project structure and summarize it without making changes.',organize:agent?'Help organize a folder. Ask for its path, inspect it and propose a plan before moving files.':'Organize the selected Roblox objects into a clear model hierarchy. Inspect the selection first.',review:agent?'Review a local script for bugs. Ask me for its file path, then read it without changing it.':'Review the selected Roblox script for bugs and performance problems without modifying it.'};const editor=panel.querySelector('textarea');editor.value=prompts[button.dataset.starter];editor.focus();});
      panel.querySelector('[data-pause]').addEventListener('click',()=>{queue.pause();feedback('Queue paused. The current task continues; Stop cancels it.');});
      panel.querySelector('[data-export]').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(history,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='featherscript-task-metrics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
      window.addEventListener('resize',positionPanel);
      if(globalThis.ZSAudioUI){const music=document.createElement('button');music.type='button';music.id='zs-music';music.dataset.fsMusic='';music.textContent='♫';music.setAttribute('aria-label','Play ambient music');actions.append(music);ZSAudioUI.mount(barScope);}
      render();sync();
    }
    function positionPanel(){if(!root)return;const panel=root.querySelector('#zs-workflow-panel');const bar=dock||root.querySelector('#zs-bar');if(!panel||!bar||panel.hidden)return;const top=bar.getBoundingClientRect().top;const bottom=top>260?innerHeight-top+12:18;panel.style.bottom=bottom+'px';panel.style.maxHeight=Math.max(0,innerHeight-bottom-12)+'px';}
    // render() runs synchronously inside the agent loop (beginManual/delivered/
    // recordSend). A host re-render or extension update can strip our nodes, and
    // the old version threw `Cannot set properties of null (setting 'title')`,
    // which surfaced as "Internal loop error" mid-task. Heal what we can and
    // never let panel chrome abort a run.
    function render() {
      try { renderPanel(); }
      catch (error) { console.warn('[zs-workflow] render skipped:', (error && error.message) || error); }
    }
    function renderPanel() {
      if(!root)return;
      root.dataset.scriptProfile=scriptMode;
      const profile=ensureProfile();
      if(profile)for(const button of profile.querySelectorAll('[data-script-mode]')){
        const selected=button.dataset.scriptMode===scriptMode;
        button.setAttribute('aria-pressed',String(selected));
        button.setAttribute('aria-label',`${button.dataset.scriptMode==='agent'?'AgentScript':'RobloxScript'}${selected?' (active)':''}`);
        button.disabled=profileSaving;
      }
      if(profile)profile.title=active?`Running ${active.scriptMode==='agent'?'AgentScript':'RobloxScript'}. Selection applies to the next task.`:'PC access in both profiles follows desktop permissions.';
      const panel=root.querySelector('#zs-workflow-panel');if(!panel)return;
      panel.querySelector('[data-enabled]').checked=queue.enabled;
      panel.querySelector('[data-autoplaytest]').checked=autoPlaytest;
      panel.querySelector('[data-deepseek-setting]').hidden=P.id!=='deepseek';
      for(const button of panel.querySelectorAll('[data-deepseek-mode]'))button.setAttribute('aria-pressed',String(button.dataset.deepseekMode===deepseekMode));
      panel.querySelector('[data-deepseek-note]').textContent=DEEPSEEK_PACES[deepseekMode].description;
      panel.querySelector('[data-report-body]').textContent=playtestReport?JSON.stringify(playtestReport,null,2):'No automatic playtest has run.';
      const blocked=queue.jobs.findLast(job=>job.status==='failed'||job.status==='interrupted');
      if(queue.paused && blocked)panel.querySelector('[data-queue-status]').textContent=blocked.result==='indeterminate'?'Queue paused: a tool outcome is unknown. Inspect actual state before continuing.':blocked.status==='interrupted'?'Queue paused after reload. Review and remove the interrupted task before resuming.':('Queue paused after a failed task. '+(blocked.error||'Review its result before resuming.'));
      const queuedCount=queue.jobs.filter(job=>job.status==='queued').length;
      const runningCount=queue.jobs.filter(job=>job.status==='running').length;
      const finishedCount=queue.jobs.filter(job=>['completed','failed','interrupted','cancelled'].includes(job.status)).length;
      panel.querySelector('[data-queue-summary]').textContent=`${queuedCount} waiting · ${runningCount} running · ${finishedCount} finished`;
      panel.querySelector('[data-task-status]').textContent=storageError||(active?`Running ${active.scriptMode==='agent'?'AgentScript':'RobloxScript'} · ${active.metrics.skillsLoaded} relevant skills loaded.`:queuedCount?(queue.paused?'Queue paused. Press Resume when ready.':!canRun()?'Queued. Start FeatherScript and connect the desktop bridge to run.':'Queued and ready for the next idle turn.'):'No task running. Add a prompt or photos to get started.');
      const skillStatus=(dock||root).querySelector('#zs-skill-status');if(skillStatus)skillStatus.textContent=`${getSkills().length} skills`;
      const caption=(dock||root).querySelector('[data-cowork-caption]');if(caption)caption.textContent=`Cowork${queue.jobs.some(job=>job.status==='queued')?' · '+queue.jobs.filter(job=>job.status==='queued').length:''}`;
      positionPanel();
      const list=panel.querySelector('[data-jobs]');list.replaceChildren();
      for(const job of queue.jobs.filter(job=>!queueSearch||job.text.toLowerCase().includes(queueSearch)).slice(-30)) {
        const item=document.createElement('li'),title=document.createElement('span');title.textContent=job.text.slice(0,140);const status=document.createElement('small');const imageCount=job.imageCount||job.images?.length||0;status.textContent=`${job.status}${imageCount?` · ${imageCount} photo${imageCount===1?'':'s'}`:''}${job.result==='indeterminate'?' (outcome unknown)':''}${job.error?' · '+job.error:''}`;item.append(title,status);const copy=document.createElement('button');copy.type='button';copy.textContent='Copy';copy.setAttribute('aria-label','Copy task prompt');copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(job.text);feedback('Prompt copied.');}catch{feedback('Clipboard unavailable. Expand and select the prompt to copy it.');}});item.append(copy);if(job.text.length>140){const detail=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Full prompt';const prompt=document.createElement('p');prompt.textContent=job.text;prompt.style.whiteSpace='pre-wrap';detail.append(summary,prompt);item.append(detail);}
        if(job.status!=='running'){for(const [label,action] of [['Remove',()=>queue.remove(job.id)],...(job.status==='queued'?[['↑',()=>queue.move(job.id,-1)],['↓',()=>queue.move(job.id,1)]]:[])]){const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',label==='↑'?'Move task up':label==='↓'?'Move task down':'Remove task');button.addEventListener('click',action);item.append(button);}}
        list.append(item);
      }
      panel.querySelector('[data-current]').textContent=active?`Current: ${active.metrics.aiRoundTrips} AI turns · ${active.metrics.toolCalls} tool calls · ${active.metrics.skillsLoaded===null?'unscoped library':active.metrics.skillsLoaded+' skills'} loaded`:'No active task.';
      const metrics=panel.querySelector('[data-metrics]');metrics.replaceChildren();
      const samples=history.filter(item=>item.metrics);const row=document.createElement('p');row.textContent=`${samples.length} recorded tasks · ${samples.filter(item=>item.outcome==='completed').length} completed`;metrics.append(row);
    }
    chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes.zsAutoPlaytest){autoPlaytest=changes.zsAutoPlaytest.newValue===true;render();}if(area==='local'&&changes.zsDeepseekPaceMode){deepseekMode=deepseekPaceMode(changes.zsDeepseekPaceMode.newValue);render();}if(area==='local'&&changes.zsScriptProfile){scriptMode=T.scriptMode(changes.zsScriptProfile.newValue);render();}});
    return {get deepseekPace(){return P.id==='deepseek'?DEEPSEEK_PACES[deepseekMode]:null;},async reportPlaytest(report){playtestReport=report;await store.set({zsPlaytestReport:report});render();},ready,mount,sync,captureManual,beginManual,begin,finalise,contextEnvelope,render,queue,get scriptMode(){return active?.scriptMode||scriptMode;},get active(){return active;},delivered,cancel(){if(active){active.outcome='cancelled';active.controller.abort();}},markProfileDelivered(){deliveredScript=scriptMode;},pause(){queue.pause();pending=null;},recordSend(sentAt){if(active){active.metrics.aiRoundTrips++;active._sentAt ??= sentAt ?? performance.now();}},recordResponse(first,generation){if(active){active.metrics.generationMs+=generation??0;if(active.metrics.timeToFirstResponseMs===null&&first!==null)active.metrics.timeToFirstResponseMs=first;}},policy(){return T.scriptPolicy(active?.scriptMode||scriptMode)+'\n'+T.policy();}};
  }
  return {create,createOutbox,deepseekPaceMode,DEEPSEEK_PACES};
})();
