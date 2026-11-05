"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};
  // Browser preview fallback: the packaged app always provides window.fs. This
  // keeps the UI usable in a plain browser for design checks.
  function createPreviewApi(emptyData) {
    let mem;
    try { mem = JSON.parse(localStorage.getItem("fs.preview.profiles")); } catch {}
    if (!mem?.profiles?.length) {
      const profile = { id: crypto.randomUUID(), name: "Personal", avatar: "", createdAt: Date.now() };
      mem = { profiles: [profile], activeProfileId: profile.id, data: { [profile.id]: emptyData() } };
    }
    const save = () => localStorage.setItem("fs.preview.profiles", JSON.stringify(mem));
    const current = () => mem.profiles.find((profile) => profile.id === mem.activeProfileId);
    return {
      profiles: {
        state: async () => ({ current: current(), profiles: mem.profiles }),
        create: async ({ name }) => {
          name = String(name || "").trim();
          if (name.length < 2 || name.length > 40) return { ok: false, error: "Choose a name between 2 and 40 characters." };
          if (mem.profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: "A profile with that name already exists." };
          const profile = { id: crypto.randomUUID(), name, avatar: "", createdAt: Date.now() };
          mem.profiles.push(profile); mem.activeProfileId = profile.id; mem.data[profile.id] = emptyData(); save();
          return { ok: true, user: profile, profiles: mem.profiles, data: mem.data[profile.id] };
        },
        remove: async (id) => {
          const profile = mem.profiles.find(p => p.id === id);
          if(!profile || mem.profiles.length < 2)return {ok:false,error:'Keep at least one local profile.'};
          if(!confirm(`Remove “${profile.name}” and its local data?`))return {ok:false,error:'Profile removal cancelled.'};
          mem.profiles = mem.profiles.filter(p => p.id !== id); delete mem.data[id];
          if(mem.activeProfileId === id)mem.activeProfileId = mem.profiles[0].id; save();
          return {ok:true,user:current(),profiles:mem.profiles,data:mem.data[mem.activeProfileId]};
        },
        select: async (id) => {
          if (!mem.profiles.some((p) => p.id === id)) return { ok: false, error: "Profile unavailable." };
          mem.activeProfileId = id; save();
          return { ok: true, user: current(), profiles: mem.profiles, data: mem.data[id] };
        },
        update: async ({ name, avatar }) => {
          const profile = current(); profile.name = name; if (avatar) profile.avatar = avatar; save();
          return { ok: true, user: profile, profiles: mem.profiles };
        },
      },
      vault: { choose: async () => ({ canceled: true, path: "" }) },
      data: {
        get: async () => ({ ok: true, data: mem.data[mem.activeProfileId] }),
        save: async (section, value, profileId) => { const target = mem.data[profileId || mem.activeProfileId]; if (!target) return { ok: false, error: "Profile unavailable." }; target[section] = value; save(); return { ok: true }; },
      },
      // Browser-only stand-in so the Skills page can be designed without Electron.
      skills: (() => {
        const KEY = "fs.skills";
        const db = () => {
          try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
        };
        const save = (next) => localStorage.setItem(KEY, JSON.stringify(next));
        const list = () =>
          Object.keys(db()).sort().map((folder) => {
            const files = db()[folder];
            const main = files["SKILL.md"] || "";
            const desc = (main.match(/^description:\s*(.+)$/m) || [])[1] || "";
            return {
              folder,
              name: folder,
              description: desc,
              hasMain: Boolean(main),
              files: Object.keys(files).map((path) => ({ path, size: files[path].length })),
            };
          });
        const put = (folder, path, text) => {
          const next = db();
          next[folder] = next[folder] || {};
          next[folder][path] = text;
          save(next);
          return list();
        };
        return {
          list: async () => ({ ok: true, dir: "skills/", skills: list() }),
          create: async ({ name = "", description = "" }) => {
            const folder = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
            if (!folder) return { ok: false, error: "Give the skill a name." };
            if (db()[folder]) return { ok: false, error: `A skill called "${folder}" already exists.` };
            put(folder, "SKILL.md", `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
            return { ok: true, folder, skills: list() };
          },
          read: async (folder, path = "SKILL.md") => ({ ok: true, path, text: (db()[folder] || {})[path] || "" }),
          write: async (folder, path = "SKILL.md", text = "") => ({ ok: true, skills: put(folder, path, text) }),
          upload: async () => ({ ok: true, added: [], skills: list() }),
          import: async () => ({ ok: true, added: [], skills: list() }),
          importFolder: async () => ({ ok: true, skills: list() }),
          removeFile: async (folder, path) => {
            const next = db();
            if (next[folder]) {
              delete next[folder][path];
              save(next);
            }
            return { ok: true, skills: list() };
          },
          remove: async (folder) => {
            const next = db();
            delete next[folder];
            save(next);
            return { ok: true, skills: list() };
          },
          reveal: async () => ({ ok: true }),
          pathForFile: () => "",
        };
      })(),
      pc: {
        get: async () => ({ok:true,state:{available:false,enabled:false,mode:'ask',roots:[],clients:[],history:[]}}),
        save: async () => ({ok:false,error:'Open the desktop app to configure computer access.'}),
        disable: async () => ({ok:false,error:'Desktop app required.'}),
        revoke: async () => ({ok:false,error:'Desktop app required.'}),
        chooseFolder: async () => ({ok:false,error:'Desktop app required.'}),
      },
      mcp: {
        test: async () => ({ok:false,error:"Open the desktop app to test your Blender installation."}),
        chooseExecutable: async () => ({ok:false,error:"Choose an executable from the desktop app."}),
        get: async () => ({ ok: true, settings: { host: "localhost", port: 9876, safeMode: true, enabled: false } }),
        save: async () => ({ ok: false, error: "Open the desktop app to configure MCP servers." }),
      },
      bridge: {
        status: async () => ({ status: "starting", detail: "" }),
        restart: async () => ({ status: "starting", detail: "" }),
        onState: () => () => {},
      },
      openExternal: async () => {},
      win: { minimize() {}, toggleMax() {}, close() {}, onMaximized: () => () => {} },
    };
  }


  modules.createPreviewApi = createPreviewApi;
})();
