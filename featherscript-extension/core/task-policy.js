/* One task pipeline. Provider model and native thinking controls remain untouched. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZSTasks=api;})(globalThis,()=>{
  'use strict';
  const CONTEXT_CHARS=18000,MAX_PREFETCH_SKILLS=2,CONTEXT_PREFETCH_MS=1500;
  const bare=name=>String(name||'').split('/').pop();
  const readOnly=name=>!/^pc_text_(replace_regex|sort_lines|dedupe_lines)$/.test(bare(name))&&(/^(rbx_(get|audit)_|pc_(file_(hash|head|tail|byte_sample)$|compare_files$|find_(text|duplicates)$|detect_encoding$|directory_|json_(read|format|validate|query|diff|to_csv)$|csv_|git_|text_|markdown_))/.test(bare(name))||/^(get_|find_|list_|read_|search_|stat_|inspect_|describe_|count_|script_(read|search|grep)|obsidian_(read|search|list)|pc_(read|list|search|stat|system_info)|feather_(get|read|search|list|capture))/.test(bare(name)));
  const contextTool=name=>readOnly(name)&&!/^get_console_output$/.test(bare(name));
  const scriptMode=value=>value==='agent'?'agent':'roblox';
  function allowsServer(profile, server = 'roblox') {
    if (server === 'roblox') return scriptMode(profile) === 'roblox';
    return ['computer', 'obsidian', 'blender', 'browser', 'context7', 'fetch', 'git', 'memory', 'sequential-thinking'].includes(server);
  }
  function allowsTool(profile, name, server = 'roblox') {
    const tool = bare(name);
    if (['list_commands', 'list_tools', 'list_mcp_servers', 'feather_getskills'].includes(tool) || /^(pc_|obsidian_)/.test(tool)) return true;
    return allowsServer(profile, server || 'roblox');
  }
  function skillsForProfile(library,profile){const skills=Array.isArray(library)?library:[];return scriptMode(profile)==='roblox'?skills:skills.filter(skill=>skill.scope==='pc'||/^pc[-_]/.test(skill.folder));}
  function complexity(text=''){if(/\b(village|city|entire|architecture|multiplayer|inventory system|combat system|multiple buildings|refactor|backend|migration|production|end.to.end)\b/i.test(text)||text.length>800)return 'complex';if(/\b(detailed|shop|building|entrance|windows|system|terrain|map|lighting)\b/i.test(text)||text.length>180)return 'medium';return 'simple';}
  function selectSkills(text,library){
    let query=String(text).toLowerCase();
    if(/\b(village|terrain|buildings?|roads?|map)\b/.test(query))query+=' world building environment assets';
    if(/\b(script|code|network|inventory|gameplay)\b/.test(query))query+=' scripting architecture performance';
    if(/\b(gui|interface|hud|menu)\b/.test(query))query+=' ui design';
    const vfx=/\b(vfx|particles?|beams?|auras?|explosions?|trails?|visual effects?|flipbooks?)\b/i.test(text);
    if(vfx)query+=' visual effects particles timing cleanup';
    // Explicit authoring routes outrank shared words such as build, rig or shop.
    let preferred='';
    if(/\beclipse\b/.test(query))preferred='eclipse-animator';
    else if(/\bblender\b/.test(query))preferred=/\b(animat\w*|rig|pose|keyframes?)\b/.test(query)?'ul-animation':'ul-3d-model';
    else if(/\bstud\b/.test(query)&&/\b(ui|hud|menu|shop|interface)\b/.test(query))preferred='stud-ui-clean';
    else if(/\b(harvest|curate|recipe|pack)\b/.test(query)&&/\b(vfx|particles?|effects?)\b/.test(query))preferred='ul-vfx-library';
    else if(/\b(exploit|exploits|exploitability)\b/.test(query))preferred='review-for-exploits';
    else if(/\b(continue|resume|handoff)\b/.test(query)&&/\b(game|project|development)\b/.test(query))preferred='ul-game-pipeline';
    else if(/\b(ui|gui|hud|interface|menu)\b/.test(query)&&/\b(polish|improve|better|graphics|spacing|typography|layout|responsive)\b/.test(query))preferred='roblox-ui';
    else if(!vfx&&!/\b(ui|gui|hud|interface|menu)\b/.test(query)&&(/\b(graphics|art direction|color grading|scene polish)\b/.test(query)||(/\b(lighting|materials|composition)\b/.test(query)&&/\b(polish|improve|better|realistic|cinematic)\b/.test(query))))preferred='roblox-graphics';
    else if(/\b(code|scripts?|luau)\b/.test(query)&&/\b(readable|readability|clean|comments|refactor)\b/.test(query))preferred='roblox-code';
    const words=new Set(query.match(/[a-z]{3,}/g)||[]);
    return (Array.isArray(library)?library:[]).map(skill=>{
      const terms=new Set(`${skill.folder} ${skill.name} ${skill.description}`.toLowerCase().match(/[a-z]{3,}/g)||[]);
      const score=[...words].filter(word=>terms.has(word)&&!['the','and','with','for','this','create','make','from'].includes(word)).length+(vfx&&skill.folder==='roblox-vfx-mastery'?5:0)+(skill.folder===preferred?20:0);
      return {skill,score};
    }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||String(a.skill.folder).localeCompare(String(b.skill.folder))).filter((item,index,ranked)=>index===0||item.score>=Math.max(2,ranked[0].score*0.6)).slice(0,MAX_PREFETCH_SKILLS).map(item=>item.skill);
  }
  function scriptPolicy(profile){return scriptMode(profile)==='agent'
    ? 'AgentScript focuses on local PC tasks, files, programs and notes. Exposed Blender tools may support requested local asset work. Roblox Studio tools are excluded. PC pairing and desktop permissions apply to every call. Use only listed tools and respect denied actions.'
    : 'RobloxScript focuses on Studio projects and exposed plugin operations. Shared PC tools may support requested assets and files under desktop permissions. Do not install or run unrequested plugins or programs. Exposed Blender tools may support requested modeling and animation. Optional integrations are available when enabled in the desktop MCP page.';}
  function taskGuidance(task){
    if(task.complexity==='complex')return 'For this substantial task: establish acceptance criteria and inspect the relevant current state. Map dependencies, constraints and failure modes; compare viable approaches internally. Give a short milestone plan, then complete cohesive changes end to end. Check error paths, integration points, performance and relevant edge cases against the criteria. Report observed verification and remaining gaps; do not confuse untested behavior with success.';
    if(task.complexity==='medium')return 'Inspect the relevant state, identify the finish criteria and choose a focused implementation plan. Complete the change, check its integration points and verify the requested behavior.';
    return 'For this small task, act directly and verify the changed behavior. Avoid unrelated exploration or unnecessary planning turns.';
  }
  function policy(){return 'Keep the selected AI model and its native thinking setting. Reason carefully internally before acting; provide concise decisions and evidence, not private deliberation. For substantial work, define acceptance criteria, map dependencies, evaluate alternatives and failure modes, then execute a coherent plan and verify against the criteria. Use relevant skills and task-specific context, reuse supplied skill instructions, and fetch supporting files only when needed. Keep small tasks direct. Prefer a listed safe batch over repetitive calls; request only the schemas you need and reuse confirmed results. Preserve security checks. Never invent tool results or report success before confirmed execution. Execute one command per reply unless one tool explicitly supports a safe batch. Never replay an uncertain write; inspect read-only state first.';}
  function createTask({text='',provider='',conversation='',id,now=Date.now()}){return {id:id||globalThis.crypto?.randomUUID?.()||`task-${now}-${Math.random().toString(36).slice(2)}`,provider,conversation,complexity:complexity(text),startedAt:now,metrics:{durationMs:0,timeToFirstResponseMs:null,generationMs:0,contextMs:0,skillsLoaded:0,skillsReused:0,aiRoundTrips:0,toolCalls:0,toolMs:0},mutations:0,toolsFailed:0,policyDelivered:false,outcome:'running'};}
  function finish(task,outcome,now=Date.now()){task.outcome=outcome;task.metrics.durationMs=Math.max(0,now-task.startedAt);return {id:task.id,fingerprint:task.fingerprint||null,profile:task.scriptMode,provider:task.provider,complexity:task.complexity,outcome,startedAt:task.startedAt,metrics:{...task.metrics}};}
  return Object.freeze({CONTEXT_CHARS,MAX_PREFETCH_SKILLS,CONTEXT_PREFETCH_MS,bare,readOnly,contextTool,scriptMode,allowsServer,allowsTool,skillsForProfile,complexity,selectSkills,scriptPolicy,policy,taskGuidance,createTask,finish});
});
