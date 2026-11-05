// Local PC operations are owned by the desktop app, never by the page renderer.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const extraTools = require('./computer-tool-pack');
const MODES = new Set(['ask', 'unusual', 'full']);
const ORIGIN = /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[\da-f-]{36})$/i;
const TOOL_NAMES = new Set(['pc_system_info','pc_stat_path','pc_list_directory','pc_search_files','pc_read_file','pc_write_file','pc_append_file','pc_create_directory','pc_copy_path','pc_move_path','pc_trash_path','pc_open_path','pc_open_url','pc_clipboard_read','pc_clipboard_write','pc_run_program']);
const TRUSTED_TOOLS = new Set(['pc_stat_path','pc_list_directory','pc_search_files','pc_read_file','pc_write_file','pc_append_file','pc_create_directory','pc_copy_path']);
const NO_PATH_TOOLS = new Set(['pc_system_info','pc_open_url','pc_clipboard_read','pc_clipboard_write']);
for (const tool of extraTools.catalog) {
  TOOL_NAMES.add(tool.name);
  // Read-only operations may reuse the user's trusted-folder policy. Writes
  // remain unusual and still request approval in that mode.
  if (tool.access === 'read' && !tool.name.startsWith('pc_git_')) TRUSTED_TOOLS.add(tool.name);
}
function normalize(value = {}) {
  if (!value || typeof value !== 'object' || !MODES.has(value.mode ?? 'ask')) throw Error('Choose a valid computer permission mode.');
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw Error('Enabled must be a boolean.');
  const roots = Array.isArray(value.roots) ? value.roots : [];
  if (roots.length > 16 || roots.some(root => typeof root !== 'string' || !path.isAbsolute(root))) throw Error('Choose up to 16 absolute trusted folders.');
  return { enabled: value.enabled === true, mode: value.mode || 'ask', roots: [...new Set(roots)], clients: [] };
}
async function canonical(value, allowMissing = false) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 4096 || /[\0\r\n]/.test(value)) throw Error('Use an absolute local path.');
  try { return await fsp.realpath(value); }
  catch (error) {
    if (!allowMissing || error.code !== 'ENOENT') throw error;
    // Only the last component may be missing; its existing parent is resolved.
    return path.join(await fsp.realpath(path.dirname(value)), path.basename(value));
  }
}
function inside(target, root) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
class ComputerAccess {
  constructor({ directory, approve, trash, open, openExternal, clipboard }) {
    this.file = path.join(directory, 'computer-access.json');
    this.approve = approve; this.trash = trash; this.open = open;
    this.openExternal = openExternal; this.clipboard = clipboard;
    this.policy = normalize(); this.history = []; this.children = new Set();
    this.server = null; this.port = 0; this.busy = false; this.revision = 0; this.pending = null;
    this.token = crypto.randomBytes(32).toString('hex');
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.policy = { ...normalize(raw), clients: (raw.clients || []).filter(value => typeof value === 'string' && ORIGIN.test(value)).slice(0,32) };
    } catch (error) { if (error.code !== 'ENOENT') this.loadError = 'Computer permissions could not be loaded. Access defaults to disabled.'; }
  }
  state() { return { ...this.policy, roots:[...this.policy.roots], clients:[...this.policy.clients], history:[...this.history], error:this.loadError || '' }; }
  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive:true });
    const temporary = this.file + `.tmp-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify(this.policy, null, 2) + '\n', { mode:0o600 });
    fs.renameSync(temporary, this.file);
  }
  async configure(input) {
    const next = normalize(input);
    next.roots = next.enabled ? await Promise.all(next.roots.map(async root => {
      const resolved = await canonical(root);
      if (!(await fsp.stat(resolved)).isDirectory()) throw Error('A trusted path must be a folder.');
      return resolved;
    })) : next.roots;
    next.clients = [...this.policy.clients];
    const previous = this.policy; this.policy = next;
    try { this.persist(); } catch (error) { if(next.enabled)this.policy = previous; else {this.revision++;this.cancelPending();} throw error; }
    this.loadError = ''; this.revision++; this.cancelPending();
    return this.state();
  }
  revoke(origin) {
    const previous = this.policy.clients;
    this.policy.clients = previous.filter(client => client !== origin);
    try { this.persist(); } catch (error) { this.revision++; this.cancelPending(); throw error; }
    this.revision++; this.cancelPending(); return this.state();
  }
  stopChild(child) {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore' });
      killer.on('error', () => child.kill());
    } else child.kill('SIGTERM');
  }
  cancelPending() { this.pending?.abort(); for (const child of this.children) this.stopChild(child); }
  log(tool, origin, outcome, target = '') {
    this.history.unshift({ at:Date.now(), tool, origin, outcome, target:String(target).slice(0,500) });
    this.history.length = Math.min(this.history.length, 100);
  }
  async paths(tool, args) {
    if (extraTools.definitions.has(tool)) return extraTools.resolvePaths(tool,args,canonical);
    if (NO_PATH_TOOLS.has(tool)) return [];
    if (tool === 'pc_run_program') return [await canonical(args.cwd || os.homedir())];
    if (tool === 'pc_move_path' || tool === 'pc_copy_path') return [await canonical(args.source), await canonical(args.destination, true)];
    return [await canonical(args.path, ['pc_write_file','pc_create_directory'].includes(tool))];
  }
  async call(tool, args = {}, origin = '', signal) {
    if (!TOOL_NAMES.has(tool)) throw Error('Unknown computer tool.');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('Tool arguments must be an object.');
    if (!this.policy.enabled) throw Error('Computer tools are disabled. Enable them in the desktop app settings.');
    if (!ORIGIN.test(origin)) throw Error('Computer tools require a browser extension connection. Ordinary web pages are not accepted.');
    const revision = this.revision, targets = await this.paths(tool, args);
    if (['pc_move_path','pc_copy_path','pc_trash_path'].includes(tool)) {
      const original = tool === 'pc_trash_path' ? args.path : args.source;
      if (path.relative(path.resolve(original), targets[0]) !== '') throw Error('Destructive operations do not follow links. Use the resolved path explicitly.');
    }
    const trusted = targets.length > 0 && (await Promise.all(this.policy.roots.map(root => canonical(root).catch(() => null))))
      .some(root => root && targets.every(target => inside(target, root)));
    const ordinary = tool === 'pc_system_info' || (trusted && TRUSTED_TOOLS.has(tool));
    const paired = this.policy.clients.includes(origin);
    const ask = !paired || this.policy.mode === 'ask' || (this.policy.mode === 'unusual' && !ordinary);
    if (ask) {
      const choice = await this.approve({ tool, args, targets, origin, pairing:!paired, mode:this.policy.mode, signal });
      if (!choice?.allow || signal?.aborted) { this.log(tool,origin,'denied',this.label(tool,args,targets)); throw Error('Computer access was denied or the approval expired.'); }
      if (revision !== this.revision || !this.policy.enabled) throw Error('Computer permissions changed while approval was pending.');
      if (choice.pair && !paired) {
        const previous = this.policy.clients;
        this.policy.clients = [...previous,origin].slice(-32);
        try { this.persist(); } catch (error) { this.policy.clients = previous; throw error; }
      }
    }
    if (revision !== this.revision || signal?.aborted || !this.policy.enabled) throw Error('Computer request was cancelled.');
    // Resolve links again after approval, which may have taken up to a minute.
    const checked = await this.paths(tool,args);
    if (checked.some((target,index) => target !== targets[index])) throw Error('The path changed during approval. Retry the operation.');
    const label = this.label(tool,args,checked);
    try {
      const result = await this.execute(tool,args,checked,signal);
      this.log(tool,origin,result?.cancelled ? 'cancelled' : result?.timedOut ? 'timed out' : result?.truncated ? 'output limit reached' : 'completed',label);
      return result;
    } catch (error) { this.log(tool,origin,'failed',label); throw error; }
  }
  label(tool,args,targets) { return tool === 'pc_run_program' ? String(args.program || '') : targets[0] || (tool === 'pc_open_url' ? String(args.url || '') : ''); }
  async execute(tool,args,targets,signal) {
    if (extraTools.definitions.has(tool)) return extraTools.execute(tool,args,targets,this,signal);
    const target = targets[0];
    if (tool === 'pc_system_info') return { platform:process.platform, release:os.release(), architecture:process.arch, home:os.homedir(), username:os.userInfo().username, freeMemory:os.freemem() };
    if (tool === 'pc_stat_path') {
      const info = await fsp.stat(target);
      return { path:target, type:info.isDirectory()?'directory':info.isFile()?'file':'other', size:info.size, createdAt:info.birthtimeMs, modifiedAt:info.mtimeMs, accessedAt:info.atimeMs };
    }
    if (tool === 'pc_list_directory') {
      const entries = await fsp.readdir(target,{ withFileTypes:true });
      return { path:target, entries:entries.slice(0,500).map(entry => ({name:entry.name,type:entry.isSymbolicLink()?'link':entry.isDirectory()?'directory':'file'})), truncated:entries.length > 500 };
    }
    if (tool === 'pc_search_files') {
      if (typeof args.pattern !== 'string' || !args.pattern.trim() || args.pattern.length > 200) throw Error('Pattern must be 1–200 characters.');
      if (args.maxResults !== undefined && !Number.isInteger(args.maxResults)) throw Error('maxResults must be an integer.');
      if (args.maxDepth !== undefined && !Number.isInteger(args.maxDepth)) throw Error('maxDepth must be an integer.');
      const limit = args.maxResults === undefined ? 100 : Math.max(1,Math.min(500,args.maxResults));
      const depthLimit = args.maxDepth === undefined ? 4 : Math.max(0,Math.min(8,args.maxDepth));
      const filesOnly = args.filesOnly === true;
      const matcher = new RegExp('^'+args.pattern.trim().replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$','i');
      const matches = []; let truncated = false;
      const walk = async (directory, depth) => {
        let entries;
        try { entries = await fsp.readdir(directory,{ withFileTypes:true }); } catch { return; }
        entries.sort((left,right) => left.name.localeCompare(right.name));
        for(const entry of entries) {
          // Links are skipped entirely so a search can never escape its start folder.
          if(entry.isSymbolicLink()) continue;
          if(matches.length >= limit) { truncated = true; return; }
          const full = path.join(directory,entry.name), directoryEntry = entry.isDirectory();
          if((!filesOnly || !directoryEntry) && matcher.test(entry.name)) matches.push({ path:full, type:directoryEntry?'directory':'file' });
          if(directoryEntry && depth < depthLimit) await walk(full,depth+1);
        }
      };
      await walk(target,0);
      return { path:target, matches, truncated };
    }
    if (tool === 'pc_read_file') {
      if (args.startLine !== undefined && !Number.isInteger(args.startLine)) throw Error('startLine must be an integer.');
      if (args.maxLines !== undefined && !Number.isInteger(args.maxLines)) throw Error('maxLines must be an integer.');
      const file = await fsp.open(target,'r');
      try {
        const buffer = Buffer.alloc(1048577), {bytesRead} = await file.read(buffer,0,buffer.length,0);
        if(bytesRead > 1048576) throw Error('File exceeds the 1 MB text-read limit.');
        const text = new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytesRead));
        if(args.startLine === undefined && args.maxLines === undefined) return { path:target, text };
        const lines = text.split('\n'), start = Math.max(1,args.startLine ?? 1), count = Math.max(1,Math.min(20000,args.maxLines ?? 2000));
        return { path:target, text:lines.slice(start-1,start-1+count).join('\n'), startLine:start, totalLines:lines.length, truncated:start-1+count < lines.length };
      } finally { await file.close(); }
    }
    if (tool === 'pc_write_file') {
      if (typeof args.text !== 'string' || Buffer.byteLength(args.text,'utf8') > 2097152) throw Error('Text must be a string of at most 2 MB.');
      await fsp.writeFile(target,args.text,{ encoding:'utf8',mode:0o600 }); return {written:target};
    }
    if (tool === 'pc_append_file') {
      if (typeof args.text !== 'string' || Buffer.byteLength(args.text,'utf8') > 1048576) throw Error('Text must be a string of at most 1 MB.');
      if (!(await fsp.stat(target)).isFile()) throw Error('Append requires an existing file.');
      await fsp.appendFile(target,args.text,{ encoding:'utf8',mode:0o600 });
      return {appended:target};
    }
    if (tool === 'pc_create_directory') { await fsp.mkdir(target); return {created:target}; }
    if (tool === 'pc_copy_path') {
      const destination = targets[1], info = await fsp.stat(target);
      try { await fsp.lstat(destination); throw Error('Destination already exists.'); } catch(error) { if(error.code !== 'ENOENT') throw error; }
      if(info.isFile()) { await fsp.copyFile(target,destination,fs.constants.COPYFILE_EXCL); return {source:target,destination,kind:'file'}; }
      if(!info.isDirectory()) throw Error('Only files and folders can be copied.');
      let entries = 0;
      const count = async directory => {
        for(const entry of await fsp.readdir(directory,{ withFileTypes:true })) {
          if(entry.isSymbolicLink()) continue;
          if(++entries > 5000) throw Error('Folder exceeds the 5000-entry copy limit.');
          if(entry.isDirectory()) await count(path.join(directory,entry.name));
        }
      };
      await count(target);
      await fsp.cp(target,destination,{ recursive:true,errorOnExist:true,force:false,dereference:false });
      return {source:target,destination,kind:'directory',entries};
    }
    if (tool === 'pc_move_path') {
      try { await fsp.lstat(targets[1]); throw Error('Destination already exists.'); } catch(error) { if(error.code !== 'ENOENT') throw error; }
      await fsp.rename(target,targets[1]); return {source:target,destination:targets[1]};
    }
    if (tool === 'pc_trash_path') { await this.trash(target); return {trashed:target}; }
    if (tool === 'pc_open_path') { const error = await this.open(target); if(error)throw Error(error); return {opened:target}; }
    if (tool === 'pc_open_url') {
      let url;
      try { url = new URL(String(args.url||'')); } catch { throw Error('Use a full http or https URL.'); }
      if(!['http:','https:'].includes(url.protocol)) throw Error('Only http and https URLs can be opened.');
      if(typeof this.openExternal !== 'function') throw Error('Opening URLs is unavailable in this build.');
      const error = await this.openExternal(url.href); if(error)throw Error(String(error));
      return {opened:url.href};
    }
    if (tool === 'pc_clipboard_read') {
      if(!this.clipboard) throw Error('The clipboard is unavailable in this build.');
      return { text:String(this.clipboard.readText()||'').slice(0,262144) };
    }
    if (tool === 'pc_clipboard_write') {
      if(typeof args.text !== 'string' || Buffer.byteLength(args.text,'utf8') > 1048576) throw Error('Text must be a string of at most 1 MB.');
      if(!this.clipboard) throw Error('The clipboard is unavailable in this build.');
      this.clipboard.writeText(args.text); return {written:true};
    }
    if (tool === 'pc_run_program') return this.runProgram(args,target,signal);
    throw Error('Unknown tool.');
  }
  runProgram(args,cwd,signal) {
    if(typeof args.program !== 'string' || !args.program || args.program.length > 4096 || /[\0\r\n]/.test(args.program)) throw Error('Choose a program name or absolute executable path.');
    if(!Array.isArray(args.args || []) || (args.args || []).length > 100 || (args.args || []).some(arg => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0'))) throw Error('Program arguments must be a bounded string array.');
    const timeout = Number.isInteger(args.timeoutMs) ? Math.max(1000,Math.min(60000,args.timeoutMs)) : 15000;
    return new Promise((resolve,reject) => {
      let output = '', errors = '', size = 0, truncated = false, timedOut = false;
      const child = spawn(args.program,args.args || [],{cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
      this.children.add(child);
      const abort = () => this.stopChild(child);
      const timer = setTimeout(() => { timedOut = true; abort(); },timeout);
      signal?.addEventListener('abort',abort,{once:true});
      const collect = (chunk,stderr) => {
        const available = Math.max(0,262144-size), data = chunk.subarray(0,available).toString('utf8');
        size += chunk.length; if(stderr) errors += data; else output += data;
        if(size > 262144 && !truncated) { truncated = true; abort(); }
      };
      child.stdout.on('data',chunk => collect(chunk,false)); child.stderr.on('data',chunk => collect(chunk,true));
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort',abort); this.children.delete(child); };
      child.once('error',error => {cleanup();reject(error);});
      child.once('close',code => { cleanup(); resolve({exitCode:code,stdout:output,stderr:errors,truncated,timedOut,cancelled:!!signal?.aborted}); });
      if(signal?.aborted)abort();
    });
  }
  async start() {
    if(this.server) return;
    this.server = http.createServer(async (request,response) => {
      const supplied = String(request.headers['x-fs-pc-token'] || '');
      const suppliedBytes = Buffer.from(supplied), tokenBytes = Buffer.from(this.token);
      const authorized = suppliedBytes.length === tokenBytes.length && crypto.timingSafeEqual(suppliedBytes,tokenBytes);
      const send = (status,value) => { response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}); response.end(JSON.stringify(value)); };
      if(!authorized) {send(401,{error:'Unauthorized'});return;}
      if(request.method === 'GET' && request.url === '/status') {send(200,{enabled:this.policy.enabled});return;}
      if(request.method !== 'POST' || request.url !== '/call') {send(404,{error:'Not found'});return;}
      if(this.busy) {send(409,{error:'Another computer operation is pending.'});return;}
      this.busy = true;
      const controller = new AbortController(); this.pending = controller;
      response.on('close',() => {if(!response.writableEnded)controller.abort();});
      try {
        const chunks = []; let bytes = 0;
        for await(const chunk of request) { bytes += chunk.length; if(bytes > 2200000)throw Error('Computer request is too large.'); chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const result = await this.call(input.tool,input.arguments,input.origin,controller.signal);
        send(200,{ok:true,result});
      } catch(error) {if(!response.destroyed)send(400,{ok:false,error:error.message});}
      finally {this.busy = false;if(this.pending === controller)this.pending = null;}
    });
    this.server.headersTimeout = 10000; this.server.requestTimeout = 150000;
    await new Promise((resolve,reject) => {this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve);});
    this.port = this.server.address().port;
  }
  environment() { return this.port ? { FS_PC_PORT:String(this.port), FS_PC_TOKEN:this.token } : { FS_PC_PORT:"", FS_PC_TOKEN:"" }; }
  close() { this.cancelPending(); this.server?.close(); this.server?.closeAllConnections(); this.server = null; this.port = 0; }
}
module.exports = { ComputerAccess, normalize, canonical, inside, TOOL_NAMES };
