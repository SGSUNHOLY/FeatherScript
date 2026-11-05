// FeatherScript desktop app - the only bridge between the sandboxed renderer
// and the main process (profiles, storage, bridge lifecycle, window controls).

const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("fs", {
  environment: Object.freeze({ nativeBackdrop: process.argv.includes("--fs-native-backdrop=acrylic") }),
  projects:{list:()=>ipcRenderer.invoke('projects:list'),fire:input=>ipcRenderer.invoke('projects:fire',input),saveFile:input=>ipcRenderer.invoke('projects:export',input),delete:input=>ipcRenderer.invoke('projects:delete',input),folder:input=>ipcRenderer.invoke('projects:folder',input)},
  pc: {
    get: () => ipcRenderer.invoke('pc:get'),
    save: input => ipcRenderer.invoke('pc:save',input),
    disable: () => ipcRenderer.invoke('pc:disable'),
    revoke: origin => ipcRenderer.invoke('pc:revoke',{origin}),
    chooseFolder: () => ipcRenderer.invoke('pc:choose-folder'),
  },
  profiles: {
    remove: id => ipcRenderer.invoke("profiles:remove", {id}),
    state: () => ipcRenderer.invoke("profiles:state"),
    create: (input) => ipcRenderer.invoke("profiles:create", input),
    select: (id) => ipcRenderer.invoke("profiles:select", { id }),
    update: (input) => ipcRenderer.invoke("profiles:update", input),
  },
  vault: {
    choose: () => ipcRenderer.invoke("vault:choose"),
  },
  data: {
    get: () => ipcRenderer.invoke("data:get"),
    save: (section, value, profileId) => ipcRenderer.invoke("data:save", { section, value, profileId }),
  },
  skills: {
    list: () => ipcRenderer.invoke("skills:list"),
    create: (input) => ipcRenderer.invoke("skills:create", input),
    read: (folder, path) => ipcRenderer.invoke("skills:read", { folder, path }),
    write: (folder, path, text) => ipcRenderer.invoke("skills:write", { folder, path, text }),
    upload: (folder, target) => ipcRenderer.invoke("skills:upload", { folder, target }),
    import: (folder, paths, target) => ipcRenderer.invoke("skills:import", { folder, paths, target }),
    importFolder: () => ipcRenderer.invoke("skills:import-folder"),
    removeFile: (folder, path) => ipcRenderer.invoke("skills:remove-file", { folder, path }),
    remove: (folder) => ipcRenderer.invoke("skills:delete", { folder }),
    reveal: () => ipcRenderer.invoke("skills:reveal"),
    pathForFile: (file) => {
      try { return webUtils.getPathForFile(file); } catch { return ""; }
    },
  },
  mcp: {
    presets: () => ipcRenderer.invoke("mcp:presets"),
    togglePreset: input => ipcRenderer.invoke("mcp:toggle-preset",input),
    test: input => ipcRenderer.invoke("mcp:test",input),
    chooseExecutable: () => ipcRenderer.invoke("mcp:choose-executable"),
    get: () => ipcRenderer.invoke("mcp:get"),
    save: (input) => ipcRenderer.invoke("mcp:save", input),
  },
  bridge: {
    status: () => ipcRenderer.invoke("bridge:status"),
    restart: () => ipcRenderer.invoke("bridge:restart"),
    onState: (cb) => {
      const handler = (_e, state) => cb(state);
      ipcRenderer.on("bridge:state", handler);
      return () => ipcRenderer.removeListener("bridge:state", handler);
    },
  },
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  win: {
    minimize: () => ipcRenderer.send("win:minimize"),
    toggleMax: () => ipcRenderer.send("win:toggle-max"),
    close: () => ipcRenderer.send("win:close"),
    onMaximized: (cb) => {
      const handler = (_e, value) => cb(value);
      ipcRenderer.on("win:maximized", handler);
      return () => ipcRenderer.removeListener("win:maximized", handler);
    },
  },
});
