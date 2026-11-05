// FeatherScript desktop app - renderer.
// Wires local profiles, the dashboard and the live bridge socket.
// Every surface here enters with motion; nothing snaps into place.

"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
let reduceMotion = motionPreference.matches;
motionPreference.addEventListener("change", (event) => {
  reduceMotion = event.matches;
  if (reduceMotion) document.getAnimations().forEach((animation) => animation.cancel());
});
const THEME_KEY = "fs.theme";

const emptyData = () => ({
  memory: "",
  notes: [],
  settings: { customPrompt: "", theme: "default", feel: { sound: "soft", motion: "full", intensity: 0.6, music: "on", musicVolume: 0.5 } },
});

const state = {
  user: null,
  data: emptyData(),
  avatarDraft: "",
  skills: [],
  skillDir: "",
  tools: [],
  servers: [],
  bridge: { status: "starting", detail: "" },
  connected: false,
  page: "overview",
  busy: false,
  profiles: [],
  switchingProfile: false,
};

let blenderController = null, projectController = null;
const api = window.fs || FSRenderer.createPreviewApi(emptyData);
document.body.classList.toggle("has-native-backdrop", api.environment?.nativeBackdrop === true);
const juice = FSRenderer.Juice.createJuice({
  feel: emptyData().settings.feel,
  onChange: (feel) => saveFeel(feel),
});
juice.bindControls();
const commandLibrary = FSRenderer.createCommandLibrary({
  drawer: $(".overview-command-drawer"), container: $("#tool-chips"),
  empty: $("#tools-empty"), search: $("#tool-search"),
  isVisible: () => state.page === "overview",
});


const appearanceController = FSRenderer.createAppearance({
  $, state, api, settingsPayload, refresh: () => juice.refresh(),
});

// ── theme ─────────────────────────────────────────────────────────────────
for (const preset of FSThemePresets.filter((p) => p.background)) {
  const card = document.createElement("button");
  card.type = "button"; card.className = "theme-card"; card.dataset.theme = preset.id;
  card.dataset.sfx = "none";
  const preview = document.createElement("span");
  preview.className = `theme-preview preview-${preset.id}`; preview.setAttribute("aria-hidden", "true");
  for (const name of ["tp-side", "tp-bar", "tp-block", "tp-block tp-block-2"]) {
    const swatch = document.createElement("span"); swatch.className = name; preview.append(swatch);
  }
  const meta = document.createElement("span"); meta.className = "theme-meta";
  const name = document.createElement("b"); name.textContent = preset.name;
  const description = document.createElement("span"); description.textContent = preset.description;
  meta.append(name, description);
  const pick = document.createElement("span"); pick.className = "theme-pick"; pick.setAttribute("aria-hidden", "true");
  card.append(preview, meta, pick); $("#theme-grid").append(card);
}


$('#theme-count-copy').textContent = `Find your color. ${FSThemePresets.length} light and dark palettes.`;
$('#theme-search').addEventListener('input', event => {
  const query = event.target.value.trim().toLowerCase(); let visible = 0;
  $$('.theme-card').forEach(card => { card.hidden = !card.textContent.toLowerCase().includes(query); if(!card.hidden)visible++; });
  $('#theme-search-empty').hidden = visible > 0;
});
function applyTheme(theme, persist = true) {
  const t = FSThemePresets.some((preset) => preset.id === theme) ? theme : "default";
  document.body.dataset.theme = t;
  if (persist) localStorage.setItem(THEME_KEY, t);
  $$(".theme-card").forEach((card) => {
    const active = card.dataset.theme === t;
    card.classList.toggle("is-active", active);
    card.setAttribute("aria-pressed", String(active));
  });
  appearanceController.apply();
}

// ── small UI helpers ──────────────────────────────────────────────────────

let toastTimer = 0;
function toast(message, tone = "info") {
  const el = $("#toast");
  el.textContent = message;
  el.dataset.tone = tone;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  if (tone === "success" || tone === "error") juice.signal(tone);
}

const flashTimers = new WeakMap();
function flash(el, text) {
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(flashTimers.get(el));
  flashTimers.set(el, setTimeout(() => el.classList.remove("show"), 1800));
}

function countUp(el, target) {
  const to = Math.max(0, Number(target) || 0);
  if (el._shown === to) return;
  el._shown = to;
  if (reduceMotion) { el.textContent = String(to); return; }
  const from = Number(el.textContent) || 0;
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / 620);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const initialsOf = (name) =>
  (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase() || "?";

// ── window chrome ─────────────────────────────────────────────────────────

$("#win-min").addEventListener("click", () => api.win.minimize());
$("#win-max").addEventListener("click", () => api.win.toggleMax());
$("#win-close").addEventListener("click", () => api.win.close());
$(".chrome-drag").addEventListener("dblclick", () => api.win.toggleMax());

// ── local profile images ──────────────────────────────────────────────────

function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error("Pick an image file."));
    if (file.size > 12 * 1024 * 1024) return reject(new Error("That image is a little too large."));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };
    img.src = url;
  });
}

function paintAvatar(imgEl, fallbackEl, src) {
  if (!imgEl) return;
  if (src) {
    imgEl.src = src;
    imgEl.hidden = false;
    if (fallbackEl) fallbackEl.style.opacity = "0";
  } else {
    imgEl.hidden = true;
    imgEl.removeAttribute("src");
    if (fallbackEl) fallbackEl.style.opacity = "1";
  }
}

async function enterApp() {
  hydrateApp(); renderAll();
  document.body.dataset.view = "app";
  document.body.classList.add("booted");
  startBridge();
}

// ── app hydration ─────────────────────────────────────────────────────────

function setUserChrome() {
  const user = state.user || { name: "Personal", avatar: "" };
  const first = (user.name || "").split(/\s+/)[0] || "";
  $("#side-name").textContent = user.name || "FeatherScript";
  $("#side-profile-label").textContent = "Local profile";
  $("#side-initials").textContent = initialsOf(user.name);
  if (user.avatar) {
    $("#side-avatar-img").src = user.avatar;
    $("#side-avatar-img").hidden = false;
    $("#side-initials").style.opacity = "0";
  } else {
    $("#side-avatar-img").hidden = true;
    $("#side-avatar-img").removeAttribute("src");
    $("#side-initials").style.opacity = "1";
  }

  $("#settings-name").value = user.name || "";
  profileController.render();
  $("#settings-fallback").textContent = initialsOf(user.name);
  paintAvatar($("#settings-avatar-img"), $("#settings-fallback"), user.avatar);

  const title = $("#page-title");
  if (state.page === "overview") title.textContent = greeting(first);
}

function greeting(first) {
  const h = new Date().getHours();
  const part = h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return first ? `${part}, ${first}` : part;
}

function hydrateApp() {
  const settings = { ...emptyData().settings, ...(state.data.settings || {}) };
  settings.feel = { ...emptyData().settings.feel, ...(state.data.settings?.feel || {}) };
  state.data.settings = settings;
  $("#memory-editor").value = state.data.memory || "";
  $("#prompt-editor").value = settings.customPrompt || "";
  updateMemoryCount();
  appearanceController.hydrate(settings.appearance);
  applyTheme(settings.theme);
  juice.apply(settings.feel);
  setUserChrome();
  setPage(state.page || "overview", false);
}

function settingsPayload() {
  return {
    customPrompt: state.data.settings.customPrompt || "",
    theme: state.data.settings.theme || "default",
    feel: state.data.settings.feel,
    appearance: state.data.settings.appearance,
  };
}

let feelTimer = 0;
function saveFeel(feel) {
  state.data.settings.feel = feel;
  flash($("#feel-state"), "Saving…");
  clearTimeout(feelTimer);
  feelTimer = setTimeout(async () => {
    const res = await api.data.save("settings", settingsPayload());
    flash($("#feel-state"), res.ok ? "Saved" : "Not saved");
  }, 400);
}

function renderAll() {
  loadSkills();
  projectController?.load();
  renderNotes();
  renderChips();
  setUserChrome();
  renderBridge();
  countUp($("#stat-tools"), state.tools.length);
}

// ── navigation ────────────────────────────────────────────────────────────

const PAGE_META = {
  overview: () => ({ kicker: "Overview", title: greeting((state.user?.name || "").split(/\s+/)[0]) }),
  providers: () => ({ kicker: "Launchpad", title: "Providers" }),
  memory: () => ({ kicker: "Projects", title: "Projects & memory" }),
  skills: () => ({ kicker: "Skills", title: "Skills" }),
  notes: () => ({ kicker: "Notes", title: "Notes" }),
  settings: () => ({ kicker: "Settings", title: "Settings" }),
  mcps: () => ({ kicker: "Integrations", title: "MCPs" }),
  guides: () => ({ kicker: "Field notes", title: "Guides" }),
};

const navItems = $$(".nav-item");
navItems.forEach(button => button.setAttribute("aria-label", $(".nav-copy b",button).textContent));
function positionNavInk() {
  const active = navItems.find((button) => button.classList.contains("is-active"));
  if (!active) return;
  const ink = $("#nav-ink");
  const horizontal = document.body.dataset.layout !== "default" && !!document.body.dataset.layout;
  ink.style.width = horizontal ? `${active.offsetWidth}px` : "";
  ink.style.height = `${active.offsetHeight}px`;
  ink.style.transform = horizontal ? `translate3d(${active.offsetLeft}px,${active.offsetTop}px,0)` : `translateY(${active.offsetTop}px)`;
}


const headingAnimations = new Map();
function setPage(page, animate = true) {
  if (!PAGE_META[page]) page = "overview";
  const changed = state.page !== page;
  state.page = page;
  headingAnimations.forEach((animation) => animation.cancel());
  headingAnimations.clear();
  navItems.forEach((button) => {
    const active = button.dataset.page === page;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  $$(".page").forEach((p) => p.classList.toggle("is-active", p.dataset.page === page));

  positionNavInk();
  if (page === "overview") commandLibrary.render();
  if (page === "memory") projectController?.load();

  const meta = PAGE_META[page]();
  $("#page-kicker").textContent = meta.kicker;
  $("#page-title").textContent = meta.title;

  const scroller = $("#pages");
  if (scroller.scrollTop > 0) {
    if (changed || reduceMotion) scroller.scrollTop = 0;
    else scroller.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (changed && animate && !reduceMotion && document.body.dataset.motion === "full") {
    [["#page-title", 0], ["#page-kicker", 20]].forEach(([sel, delay]) => {
      const el = $(sel);
      const animation = el.animate(
        [{ opacity: 0, transform: "translateY(5px)" }, { opacity: 1, transform: "none" }],
        { duration: 300, delay, easing: "cubic-bezier(.16,1,.3,1)" }
      );
      headingAnimations.set(el, animation);
    });
  }
}

navItems.forEach((button) => button.addEventListener("click", () => setPage(button.dataset.page)));
$("#side-nav").addEventListener("keydown", (event) => {
  const current = navItems.indexOf(document.activeElement);
  const horizontal = document.body.dataset.layout && document.body.dataset.layout !== "default";
  if (current < 0 || !(horizontal ? ["ArrowLeft","ArrowRight","Home","End"] : ["ArrowUp","ArrowDown","Home","End"]).includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? navItems.length - 1 : (current + ((event.key === "ArrowDown" || event.key === "ArrowRight") ? 1 : -1) + navItems.length) % navItems.length;
  navItems[next].focus({ preventScroll: true });
  navItems[next].scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduceMotion ? "instant" : "smooth" });
  setPage(navItems[next].dataset.page);
});
window.addEventListener("fs:layoutchange", positionNavInk);
new ResizeObserver(positionNavInk).observe($("#side-nav"));
document.fonts.ready.then(positionNavInk);


// ── memory + custom prompt ────────────────────────────────────────────────

function updateMemoryCount() {
  const n = $("#memory-editor").value.length;
  $("#memory-count").textContent = `${n.toLocaleString()} character${n === 1 ? "" : "s"}`;
}

let memoryTimer = 0;
$("#memory-editor").addEventListener("input", () => {
  state.data.memory = $("#memory-editor").value;
  updateMemoryCount();
  flash($("#memory-state"), "Saving…");
  clearTimeout(memoryTimer);
  memoryTimer = setTimeout(async () => {
    const res = await api.data.save("memory", state.data.memory);
    flash($("#memory-state"), res.ok ? "Saved" : "Not saved");
  }, 700);
});

let promptTimer = 0;
$("#prompt-editor").addEventListener("input", () => {
  const value = $("#prompt-editor").value;
  state.data.settings.customPrompt = value;
  flash($("#prompt-state"), "Saving…");
  clearTimeout(promptTimer);
  promptTimer = setTimeout(async () => {
    const res = await api.data.save("settings", settingsPayload());
    flash($("#prompt-state"), res.ok ? "Saved" : "Not saved");
  }, 800);
});

// ── skills + notes ────────────────────────────────────────────────────────

const fmtDate = (ts) => {
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
};

function buildItem({ id, title, body, time, icon, onDelete }) {
  const item = document.createElement("article");
  item.className = "item";
  item.dataset.id = id;

  const text = document.createElement("div");
  text.className = "item-body";
  const h = document.createElement("h4");
  h.textContent = title;
  text.appendChild(h);
  if (body) {
    const p = document.createElement("p");
    p.textContent = body;
    text.appendChild(p);
  }
  const when = document.createElement("span");
  when.className = "item-time";
  when.textContent = time;
  text.appendChild(when);
  item.appendChild(text);

  const actions = document.createElement("div");
  actions.className = "item-actions";
  const del = document.createElement("button");
  del.type = "button";
  del.className = "icon-btn";
  del.title = "Remove";
  del.setAttribute("aria-label", "Remove");
  del.innerHTML = `<svg><use href="#${icon}"/></svg>`;
  del.addEventListener("click", () => onDelete(id));
  actions.appendChild(del);
  item.appendChild(actions);
  return item;
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

const fmtSize = (n) => {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function fileChip(path, main) {
  const chip = el("span", main ? "file-chip is-main" : "file-chip");
  chip.innerHTML = '<svg><use href="#i-file"/></svg>';
  chip.appendChild(document.createTextNode(path));
  chip.title = path;
  return chip;
}

function applySkills(res) {
  if (!res) return;
  if (!res.ok) {
    toast(res.error || "The skills folder could not be read.", "error");
    return;
  }
  if (res.dir) state.skillDir = res.dir;
  if (Array.isArray(res.skills)) {
    state.skills = res.skills;
    renderSkills();
  }
  syncSheet();
}

async function loadSkills() {
  try {
    applySkills(await api.skills.list());
  } catch {
    applySkills({ ok: false, error: "The skills folder could not be read." });
  }
}

function renderSkills() {
  const list = $("#skill-list");
  const skills = state.skills || [];
  $("#skills-count").textContent = String(skills.length);
  if (state.skillDir) {
    const pathEl = $("#skills-path");
    pathEl.textContent = state.skillDir;
    pathEl.title = state.skillDir;
  }
  list.innerHTML = "";

  if (!skills.length) {
    const empty = el("div", "list-empty");
    empty.textContent = "No skills yet. Create one above, or import an existing skill folder with its SKILL.md.";
    list.appendChild(empty);
    return;
  }

  skills.forEach((skill, i) => {
    const card = el("article", "item skill-card");
    card.style.animationDelay = `${i * 40}ms`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.dataset.folder = skill.folder;
    card.addEventListener("click", () => openSheet(skill.folder));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openSheet(skill.folder);
      }
    });

    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.classList.add("is-drop");
    });
    card.addEventListener("dragleave", () => card.classList.remove("is-drop"));
    card.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove("is-drop");
      const paths = Array.from(e.dataTransfer.files || [])
        .map((file) => api.skills.pathForFile(file))
        .filter(Boolean);
      if (!paths.length) return;
      applySkills(await api.skills.import(skill.folder, paths));
      toast(paths.length > 1 ? `Added ${paths.length} files` : "File added", "success");
    });

    const body = el("div", "item-body");
    const top = el("div", "skill-top");
    const title = el("h4");
    title.textContent = skill.name || skill.folder;
    const folder = el("span", "skill-folder");
    folder.textContent = skill.folder;
    top.append(title, folder);
    body.appendChild(top);

    const desc = el("p", skill.description ? "skill-desc" : "skill-desc is-muted");
    desc.textContent = skill.description || "No description yet - open it and write one in SKILL.md.";
    body.appendChild(desc);

    const chips = el("div", "skill-files");
    skill.files.slice(0, 5).forEach((file) => chips.appendChild(fileChip(file.path, file.path === "SKILL.md")));
    if (skill.files.length > 5) {
      const more = fileChip(`+${skill.files.length - 5} more`);
      more.classList.remove("is-main");
      chips.appendChild(more);
    }
    if (!skill.hasMain) {
      const missing = fileChip("SKILL.md missing");
      missing.classList.add("is-missing");
      chips.appendChild(missing);
    }
    body.appendChild(chips);
    card.appendChild(body);

    const actions = el("div", "skill-actions");
    const open = el("button", "ghost-btn");
    open.type = "button";
    open.innerHTML = '<span>Open</span>';
    open.addEventListener("click", (e) => {
      e.stopPropagation();
      openSheet(skill.folder);
    });
    const add = el("button", "icon-btn");
    add.type = "button";
    add.title = "Add files";
    add.setAttribute("aria-label", "Add files");
    add.innerHTML = '<svg><use href="#i-plus"/></svg>';
    add.addEventListener("click", async (e) => {
      e.stopPropagation();
      applySkills(await api.skills.upload(skill.folder));
    });
    const del = el("button", "icon-btn");
    del.type = "button";
    del.title = "Move skill to the recycle bin";
    del.setAttribute("aria-label", "Move skill to the recycle bin");
    del.innerHTML = '<svg><use href="#i-trash"/></svg>';
    let armed = false;
    let armTimer = 0;
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!armed) {
        armed = true;
        del.classList.add("is-armed");
        del.title = "Click again to confirm";
        armTimer = setTimeout(() => {
          armed = false;
          del.classList.remove("is-armed");
          del.title = "Move skill to the recycle bin";
        }, 4000);
        return;
      }
      clearTimeout(armTimer);
      applySkills(await api.skills.remove(skill.folder));
      toast("Skill moved to the recycle bin");
    });
    actions.append(open, add, del);
    card.appendChild(actions);
    list.appendChild(card);
  });
}

// ── skill sheet (SKILL.md + bundled files) ────────────────────────────────

const sheet = $("#skill-sheet");
const sheetText = $("#sheet-text");
const sheetState = { folder: "", path: "SKILL.md", dirty: false, timer: 0, deleteStep: 0 };

function updateSheetCount() {
  const n = sheetText.value.length;
  $("#sheet-count").textContent = `${n.toLocaleString()} character${n === 1 ? "" : "s"}`;
}

function currentSkill() {
  return (state.skills || []).find((s) => s.folder === sheetState.folder) || null;
}

let sheetMotionGeneration = 0;
let sheetHideTimer = 0;
function openSheet(folder) {
  const skill = (state.skills || []).find((s) => s.folder === folder);
  if (!skill) return;
  const generation = ++sheetMotionGeneration;
  clearTimeout(sheetHideTimer);
  sheetState.folder = folder;
  sheetState.path = "SKILL.md";
  sheetState.dirty = false;
  $("#sheet-title").textContent = skill.name || folder;
  $("#sheet-folder").textContent = folder;
  $("#sheet-state").textContent = "";
  resetDeleteButton();
  sheet.hidden = false;
  document.body.classList.add("sheet-open");
  requestAnimationFrame(() => {
    if (generation === sheetMotionGeneration && !sheet.hidden) sheet.classList.add("is-open");
  });
  juice.play("open");
  renderSheetFiles();
  openSheetFile("SKILL.md", true);
}

async function closeSheet(save = true) {
  const generation = ++sheetMotionGeneration;
  clearTimeout(sheetHideTimer);
  clearTimeout(sheetState.timer);
  const wasOpen = sheet.classList.contains("is-open");
  if (save && sheetState.dirty) await saveSheetFile(false);
  if (generation !== sheetMotionGeneration) return;
  sheet.classList.remove("is-open");
  document.body.classList.remove("sheet-open");
  if (wasOpen) juice.play("close");
  sheetState.folder = "";
  sheetState.dirty = false;
  sheetHideTimer = setTimeout(() => {
    if (generation === sheetMotionGeneration && !sheet.classList.contains("is-open")) sheet.hidden = true;
  }, reduceMotion ? 0 : 240);
}

async function saveSheetFile(notify = true) {
  if (!sheetState.folder) return { ok: false };
  const res = await api.skills.write(sheetState.folder, sheetState.path, sheetText.value);
  if (res.ok) {
    sheetState.dirty = false;
    if (Array.isArray(res.skills)) state.skills = res.skills;
    renderSkills();
    renderSheetFiles();
    if (notify) flash($("#sheet-state"), "Saved");
  } else {
    flash($("#sheet-state"), res.error || "Not saved");
  }
  return res;
}

async function openSheetFile(path, force = false) {
  if (!sheetState.folder) return;
  if (!force && path === sheetState.path) return;
  clearTimeout(sheetState.timer);
  if (sheetState.dirty) await saveSheetFile(false);
  const res = await api.skills.read(sheetState.folder, path);
  if (!res.ok) {
    flash($("#sheet-state"), res.error || "Could not open that file");
    return;
  }
  sheetState.path = path;
  sheetState.dirty = false;
  sheetText.value = res.text || "";
  $("#sheet-file-chip b").textContent = path;
  $("#sheet-state").textContent = "";
  updateSheetCount();
  renderSheetFiles();
  sheetText.focus({ preventScroll: true });
}

function renderSheetFiles() {
  const listEl = $("#sheet-file-list");
  const skill = currentSkill();
  listEl.innerHTML = "";
  if (!skill) return;
  if (!skill.files.length) {
    const empty = el("p", "hint");
    empty.textContent = "No files yet.";
    listEl.appendChild(empty);
    return;
  }
  skill.files.forEach((file) => {
    const row = el("div", "file-row");
    if (file.path === sheetState.path) row.classList.add("is-active");
    const open = el("button", "file-open");
    open.type = "button";
    open.title = file.path;
    open.innerHTML = '<svg><use href="#i-file"/></svg>';
    open.appendChild(document.createTextNode(file.path));
    open.addEventListener("click", () => openSheetFile(file.path));
    const size = el("span", "file-size");
    size.textContent = fmtSize(file.size);
    row.append(open, size);
    if (file.path !== "SKILL.md") {
      const rm = el("button", "icon-btn");
      rm.type = "button";
      rm.title = "Remove file";
      rm.setAttribute("aria-label", `Remove ${file.path}`);
      rm.innerHTML = '<svg><use href="#i-trash"/></svg>';
      rm.addEventListener("click", async () => {
        const res = await api.skills.removeFile(sheetState.folder, file.path);
        if (!res.ok) {
          flash($("#sheet-state"), res.error || "Not removed");
          return;
        }
        if (sheetState.path === file.path) {
          sheetState.path = "SKILL.md";
          await openSheetFile("SKILL.md", true);
        }
        applySkills(res);
      });
      row.appendChild(rm);
    }
    listEl.appendChild(row);
  });
}

function syncSheet() {
  if (!sheetState.folder || sheet.hidden) return;
  const skill = currentSkill();
  if (!skill) {
    closeSheet(false);
    return;
  }
  $("#sheet-title").textContent = skill.name || skill.folder;
  renderSheetFiles();
}

function resetDeleteButton() {
  sheetState.deleteStep = 0;
  const btn = $("#sheet-delete");
  btn.classList.remove("is-armed");
  btn.querySelector("span").textContent = "Move skill to recycle bin";
}

sheetText.addEventListener("input", () => {
  sheetState.dirty = true;
  updateSheetCount();
  flash($("#sheet-state"), "Saving…");
  clearTimeout(sheetState.timer);
  sheetState.timer = setTimeout(async () => {
    const res = await saveSheetFile(false);
    if (res.ok) flash($("#sheet-state"), "Saved");
  }, 900);
});

$("#sheet-close").addEventListener("click", () => closeSheet(true));
sheet.querySelectorAll("[data-close-sheet]").forEach((node) => node.addEventListener("click", () => closeSheet(true)));
$("#sheet-save").addEventListener("click", async () => {
  if (sheetState.dirty) await saveSheetFile(false);
  else flash($("#sheet-state"), "Already saved");
  await closeSheet(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheet.classList.contains("is-open")) {
    e.preventDefault();
    closeSheet(true);
  }
});

async function uploadToSheet(target) {
  if (!sheetState.folder) return;
  clearTimeout(sheetState.timer);
  if (sheetState.dirty) await saveSheetFile(false);
  const res = await api.skills.upload(sheetState.folder, target);
  if (!res.ok) {
    flash($("#sheet-state"), res.error || "Nothing added");
    return;
  }
  applySkills(res);
  if (res.added && res.added.length) flash($("#sheet-state"), `Added ${res.added.length} file(s)`);
  else if (res.skipped && res.skipped.length) flash($("#sheet-state"), "Too large or unreadable");
}

$("#sheet-add-ref").addEventListener("click", () => uploadToSheet("references"));
$("#sheet-add-script").addEventListener("click", () => uploadToSheet("scripts"));

const sheetDrop = $("#sheet-drop");
sheetDrop.addEventListener("dragover", (e) => {
  e.preventDefault();
  sheetDrop.classList.add("is-hot");
});
sheetDrop.addEventListener("dragleave", () => sheetDrop.classList.remove("is-hot"));
sheetDrop.addEventListener("drop", async (e) => {
  e.preventDefault();
  sheetDrop.classList.remove("is-hot");
  const paths = Array.from(e.dataTransfer.files || [])
    .map((file) => api.skills.pathForFile(file))
    .filter(Boolean);
  if (!paths.length || !sheetState.folder) return;
  clearTimeout(sheetState.timer);
  if (sheetState.dirty) await saveSheetFile(false);
  const res = await api.skills.import(sheetState.folder, paths);
  applySkills(res);
  if (res.added && res.added.length) flash($("#sheet-state"), `Added ${res.added.length} file(s)`);
  else flash($("#sheet-state"), "Nothing added");
});

$("#sheet-delete").addEventListener("click", async () => {
  if (!sheetState.folder) return;
  const btn = $("#sheet-delete");
  if (sheetState.deleteStep === 0) {
    sheetState.deleteStep = 1;
    btn.classList.add("is-armed");
    btn.querySelector("span").textContent = "Click again to confirm";
    setTimeout(() => {
      if (sheetState.deleteStep === 1) resetDeleteButton();
    }, 4000);
    return;
  }
  const folder = sheetState.folder;
  resetDeleteButton();
  clearTimeout(sheetState.timer);
  const res = await api.skills.remove(folder);
  if (!res.ok) {
    flash($("#sheet-state"), res.error || "Not removed");
    return;
  }
  await closeSheet(false);
  applySkills(res);
  toast("Skill moved to the recycle bin");
});

$("#skills-import").addEventListener("click", async () => {
  const res = await api.skills.importFolder();
  if (!res.ok) {
    toast(res.error || "That folder could not be imported", "error");
    return;
  }
  if (Array.isArray(res.skills)) {
    applySkills(res);
    if (res.folder) {
      toast(`Imported "${res.folder}"`, "success");
      openSheet(res.folder);
      return;
    }
  }
});

$("#skills-open").addEventListener("click", async () => {
  await api.skills.reveal();
  toast("Opened the skills folder");
});

$("#skills-refresh").addEventListener("click", async () => {
  await loadSkills();
  toast("Skills reloaded");
});

$("#skill-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#skill-name").value.trim();
  if (!name) {
    $("#skill-name").focus();
    return;
  }
  const description = $("#skill-desc").value.trim();
  const res = await api.skills.create({ name, description });
  if (!res.ok) {
    toast(res.error || "Could not create that skill", "error");
    $("#skill-name").focus();
    return;
  }
  $("#skill-name").value = "";
  $("#skill-desc").value = "";
  applySkills(res);
  if (res.folder) openSheet(res.folder);
});

function renderNotes() {
  const list = $("#note-list");
  const notes = state.data.notes || [];
  $("#notes-count").textContent = String(notes.length);
  list.innerHTML = "";
  if (!notes.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No notes yet. The next good idea goes here.";
    list.appendChild(empty);
    return;
  }
  notes.forEach((note, i) => {
    const item = buildItem({
      id: note.id,
      title: "Field note",
      body: note.text,
      time: fmtDate(note.createdAt),
      icon: "i-trash",
      onDelete: removeNote,
    });
    item.style.animationDelay = `${i * 45}ms`;
    list.appendChild(item);
  });
}

async function saveNotes() {
  await api.data.save("notes", state.data.notes);
}

async function removeNote(id) {
  state.data.notes = state.data.notes.filter((n) => n.id !== id);
  projectController?.load();
  renderNotes();
  await saveNotes();
}

$("#note-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#note-text").value.trim();
  if (!text) {
    $("#note-text").focus();
    return;
  }
  state.data.notes.unshift({ id: crypto.randomUUID(), text: text.slice(0, 20000), createdAt: Date.now() });
  $("#note-text").value = "";
  projectController?.load();
  renderNotes();
  await saveNotes();
  toast("Note added", "success");
});

// ── settings ──────────────────────────────────────────────────────────────

$("#settings-avatar").addEventListener("click", () => $("#settings-avatar-file").click());

$("#settings-avatar-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    state.avatarDraft = await fileToAvatar(file);
    paintAvatar($("#settings-avatar-img"), $("#settings-fallback"), state.avatarDraft);
  } catch (err) {
    toast(err.message, "error");
  }
});

$("#save-profile").addEventListener("click", async () => {
  const name = $("#settings-name").value.trim();
  if (name.length < 2) {
    flash($("#profile-state"), "Name is too short");
    $("#settings-name").focus();
    return;
  }
  const res = await api.profiles.update({ name, ...(state.avatarDraft ? { avatar: state.avatarDraft } : {}) });
  if (!res.ok) {
    flash($("#profile-state"), res.error || "Not saved");
    return;
  }
  state.user = res.user;
  state.profiles = res.profiles || state.profiles;
  state.avatarDraft = "";
  setUserChrome();
  setPage(state.page, false);
  flash($("#profile-state"), "Profile saved");
  toast("Profile saved", "success");
});

$$(".theme-card").forEach((card) => {
  card.addEventListener("click", async () => {
    const theme = card.dataset.theme;
    const hadCustom = state.data.settings.appearance?.enabled;
    appearanceController.usePreset();
    if (state.data.settings.theme === theme && !hadCustom) return;
    state.data.settings.theme = theme;
    applyTheme(theme);
    juice.play("toggle");
    flash($("#theme-state"), "Saving…");
    const res = await api.data.save("settings", settingsPayload());
    if (res.ok) socket.send({ type: "set_theme", theme });
    flash($("#theme-state"), res.ok ? "Saved" : "Not saved");
  });
});

$("#bridge-restart").addEventListener("click", async () => {
  state.connected = false;
  state.bridge.status = "starting";
  renderBridge();
  toast("Restarting the bridge");
  const res = await api.bridge.restart();
  if (res) state.bridge = { status: res.status, detail: res.detail };
  renderBridge();
});

// ── bridge socket ─────────────────────────────────────────────────────────


const socket = new FSRenderer.BridgeSocket(handleBridgeMessage, (open) => {
  state.connected = open;
  if (!open) state.bridge.status = state.bridge.status === "error" ? "error" : "starting";
  else state.bridge.status = "online";
  renderBridge();
}, (client) => client.send({ type: "set_theme", theme: state.data.settings.theme || "default" }));
window.addEventListener("beforeunload", () => socket.stop());

function startBridge() {
  socket.start();
}

function handleBridgeMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "theme" && FSThemePresets.some((preset) => preset.id === msg.theme)) {
    state.data.settings.theme = msg.theme;
    applyTheme(msg.theme);
    api.data.save("settings", state.data.settings).catch(() => {});
  }
  if (msg.type === "vault_settings" && msg.ok && !vaultController.isSaving) vaultController.render(msg.settings);
  if (Array.isArray(msg.servers)) state.servers = msg.servers;
  if (msg.type === "tools" || msg.type === "connected") {
    if (Array.isArray(msg.tools)) {
      state.tools = msg.tools;
      renderChips();
      countUp($("#stat-tools"), msg.tools.length);
    }
    renderBlenderTools();
    updateFromBridge(msg);
  } else if (msg.type === "studio_status") {
    renderBlenderTools();
    updateFromBridge(msg);
  }
}

function updateFromBridge(msg) {
  if (Array.isArray(msg.servers)) {
    // "connected" counted the process, which the StudioMCP proxy keeps answering
    // even with no Studio attached. Only a server whose commands can actually run
    // is reported as working.
    const up = msg.servers.filter((s) => ZSServerStatus.state(s) === "working").length;
    countUp($("#stat-servers"), msg.servers.length);
    $("#stat-servers").nextElementSibling.textContent = `${up} of ${msg.servers.length} working`;
  }

  // bridge.py reports two booleans: studio (a place is loaded and usable) and
  // studio_app (Studio is attached to the MCP server). null means "unknown".
  const attached = msg.studio === true;
  const appUp = attached || msg.studio_app === true;
  const procUp = msg.studio_proc === true;
  let value = "Not running";
  let foot = "open Roblox Studio to connect";
  let row = "Not running";
  if (attached) {
    value = "Connected";
    foot = "place open, MCP attached";
    row = "Place open";
  } else if (appUp) {
    value = "No place";
    foot = "open a place in Studio";
    row = "Studio attached, no place";
  } else if (procUp) {
    value = "Studio open";
    foot = "its MCP server is switched off";
    row = "Studio open, MCP off";
  }
  $("#stat-studio").textContent = value;
  $("#stat-studio-foot").textContent = foot;
  $("#bridge-studio-text").textContent = row;
}

function renderChips() {
  commandLibrary.update(state.tools, state.connected);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && socket.ws && socket.ws.readyState === 1) {
    socket.send({ type: "list_tools", id: Date.now() });
  }
});

// ── bridge status chrome ──────────────────────────────────────────────────

let bridgeWasOnline = false;
function renderBridge() {
  renderBlenderTools();
  const pill = $("#conn-pill");
  const label = $("#conn-text");
  const status = state.bridge.status;
  let tone = "idle";
  let text = "Bridge starting";

  if (state.connected && !bridgeWasOnline) juice.signal("connect");
  bridgeWasOnline = Boolean(state.connected);

  if (state.connected) {
    tone = "on";
    text = "Bridge online";
  } else if (status === "error") {
    tone = "err";
    text = "Bridge offline";
  } else if (status === "stopped") {
    tone = "err";
    text = "Bridge off";
  } else if (status === "online") {
    text = "Connecting to bridge";
  }

  pill.dataset.tone = tone;
  label.textContent = text;

  const stat = $("#stat-bridge");
  stat.textContent = { on: "Online", error: "Offline", stopped: "Off", starting: "Starting", online: "Online" }[
    state.connected ? "on" : status
  ] || "Starting";

  $("#overview-readiness").textContent = state.connected ? "Local bridge online · choose a chat to start" : status === "error" ? "Bridge needs attention · check Settings" : "Preparing your local bridge…";
  $("#overview-readiness").classList.toggle("is-online", state.connected);
  const statusText = $("#bridge-status-text");
  if (state.connected) statusText.textContent = "Connected";
  else if (status === "error" || status === "stopped") statusText.textContent = state.bridge.detail || "Not connected";
  else statusText.textContent = state.bridge.detail || "Starting…";
}

try {
  api.bridge.onState((next) => {
    if (!next) return;
    state.bridge = { status: next.status || "starting", detail: next.detail || "" };
    if (next.status === "error") state.connected = false;
    renderBridge();
  });
} catch {}

// ── boot ──────────────────────────────────────────────────────────────────

let booted = false;
async function boot() {
  if (booted) return;
  booted = true;
  const startedAt = performance.now();
  const screen = $("#boot-screen");
  screen.hidden = false; screen.classList.remove("is-leaving");
  screen.setAttribute("aria-busy", "true");
  $("#boot-retry").hidden = true;
  for (const id of ["profile", "memory", "workspace"]) $(`#boot-${id}-stage`).classList.remove("is-ready");
  applyTheme(localStorage.getItem(THEME_KEY) || "default", false);
  renderBridge();
  try {
    $("#boot-status").textContent = "Opening your local profile…";
    const profiles = await api.profiles.state();
    state.user = profiles.current; state.profiles = profiles.profiles;
    $("#boot-profile-stage").classList.add("is-ready");
    $("#boot-status").textContent = "Bringing back your memory and notes…";
    const result = await api.data.get();
    if (!result.ok) throw Error(result.error);
    state.data = { ...emptyData(), ...result.data };
    applyTheme(state.data.settings?.theme || "default");
    $("#boot-memory-stage").classList.add("is-ready");
    $("#boot-status").textContent = "Your workspace is ready.";
    $("#boot-workspace-stage").classList.add("is-ready");
    // Let the requested startup identity register without delaying slow starts.
    if (!reduceMotion) await sleep(Math.max(0, 850 - (performance.now() - startedAt)));
    screen.classList.add("is-leaving");
    screen.setAttribute("aria-busy", "false");
    await enterApp(); positionNavInk();
    setTimeout(() => { screen.hidden = true; }, reduceMotion ? 0 : 240);
  } catch (error) {
    booted = false;
    $("#boot-status").textContent = `Could not open this workspace: ${error.message}`;
    screen.setAttribute("aria-busy", "false");
    $("#boot-retry").hidden = false;
  }
}
$("#boot-retry").addEventListener("click", boot);

// The indicator follows actual tab geometry, including compact window sizes.
window.addEventListener("resize", positionNavInk);

window.addEventListener("DOMContentLoaded", boot);
if (document.readyState !== "loading") boot();


// Blender's UI lifecycle lives with its feature controller.
let optionalMcpController=null;
function renderBlenderTools() { blenderController?.render(); optionalMcpController?.render(); }
blenderController = FSRenderer.createBlender({ $, api, state, socket });
optionalMcpController=FSRenderer.createMcpPresets({$,api,state});
FSRenderer.createGuides({ $, onNavigate: setPage });

// Feature controllers share the application state through explicit dependencies.
const profileController = FSRenderer.createProfiles({
  $, state, api, emptyData, hydrateApp, renderAll, flash, socket, reduceMotion,
  onNavigate: setPage,
  clearPendingSaves: () => { clearTimeout(memoryTimer); clearTimeout(promptTimer); },
});
const vaultController = FSRenderer.createVault({ $, api, socket });
FSRenderer.createProviders({ $, providers: FSAIProviders, api });
FSRenderer.createOverview({ $, $$, socket, onNavigate: setPage });
const computerController = FSRenderer.createComputer({ $, api });
projectController=FSRenderer.createProjects({$,api,state,providers:FSAIProviders});


