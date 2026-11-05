// FeatherScript desktop app - main process.
// Owns the local profile store, the window and the Python bridge process, so
// opening the app means the bridge is already running.

const { app, BrowserWindow, ipcMain, Menu, shell, dialog, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const { ComputerAccess } = require("./computer-access");
const { ProjectService } = require('./project-service');
const { windowEffects, bindWindowPresence } = require("./window-effects");
const { revealWindow, bindStartupWindow } = require("./window-lifecycle");
const { pathToFileURL } = require("node:url");
const appearance = require("./appearance");
const extraThemes = require("../featherscript-extension/core/theme-presets.json");
const themeIds = new Set(["default", "dark", "midnight", ...extraThemes.map((preset) => preset.id)]);

// Interface feel is cosmetic, so bad or missing values fall back to the defaults
// instead of failing the save.
const FEEL_SOUND = new Set(["off", "soft", "full"]);
const FEEL_MOTION = new Set(["off", "reduced", "full"]);
const FEEL_MUSIC = new Set(["off", "on"]);
const DEFAULT_FEEL = { sound: "soft", motion: "full", intensity: 0.6, music: "on", musicVolume: 0.5 };
function sanitizeFeel(value) {
  const feel = value && typeof value === "object" ? value : {};
  const intensity = Number(feel.intensity);
  const musicVolume = Number(feel.musicVolume);
  return {
    sound: FEEL_SOUND.has(feel.sound) ? feel.sound : DEFAULT_FEEL.sound,
    motion: FEEL_MOTION.has(feel.motion) ? feel.motion : DEFAULT_FEEL.motion,
    intensity: Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : DEFAULT_FEEL.intensity,
    music: FEEL_MUSIC.has(feel.music) ? feel.music : DEFAULT_FEEL.music,
    musicVolume: Number.isFinite(musicVolume) ? Math.min(1, Math.max(0, musicVolume)) : DEFAULT_FEEL.musicVolume,
  };
}

const APP_DIR = __dirname;
const ROOT = path.resolve(APP_DIR, "..");
const BRIDGE_PORT = 17613;
const LOG_DIR = path.join(ROOT, "logs");
// One folder both sides read: the app writes it, the bridge tool
// feather_getskills reads it (bridge.py gets this path via env).
const SKILLS_DIR = process.env.FS_SKILLS_DIR ? path.resolve(process.env.FS_SKILLS_DIR) : path.join(ROOT, "skills");

// Portable/test profile: lets a second instance (or the screenshot harness)
// keep its profiles out of the real user profile.
if (process.env.FS_USER_DATA) {
  try { app.setPath("userData", process.env.FS_USER_DATA); } catch {}
}

app.setAppUserModelId("com.featherscript.app");
if (process.platform === "win32" && !app.requestSingleInstanceLock()) {
  app.exit(0);
}

let win = null;
const computer = new ComputerAccess({
  directory: app.getPath('userData'),
  trash: target => shell.trashItem(target),
  open: target => shell.openPath(target),
  openExternal: url => shell.openExternal(url).then(() => '', error => error.message),
  clipboard,
  approve: async request => {
    if (!win || win.isDestroyed()) return {allow:false};
    if (win.isMinimized()) win.restore(); win.show(); win.focus();
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener('abort',abort,{once:true});
    const timer = setTimeout(abort,60000);
    try {
      if(request.signal?.aborted) return {allow:false};
      let detail = `Client: ${request.origin}\nMode: ${request.mode}\nResolved paths: ${request.targets.join(', ') || '(system information)'}\n\nArguments:\n${JSON.stringify(request.args,null,2)}`;
      if(detail.length > 12000)detail = detail.slice(0,12000) + '\n[Preview truncated. Deny if you cannot verify this action.]';
      const result = await dialog.showMessageBox(win, { type:'warning', title:'FeatherScript computer access',
        message:`Allow ${request.tool}?`, detail, buttons:request.pairing ? ['Deny','Allow once','Allow and pair this extension'] : ['Deny','Allow once'],
        defaultId:0,cancelId:0,noLink:true,signal:controller.signal });
      return {allow:!controller.signal.aborted && result.response > 0,pair:result.response === 2};
    } finally {clearTimeout(timer);request.signal?.removeEventListener('abort',abort);}
  },
});
const isDesktopSender = event => !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url.split('#')[0] === pathToFileURL(path.join(APP_DIR,'renderer/index.html')).href;
for(const [channel,operation] of Object.entries({
  'pc:get': () => ({available:computer.port > 0,...computer.state()}),
  'pc:save': input => computer.configure(input),
  'pc:disable': () => computer.configure({...computer.policy,enabled:false}),
  'pc:revoke': input => computer.revoke(input.origin),
})) ipcMain.handle(channel,async(event,input={}) => {
  if(!isDesktopSender(event))return {ok:false,error:'Computer permissions can only be changed from the desktop app.'};
  try {return {ok:true,state:await operation(input)};}catch(error){return {ok:false,error:error.message};}
});
ipcMain.handle('pc:choose-folder',async event => {
  if(!isDesktopSender(event))return {ok:false,error:'Desktop app required.'};
  const result = await dialog.showOpenDialog(win,{title:'Trust a folder for agent file reads and edits',properties:['openDirectory']});
  return {ok:true,path:result.filePaths[0] || ''};
});


// ── local profile store ─────────────────────────────────────────────────────────
// One JSON file with local profiles and their memory, notes and appearance. Stored in
// the Electron userData folder so it survives app updates.

const storeFile = () => path.join(app.getPath("userData"), "featherscript-store.json");
const emptyData = () => ({
  memory: "",
  notes: [],
  settings: {
    customPrompt: "",
    theme: "default",
    feel: { ...DEFAULT_FEEL },
    appearance: appearance.normalize(),
  },
});

const profileStore = require("./profile-store");
function readStore() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(storeFile(), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const store = profileStore.migrate(raw, emptyData);
  if (raw.version !== 3 || !raw.profiles?.length || raw.activeProfileId !== store.activeProfileId) writeStore(store);
  return store;
}

function writeStore(store) {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

const currentProfile = (store) => profileStore.current(store);
const projectService = new ProjectService({directory:app.getPath('userData'),getProfileId:()=>readStore().activeProfileId});
const projects = require("../featherscript-extension/core/projects");
ipcMain.handle('projects:list',async event=>{
  if(!isDesktopSender(event))return {ok:false,error:'Desktop app required.'};
  try{return await projectService.dispatch({action:'all'},{desktop:true});}catch(error){return {ok:false,error:error.message};}
});
ipcMain.handle('projects:fire',async(event,input={})=>{
  if(!isDesktopSender(event))return {ok:false,error:'Desktop app required.'};
  try{return await projectService.dispatch({...input,action:'fire'},{desktop:true});}catch(error){return {ok:false,error:error.message};}
});
// The handoff as a FILE. Firing only prepared a snapshot that the next chat had
// to find again, so the user could not carry work anywhere until they happened
// to be in the right window; this writes the exact same JSON the extension
// injects as continuation context, whenever they ask for it.
ipcMain.handle('projects:export',async(event,input={})=>{
  if(!isDesktopSender(event))return {ok:false,error:'Desktop app required.'};
  try{
    const owner=readStore().activeProfileId;
    const result=await projectService.dispatch({...input,action:'get'},{desktop:true});
    if(!result.ok)throw Error(result.error||'Saved project not found.');
    const file=projects.continuationFile(result.project);
    if(!file.checkpoints)throw Error('This project has no saved checkpoints yet - finish a task first.');
    const answer=await dialog.showSaveDialog(win,{title:'Save continuation file',
      defaultPath:path.join(app.getPath('downloads'),file.name),
      filters:[{name:'FeatherScript continuation',extensions:['json']}]});
    if(answer.canceled||!answer.filePath)return {ok:true,cancelled:true};
    if(owner!==readStore().activeProfileId)throw Error('The desktop profile changed. Try again.');
    const temporary=answer.filePath+'.tmp-'+process.pid;
    fs.writeFileSync(temporary,file.text,'utf8');
    fs.renameSync(temporary,answer.filePath);
    return {ok:true,path:answer.filePath,checkpoints:file.checkpoints};
  }catch(error){return {ok:false,error:error.message};}
});
ipcMain.handle('projects:delete',async(event,input={})=>{
  if(!isDesktopSender(event))return {ok:false,error:'Desktop app required.'};
  try{
    const owner=readStore().activeProfileId;
    const result=await projectService.dispatch({...input,action:'get'},{desktop:true});
    const answer=await dialog.showMessageBox(win,{type:'warning',title:'Delete saved project memory',message:`Delete memory for “${result.project.title}”?`,detail:'Removes its saved task handoffs and chat associations from this local profile. Studio places, source files and the place’s own memory module are kept.',buttons:['Cancel','Delete saved memory'],defaultId:0,cancelId:0,noLink:true});
    if(answer.response!==1)return {ok:true,cancelled:true};
    if(owner!==readStore().activeProfileId)throw Error('The desktop profile changed. Try again.');
    return await projectService.dispatch({...input,action:'delete'},{desktop:true});
  }catch(error){return {ok:false,error:error.message};}
});
ipcMain.handle('projects:folder',async(event,input={})=>{
  if(!isDesktopSender(event))return {ok:false,error:'Desktop app required.'};
  try{
    const owner=readStore().activeProfileId;
    if(input.profile!=='agent')throw Error('Choose folders for local AgentScript projects.');
    const choice=await dialog.showOpenDialog(win,{title:'Identify the local project folder',properties:['openDirectory']});
    if(choice.canceled)return {ok:true,cancelled:true};
    if(owner!==readStore().activeProfileId)throw Error('The desktop profile changed. Try again.');
    return await projectService.dispatch({...input,action:'folder',path:choice.filePaths[0]},{desktop:true});
  }catch(error){return {ok:false,error:error.message};}
});

function sanitizeAvatar(v) {
  if (typeof v !== "string" || !v) return "";
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) return "";
  if (v.length > 3 * 1024 * 1024) return "";
  return v;
}

function sanitizeNotes(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((n) => n && typeof n.text === "string" && n.text.trim())
    .slice(0, 500)
    .map((n) => ({
      id: typeof n.id === "string" && n.id ? n.id : crypto.randomUUID(),
      text: n.text.slice(0, 20000),
      createdAt: Number(n.createdAt) || Date.now(),
    }));
}

// ── bridge process ────────────────────────────────────────────────────────
// The app replaces the old start.bat launcher: it finds Python, runs bridge.py, waits for the
// port. A conflict is reported without terminating an unrelated application.

class Bridge {
  constructor() {
    this.child = null;
    this.state = { status: "idle", detail: "", pid: null };
    this.tail = "";
    this.startedAt = 0;
    this.retriedDeps = false;
    this.restarting = null;
  }

  setState(status, detail = "") {
    this.state = { status, detail, pid: this.child ? this.child.pid : null };
    if (win && !win.isDestroyed()) win.webContents.send("bridge:state", this.state);
  }

  findPython() {
    const candidates = [
      { cmd: "py", args: ["-3"] },
      { cmd: "python", args: [] },
      // macOS/Linux only ship python3; a GUI-launched app also misses Homebrew
      // in its PATH, so check the usual install locations by hand below.
      { cmd: "python3", args: [] },
    ];
    for (const c of candidates) {
      if (this.pythonOk(c)) return c;
    }
    if (process.platform === "win32") {
      const bases = [
        path.join(process.env.LOCALAPPDATA || "", "Programs", "Python"),
        process.env.ProgramFiles || "",
        process.env["ProgramFiles(x86)"] || "",
      ];
      for (const base of bases) {
        if (!base) continue;
        let dirs = [];
        try { dirs = fs.readdirSync(base).filter((d) => /^Python3\d+$/.test(d)).sort().reverse(); } catch {}
        for (const d of dirs) {
          const exe = path.join(base, d, "python.exe");
          if (fs.existsSync(exe) && this.pythonOk({ cmd: exe, args: [] })) return { cmd: exe, args: [] };
        }
      }
    } else {
      for (const exe of ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]) {
        if (fs.existsSync(exe) && this.pythonOk({ cmd: exe, args: [] })) return { cmd: exe, args: [] };
      }
    }
    return null;
  }

  // bridge.py calls asyncio.to_thread(), so it needs Python 3.9+. A `python`
  // that answers --version but is 2.7 or 3.7 makes the bridge die with a
  // traceback before it can say anything useful, so gate on the version here.
  pythonOk(c) {
    try {
      const r = spawnSync(c.cmd, [...c.args, "-c", "import sys;print('%d.%d' % sys.version_info[:2])"], {
        windowsHide: true,
        timeout: 5000,
        encoding: "utf8",
      });
      if (!r || r.status !== 0) return false;
      const m = String(r.stdout || "").match(/^(\d+)\.(\d+)\s*$/m);
      return !!m && Number(m[1]) === 3 && Number(m[2]) >= 9;
    } catch { return false; }
  }

  log(chunk) {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.appendFileSync(path.join(LOG_DIR, "app-bridge.log"), chunk);
    } catch {}
    this.tail = (this.tail + chunk).slice(-4000);
  }

  async start() {
    if (this.child) return this.state;
    const py = this.findPython();
    if (!py) {
      this.setState("error", "Python 3.9 or newer was not found. Install it from python.org, then reopen FeatherScript.");
      return this.state;
    }
    this.startedAt = Date.now();
    this.tail = "";
    this.setState("starting", "Starting the local bridge…");
    let child;
    try {
      child = spawn(py.cmd, [...py.args, path.join(ROOT, "bridge.py")], {
        cwd: ROOT,
        env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", FEATHER_SKILLS_DIR: SKILLS_DIR, ...computer.environment(), ...projectService.environment() },
        windowsHide: true,
      });
    } catch (e) {
      this.setState("error", `Could not start Python: ${e.message}`);
      return this.state;
    }
    this.child = child;
    this.log(`\n=== ${new Date().toISOString()} app launch: ${py.cmd} ${py.args.join(" ")} bridge.py\n`);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => this.log(d));
    child.stderr.on("data", (d) => this.log(d));
    // One abort signal per launch: a process that dies or never spawns must cut
    // the 60s port wait short instead of leaving "Starting…" on screen until
    // the timeout expires.
    const launch = new AbortController();
    child.once("error", () => launch.abort());
    child.once("exit", () => launch.abort());
    child.on("error", (e) => this.setState("error", `Bridge failed to start: ${e.message}`));
    child.on("exit", (code) => {
      const wasChild = this.child === child;
      if (wasChild) this.child = null;
      if (!wasChild) return;
      const quick = Date.now() - this.startedAt < 12000;
      // bridge.py prints "[bridge] Missing dependency: the 'websockets'
      // package..." - it never emits Python's "No module named" text, which the
      // old check looked for, so the install branch never ran for a fresh
      // machine. Match the bridge's own wording (and the raw Python wording,
      // for users launching an older bridge.py).
      const missingWss = /No module named ['"]?websockets|Missing dependency[^\n]*websockets/i.test(this.tail);
      if (quick && !this.retriedDeps && missingWss) {
        this.retriedDeps = true;
        this.setState("starting", "Installing the Python websockets package (first run)…");
        const installs = [
          [...py.args, "-m", "pip", "install", "--user", "websockets"],
          // Some interpreters (venvs, Store builds) refuse --user.
          [...py.args, "-m", "pip", "install", "websockets"],
        ];
        if (process.platform !== "win32") {
          // Homebrew / python.org builds mark their environment externally
          // managed (PEP 668); this is one pure-Python dependency in the user's
          // own profile, so allow the override as a last resort.
          installs.push([...py.args, "-m", "pip", "install", "--user", "--break-system-packages", "websockets"]);
        }
        let out = "";
        for (const args of installs) {
          let r;
          try {
            r = spawnSync(py.cmd, args, { windowsHide: true, timeout: 180000, encoding: "utf8" });
          } catch (e) {
            out += String(e);
            break;
          }
          out += `${(r && r.stdout) || ""}${(r && r.stderr) || ""}`;
          if (r && r.status === 0) break;
        }
        if (out) this.log(out);
        let installed = false;
        try {
          const check = spawnSync(py.cmd, [...py.args, "-c", "import websockets"], {
            windowsHide: true, timeout: 15000, encoding: "utf8",
          });
          installed = !!check && check.status === 0;
        } catch {}
        if (installed) {
          if (win && !win.isDestroyed()) setTimeout(() => this.start(), 400);
          return;
        }
        const cmdLine = `"${py.cmd}" ${[...py.args, "-m", "pip", "install", "--user", "websockets"].join(" ")}`;
        this.setState("error", `The Python package "websockets" could not be installed. Run this in a terminal, then press Restart: ${cmdLine}`);
        return;
      }
      if (missingWss) {
        const cmdLine = `"${py.cmd}" ${[...py.args, "-m", "pip", "install", "--user", "websockets"].join(" ")}`;
        this.setState("error", `The bridge needs the Python package "websockets". Run this in a terminal, then press Restart: ${cmdLine}`);
        return;
      }
      if (!/Bridge is already running/.test(this.tail)) {
        // Surfaced in the app window: the last line is usually the real cause
        // (port in use, read-only folder, crash) and is what a user can send us.
        const lines = String(this.tail || "").replace(/\x1b\[[0-9;]*m/g, "").trim().split(/\r?\n/).filter(Boolean);
        const last = lines.findLast(line => /could not start:|Error:|Exception:/.test(line)) || lines.at(-1) || "";
        const detail = last ? `The bridge stopped (exit ${code}): ${last.slice(0, 180)}` : `The bridge stopped (exit ${code}). See logs/app-bridge.log.`;
        this.setState("error", detail);
      }
    });

    const ready = await waitPort(BRIDGE_PORT, 60000, launch.signal);
    // The exit handler already reported what went wrong; a late port probe must
    // not paint "online" over it, and a restart may have installed another child.
    if (this.child !== child) return this.state;
    if (ready) {
      this.setState("online", "Local bridge connected.");
    } else {
      this.setState("error", "The bridge did not open its port. See logs/app-bridge.log.");
    }
    return this.state;
  }

  stop() {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          timeout: 8000,
        });
      } else {
        child.kill("SIGTERM");
      }
    } catch {}
  }

  restart() {
    // bridge:restart and mcp:save can both fire; a second restart must join the
    // one already running instead of killing the process the first just spawned.
    if (this.restarting) return this.restarting;
    this.restarting = (async () => {
      this.setState("starting", "Restarting the bridge…");
      this.stop();
      await new Promise((r) => setTimeout(r, 600));
      return this.start();
    })().finally(() => { this.restarting = null; });
    return this.restarting;
  }
}

function waitPort(port, timeoutMs, signal) {
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;
    let timer = null;
    const onAbort = () => finish(false);
    const finish = (value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    if (signal) {
      if (signal.aborted) return finish(false);
      signal.addEventListener("abort", onAbort, { once: true });
    }
    const tick = () => {
      if (done) return;
      const socket = net.connect(port, "127.0.0.1");
      socket.setTimeout(1200);
      let settled = false;
      socket.once("connect", () => {
        if (settled) { socket.destroy(); return; }
        settled = true;
        finish(true);
        socket.destroy();
      });
      // A failed connect can emit BOTH 'error' and 'timeout' (and the later
      // destroy can queue a close); without this latch each probe scheduled
      // two follow-up probes and the wait could outlive its own result.
      const retry = () => {
        socket.destroy();
        if (settled) return;
        settled = true;
        if (Date.now() - started > timeoutMs) finish(false);
        else timer = setTimeout(tick, 400);
      };
      socket.once("error", retry);
      socket.once("timeout", retry);
    };
    tick();
  });
}

const bridge = new Bridge();
// ── IPC ───────────────────────────────────────────────────────────────────

ipcMain.handle("profiles:state", () => {
  const store = readStore();
  return { current: currentProfile(store), profiles: store.profiles };
});
ipcMain.handle("profiles:remove", async (event, input = {}) => {
  if (!isDesktopSender(event)) return {ok:false,error:'Desktop app required.'};
  try {
    const store = readStore(), profile = store.profiles.find(p => p.id === input.id);
    if (!profile) throw Error('Profile unavailable.');
    if (store.profiles.length < 2) throw Error('Keep at least one local profile.');
    const answer = await dialog.showMessageBox(win,{type:'warning',title:'Remove local profile',message:`Remove “${profile.name}”?`,detail:'This permanently removes its local memory, notes, custom prompt and appearance. Shared skills, vault files and connections stay on this computer.',buttons:['Cancel','Remove profile'],defaultId:0,cancelId:0,noLink:true});
    if(answer.response !== 1)return {ok:false,error:'Profile removal cancelled.'};
    const latest = readStore(); profileStore.remove(latest,input.id); writeStore(latest);
    const user = currentProfile(latest); return {ok:true,user,profiles:latest.profiles,data:latest.data[user.id]};
  } catch(error) {return {ok:false,error:error.message};}
});
for (const action of ["create", "select"]) {
  ipcMain.handle(`profiles:${action}`, (_event, input = {}) => {
    try {
      const store = readStore();
      const profile = action === "create" ? profileStore.create(store, input, emptyData) : profileStore.select(store, input.id);
      writeStore(store);
      return { ok: true, user: profile, profiles: store.profiles, data: store.data[profile.id] };
    } catch (error) { return { ok: false, error: error.message }; }
  });
}
ipcMain.handle("profiles:update", (_event, input = {}) => {
  const store = readStore();
  const profile = currentProfile(store);
  const name = String(input.name || "").trim();
  if (name.length < 2 || name.length > 40) return { ok: false, error: "Choose a name between 2 and 40 characters." };
  if (store.profiles.some((p) => p.id !== profile.id && p.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: "A profile with that name already exists." };
  profile.name = name;
  if (typeof input.avatar === "string") profile.avatar = sanitizeAvatar(input.avatar);
  writeStore(store);
  return { ok: true, user: profile, profiles: store.profiles };
});

ipcMain.handle("data:get", () => {
  const store = readStore();
  const profile = currentProfile(store);
  if (!profile) return { ok: false, error: "No local profile selected." };
  return { ok: true, data: store.data[profile.id] || emptyData() };
});

ipcMain.handle("data:save", (_e, input = {}) => {
  const store = readStore();
  const profile = input.profileId ? store.profiles.find((item) => item.id === input.profileId) : currentProfile(store);
  if (!profile) return { ok: false, error: "No local profile selected." };
  const data = store.data[profile.id] || emptyData();
  const section = input.section;
  if (section === "memory" && typeof input.value === "string") data.memory = input.value.slice(0, 200000);
  else if (section === "notes") data.notes = sanitizeNotes(input.value);
  else if (section === "settings" && input.value && typeof input.value === "object") {
    data.settings = {
      customPrompt: String(input.value.customPrompt || "").slice(0, 20000),
      theme: themeIds.has(input.value.theme) ? input.value.theme : "default",
      feel: sanitizeFeel(input.value.feel),
      appearance: appearance.normalize(input.value.appearance),
    };
  } else return { ok: false, error: "Unknown section." };
  store.data[profile.id] = data;
  writeStore(store);
  return { ok: true };
});

// ── skills library ────────────────────────────────────────────────────────
// skills/<folder>/SKILL.md + any number of references/ and scripts/ files.
// The bridge's feather_getskills tool reads this exact folder, so whatever is
// saved here is what the model sees.

const SKILL_MAIN = "SKILL.md";
const SKILL_GROUPS = ["references", "scripts"];
const SKILL_MAX_BYTES = 2 * 1024 * 1024;
const SKILL_MAX_FILES = 500;
const SCRIPT_EXT = new Set([".lua", ".luau", ".py", ".js", ".mjs", ".cjs", ".ts", ".sh", ".ps1", ".bat", ".cmd"]);

function ensureSkillsDir() {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
}

function slugify(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug;
}

function skillDir(folder) {
  const name = String(folder || "");
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name) || name.includes("..")) return null;
  return path.join(path.resolve(SKILLS_DIR), name);
}

function skillFile(dir, rel) {
  const parts = String(rel || "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length || parts.length > 5) return null;
  for (const part of parts) {
    if (part === "." || part === ".." || part.startsWith(".") || /[<>:"|?*\x00-\x1f]/.test(part)) return null;
  }
  const full = path.resolve(dir, parts.join(path.sep));
  return full.startsWith(dir + path.sep) ? full : null;
}

function listSkillFiles(dir) {
  const files = [];
  const main = path.join(dir, SKILL_MAIN);
  const walk = (base, prefix, depth) => {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      if (files.length >= SKILL_MAX_FILES) return;
      const full = path.join(base, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel, depth + 1);
      else if (entry.isFile()) {
        try {
          const st = fs.statSync(full);
          files.push({ path: rel, size: st.size, mtime: st.mtimeMs });
        } catch {}
      }
    }
  };
  try {
    const st = fs.statSync(main);
    files.push({ path: SKILL_MAIN, size: st.size, mtime: st.mtimeMs });
  } catch {}
  for (const group of SKILL_GROUPS) walk(path.join(dir, group), group, 0);
  return files;
}

function skillMeta(folder, text) {
  let name = folder;
  let description = "";
  let head = "";
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    head = text.slice(3, end === -1 ? undefined : end);
  }
  for (const line of head.split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    const val = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "name" && val) name = val;
    else if ((key === "description" || key === "summary") && val) description = val;
  }
  if (!description) {
    const body = head && text.startsWith("---") ? text.replace(/^---[\s\S]*?\n---/, "") : text;
    const first = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
    if (first) description = first;
  }
  return { name, description };
}

function listSkills() {
  ensureSkillsDir();
  let entries = [];
  try {
    entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .map((folder) => {
      const dir = skillDir(folder);
      if (!dir) return null;
      let main = "";
      try {
        main = fs.readFileSync(path.join(dir, SKILL_MAIN), "utf8");
      } catch {}
      const meta = skillMeta(folder, main);
      return {
        folder,
        name: meta.name,
        description: meta.description,
        hasMain: Boolean(main),
        files: listSkillFiles(dir),
      };
    })
    .filter(Boolean);
}

function uniqueName(dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = name;
  for (let i = 2; fs.existsSync(path.join(dir, candidate)) && i < 500; i++) candidate = `${stem} (${i})${ext}`;
  return candidate;
}

function copyIntoSkill(dir, group, source) {
  const name = path.basename(source);
  if (!name || name.startsWith(".")) return null;
  const st = fs.statSync(source);
  if (!st.isFile() || st.size > SKILL_MAX_BYTES) return null;
  const target = group === "scripts" || (group !== "references" && SCRIPT_EXT.has(path.extname(name).toLowerCase()))
    ? "scripts"
    : "references";
  const folder = path.join(dir, target);
  fs.mkdirSync(folder, { recursive: true });
  const finalName = uniqueName(folder, name);
  fs.copyFileSync(source, path.join(folder, finalName));
  return `${target}/${finalName}`;
}

function copyTree(source, target, depth = 0) {
  if (depth > 4) return;
  let entries = [];
  try {
    entries = fs.readdirSync(source, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyTree(from, to, depth + 1);
    } else if (entry.isFile()) {
      try {
        if (fs.statSync(from).size <= SKILL_MAX_BYTES) fs.copyFileSync(from, to);
      } catch {}
    }
  }
}

function skillTemplate(name, description) {
  return [
    "---",
    `name: ${name}`,
    `description: ${description || "When the agent should use this skill and what it produces."}`,
    "---",
    "",
    `# ${name}`,
    "",
    description || "When the agent should use this skill.",
    "",
    "## Steps",
    "",
    "1. ",
    "",
    "## Notes",
    "",
  ].join("\n");
}

ipcMain.handle("skills:list", () => ({ ok: true, dir: SKILLS_DIR, skills: listSkills() }));

ipcMain.handle("skills:create", (_e, input = {}) => {
  const name = String(input.name || "").trim().slice(0, 60);
  const description = String(input.description || "").trim().slice(0, 200);
  if (!name) return { ok: false, error: "Give the skill a name." };
  const folder = slugify(name);
  if (!folder) return { ok: false, error: "Use at least one letter or number in the name." };
  const dir = skillDir(folder);
  if (!dir) return { ok: false, error: "That name cannot be used as a folder." };
  ensureSkillsDir();
  if (fs.existsSync(dir)) return { ok: false, error: `A skill called "${folder}" already exists.` };
  fs.mkdirSync(path.join(dir, "references"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, SKILL_MAIN), skillTemplate(name, description), "utf8");
  return { ok: true, folder, skills: listSkills() };
});

ipcMain.handle("skills:read", (_e, input = {}) => {
  const dir = skillDir(input.folder);
  if (!dir) return { ok: false, error: "Unknown skill." };
  const file = skillFile(dir, input.path || SKILL_MAIN);
  if (!file) return { ok: false, error: "That file path is not allowed." };
  try {
    if (fs.statSync(file).size > SKILL_MAX_BYTES) return { ok: false, error: "That file is too large to open." };
    return { ok: true, path: input.path || SKILL_MAIN, text: fs.readFileSync(file, "utf8") };
  } catch {
    return { ok: false, error: "That file no longer exists." };
  }
});

ipcMain.handle("skills:write", (_e, input = {}) => {
  const dir = skillDir(input.folder);
  if (!dir) return { ok: false, error: "Unknown skill." };
  const rel = input.path || SKILL_MAIN;
  const file = skillFile(dir, rel);
  if (!file) return { ok: false, error: "That file path is not allowed." };
  const text = String(input.text ?? "");
  if (Buffer.byteLength(text, "utf8") > SKILL_MAX_BYTES) return { ok: false, error: "That file is larger than 2 MB." };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return { ok: true, skills: listSkills() };
});

ipcMain.handle("skills:upload", async (_e, input = {}) => {
  const dir = skillDir(input.folder);
  if (!dir) return { ok: false, error: "Unknown skill." };
  const picked = await dialog.showOpenDialog(win, {
    title: "Add files to this skill",
    defaultPath: dir,
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Skill files", extensions: ["md", "txt", "lua", "luau", "py", "js", "ts", "json", "yml", "yaml", "toml", "sh", "ps1", "bat", "cmd", "html", "css"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (picked.canceled || !picked.filePaths.length) return { ok: true, added: [], skills: listSkills() };
  const added = [];
  const skipped = [];
  for (const source of picked.filePaths.slice(0, 50)) {
    try {
      const rel = copyIntoSkill(dir, input.target, source);
      if (rel) added.push(rel);
      else skipped.push(path.basename(source));
    } catch {
      skipped.push(path.basename(source));
    }
  }
  return { ok: true, added, skipped, skills: listSkills() };
});

ipcMain.handle("skills:import", (_e, input = {}) => {
  const dir = skillDir(input.folder);
  if (!dir) return { ok: false, error: "Unknown skill." };
  const sources = Array.isArray(input.paths) ? input.paths.slice(0, 50) : [];
  const added = [];
  const skipped = [];
  for (const source of sources) {
    if (typeof source !== "string" || !path.isAbsolute(source)) {
      skipped.push(String(source).slice(-40));
      continue;
    }
    try {
      const rel = copyIntoSkill(dir, input.target, source);
      if (rel) added.push(rel);
      else skipped.push(path.basename(source));
    } catch {
      skipped.push(path.basename(source));
    }
  }
  return { ok: true, added, skipped, skills: listSkills() };
});

ipcMain.handle("skills:remove-file", async (_e, input = {}) => {
  const dir = skillDir(input.folder);
  if (!dir) return { ok: false, error: "Unknown skill." };
  const rel = input.path;
  if (rel === SKILL_MAIN) return { ok: false, error: "SKILL.md is the skill itself - delete the whole skill instead." };
  const file = skillFile(dir, rel);
  if (!file) return { ok: false, error: "That file path is not allowed." };
  try {
    await shell.trashItem(file);
  } catch (e) {
    return { ok: false, error: `Could not remove that file: ${e.message}` };
  }
  return { ok: true, skills: listSkills() };
});

ipcMain.handle("skills:delete", async (_e, input = {}) => {
  const dir = skillDir(input.folder);
  if (!dir) return { ok: false, error: "Unknown skill." };
  if (!fs.existsSync(dir)) return { ok: false, error: "That skill no longer exists." };
  try {
    await shell.trashItem(dir);
  } catch (e) {
    return { ok: false, error: `Could not move it to the recycle bin: ${e.message}` };
  }
  return { ok: true, skills: listSkills() };
});

ipcMain.handle("skills:import-folder", async () => {
  const picked = await dialog.showOpenDialog(win, {
    title: "Import a skill folder",
    properties: ["openDirectory"],
  });
  if (picked.canceled || !picked.filePaths.length) return { ok: true, skills: listSkills() };
  const source = picked.filePaths[0];
  if (!fs.existsSync(path.join(source, SKILL_MAIN))) {
    return { ok: false, error: "That folder has no SKILL.md at its top level." };
  }
  const base = slugify(path.basename(source));
  if (!base) return { ok: false, error: "Could not build a folder name from that folder." };
  ensureSkillsDir();
  let folder = base;
  for (let i = 2; fs.existsSync(skillDir(folder)) && i < 100; i++) folder = `${base}-${i}`;
  const dir = skillDir(folder);
  if (!dir) return { ok: false, error: "Could not create a folder for that skill." };
  fs.mkdirSync(dir, { recursive: true });
  copyTree(source, dir);
  return { ok: true, folder, skills: listSkills() };
});

ipcMain.handle("skills:reveal", () => {
  ensureSkillsDir();
  shell.openPath(SKILLS_DIR);
  return { ok: true, dir: SKILLS_DIR };
});

ipcMain.handle("bridge:status", () => bridge.state);
ipcMain.handle("bridge:restart", () => bridge.restart());
const blenderConfig = require("./mcp-config");
ipcMain.handle("mcp:get", (event) => {
  if(!isDesktopSender(event))return {ok:false,error:"Desktop app required."};
  try { return { ok: true, settings: blenderConfig.read(ROOT) }; }
  catch (error) { return { ok: false, error: error.message }; }
});
let mcpSaving = false;
ipcMain.handle("mcp:save", async (event, input) => {
  if(!isDesktopSender(event))return {ok:false,error:"Desktop app required."};
  if (mcpSaving) return { ok: false, error: "An MCP configuration update is already running." };
  mcpSaving = true;
  try {
    const settings = blenderConfig.save(ROOT, {...input,safeMode:false});
    const connection = await bridge.restart();
    if(connection.status !== 'online')return {ok:false,settings,error:'Configuration saved, but the bridge could not start: '+connection.detail};
    return { ok: true, settings };
  } catch (error) { return { ok: false, error: error.message }; }
  finally { mcpSaving = false; }
});
const optionalMcp=require('./mcp-presets');
ipcMain.handle('mcp:presets',event=>{if(!isDesktopSender(event))return {ok:false,error:'Desktop app required.'};try{return {ok:true,presets:optionalMcp.list(ROOT)};}catch(error){return {ok:false,error:error.message};}});
ipcMain.handle('mcp:toggle-preset',async(event,input)=>{
 if(!isDesktopSender(event))return {ok:false,error:'Desktop app required.'};
 if(mcpSaving)return {ok:false,error:'Another MCP configuration update is running.'};mcpSaving=true;
 try{const presets=optionalMcp.save(ROOT,input);const connection=await bridge.restart();return {ok:connection.status==='online',presets,error:connection.status==='online'?undefined:connection.detail};}
 catch(error){return {ok:false,error:error.message};}finally{mcpSaving=false;}
});
const { diagnose: diagnoseBlender } = require('./blender-diagnostics');
let blenderDiagnostic = null;
ipcMain.handle('mcp:choose-executable',async event => {
  if(!isDesktopSender(event))return {ok:false,error:'Desktop app required.'};
  const result=await dialog.showOpenDialog(win,{title:'Choose the installed Blender executable',properties:['openFile'],filters:process.platform==='win32'?[{name:'Blender executable',extensions:['exe']}]:[]});
  return {ok:true,path:result.filePaths[0] || ''};
});
ipcMain.handle('mcp:test',async(event,input={}) => {
  if(!isDesktopSender(event))return {ok:false,error:'Desktop app required.'};
  if(blenderDiagnostic)return {ok:false,error:'A Blender startup check is already running.'};
  const controller=new AbortController();blenderDiagnostic=controller;
  try {return {ok:true,diagnostic:await diagnoseBlender({root:ROOT,python:bridge.findPython(),executable:input.executable,signal:controller.signal})};}
  catch(error){return {ok:false,error:error.message};}
  finally {if(blenderDiagnostic===controller)blenderDiagnostic=null;}
});
app.on('before-quit',()=>blenderDiagnostic?.abort());
ipcMain.handle("shell:open-external", async (_e, url) => {
  if (typeof url !== "string" || !/^https:\/\//.test(url)) return { ok: false, error: "Only HTTPS links can be opened." };
  try { await shell.openExternal(url); return { ok: true }; }
  catch (error) { return { ok: false, error: error.message }; }
});

ipcMain.on("win:minimize", () => win && win.minimize());
ipcMain.on("win:toggle-max", () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on("win:close", () => app.quit());

// ── window ────────────────────────────────────────────────────────────────

function createWindow() {
  if(win && !win.isDestroyed())return win;
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    frame: false,
    show: false,
    ...windowEffects(),
    icon: path.join(APP_DIR, "assets", "icon.png"),
    title: "FeatherScript",
    webPreferences: {
      preload: path.join(APP_DIR, "preload.js"),
      additionalArguments: windowEffects().backgroundMaterial ? ["--fs-native-backdrop=acrylic"] : [],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  bindWindowPresence(win);
  const created=win;
  bindStartupWindow(created,{
    decorate:()=>{if(windowEffects().backgroundMaterial)created.setBackgroundMaterial('acrylic');},
    report:message=>bridge.log(message),
  });
  // Register recovery before loading: a fast load or failed compositor may
  // otherwise leave the only instance hidden while it keeps its lock.
  created.loadFile(path.join(APP_DIR,'renderer','index.html')).catch(error=>{
    if(created.isDestroyed())return;
    bridge.log('Workspace could not load: '+error.message);
    dialog.showErrorBox('FeatherScript could not open','The workspace could not load. Re-extract the complete FeatherScript folder and open it again.\n\n'+error.message);
    app.quit();
  });
  win.on("maximize", () => win.webContents.send("win:maximized", true));
  win.on("unmaximize", () => win.webContents.send("win:maximized", false));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) e.preventDefault();
  });
  win.on("closed", () => { if(win===created)win = null; });
  return created;
}

function activateWindow() {
  void app.whenReady().then(()=>{
    if(!win || win.isDestroyed())createWindow();
    revealWindow(win);
  }).catch(error=>{bridge.log('Window activation failed: '+error.message);dialog.showErrorBox('FeatherScript could not open',error.message);});
}
app.on('second-instance',activateWindow);
app.on('activate',activateWindow);

app.whenReady().then(async () => {
  createWindow();
  try { await computer.start(); }
  catch(error) { computer.close(); computer.loadError = 'Computer controller unavailable: ' + error.message; }
  try { await projectService.start(); }catch(error){bridge.log('Project memory service unavailable: '+error.message);}
  if (process.env.FS_NO_BRIDGE !== "1") bridge.start();
  else bridge.setState("stopped", "Bridge launch skipped.");
}).catch(error=>{
  dialog.showErrorBox('FeatherScript could not start',error.message);
  app.quit();
});

app.on("before-quit", () => { projectService.close(); computer.close(); bridge.stop(); });
app.on("window-all-closed", () => app.quit());


ipcMain.handle("vault:choose", async () => {
  const result = await dialog.showOpenDialog(win, { title: "Choose your Obsidian vault", properties: ["openDirectory"] });
  return { canceled: result.canceled, path: result.filePaths[0] || "" };
});
