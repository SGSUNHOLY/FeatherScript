# # SPDX-License-Identifier: GPL-3.0-or-later
# bridge.py
# ──────────────────────────────────────────────────────────────────────────
#  FeatherScript Bridge
#  Local WebSocket <-> Roblox Studio MCP server.
#  The browser extension talks to this over ws://127.0.0.1:<PORT>.
#
#  What this bridge exposes to Kimi (aggregated into one tools/list):
#    - Every MCP server declared in config.json (by default: roblox), each
#      spawned as a stdio child and routed by tool name.
#
#  Design goals (robustness first):
#   - Each MCP stdio process is read by ONE dedicated thread; responses are
#     matched by JSON-RPC id (no "read the next line and hope" races).
#   - stderr is drained so a child never blocks on a full pipe.
#   - A dead server is auto-restarted and the failing call retried once.
#   - Tool calls are locked PER SERVER, so a slow server never blocks another.
#   - Every call ALWAYS produces a reply: a result OR a structured error.
#     Nothing ever hangs the agentic loop silently.
# ──────────────────────────────────────────────────────────────────────────
import asyncio
import json
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
import computer_tools
import contextvars
active_command_key = contextvars.ContextVar("active_command_key", default=None)
from command_journal import Journal
command_journal = Journal()

class ToolIndeterminate(TimeoutError):
    pass

class ToolNotWritten(RuntimeError):
    pass

try:
    # Sibling script (same folder as bridge.py, which Python puts on sys.path
    # automatically) - reused here purely to detect a Studio version bump
    # (see _current_studio_exe below), not to launch anything.
    import launch_studio_mcp as _studio_scan
except Exception:
    _studio_scan = None

try:
    # Bridge-native tool pack (single-purpose Studio helpers the extension
    # lists next to the Studio MCP's own tools).
    import feather_tools as _feather_tools
except Exception as _feather_err:  # keep the bridge usable if it is missing
    _feather_tools = None
    print(f"[bridge] FeatherScript tool pack unavailable: {_feather_err}")

try:
    import websockets
except ImportError:
    # Name the interpreter that is missing the package: a machine can have
    # several Pythons, and a bare "pip install" then installs into the wrong one
    # (seen live 2026-11-01 - `python` was 3.10 without websockets while
    # `py -3` was 3.12 with it). The desktop app watches for this text and
    # installs the package itself.
    print("[bridge] Missing dependency: the 'websockets' package is not installed for this Python.")
    print(f"[bridge] Python:  {sys.executable}")
    print(f"[bridge] Fix it:  \"{sys.executable}\" -m pip install --user websockets")
    print("[bridge] The FeatherScript app retries automatically - reopen it after installing.")
    sys.exit(1)

# Windows consoles often default to a legacy codepage (cp1252): printing
# non-ASCII text then raises UnicodeEncodeError INSIDE the WS handler, which
# kills the connection. Force UTF-8 (best effort). We also keep all console
# output strictly ASCII (no arrows / dots) so nothing garbles on a console that
# stayed on a legacy codepage anyway.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def _enable_ansi_colors():
    """On Windows, turn on ANSI escape processing so color codes render instead
    of printing as literal gibberish like "<ESC>[92m". Returns True on success."""
    if sys.platform != "win32":
        return True
    try:
        import ctypes
        k = ctypes.windll.kernel32
        h = k.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        mode = ctypes.c_uint32()
        if not k.GetConsoleMode(h, ctypes.byref(mode)):
            return False
        # ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004
        return bool(k.SetConsoleMode(h, mode.value | 0x0004))
    except Exception:
        return False


HOST = "127.0.0.1"
# Keep in sync with featherscript-extension/manifest.json "version" - printed at
# startup so a user's terminal output alone tells us which build they're on.
BRIDGE_VERSION = "2.0.1"
PORT = int(os.environ.get("ZS_BRIDGE_PORT", "17613"))
HERE = os.path.dirname(os.path.abspath(__file__))
import obsidian_vault
import project_memory

CONFIG_PATH = os.path.join(HERE, "config.json")
with open(os.path.join(HERE, "featherscript-extension", "core", "theme-presets.json"), encoding="utf-8") as _themes_file:
    THEME_IDS = frozenset({"auto", "default", "dark", "midnight"} | {preset["id"] for preset in json.load(_themes_file)})

# The primary server. It is always present, added by the installer, and can
# never be edited/removed through the extension (it is what FeatherScript is FOR).
PRIMARY_SERVER_ID = "roblox"

if _enable_ansi_colors():
    C = {
        "reset": "\033[0m", "dim": "\033[2m", "gr": "\033[92m",
        "yl": "\033[93m", "rd": "\033[91m", "cy": "\033[96m",
        # Bold white-on-red: for a non-technical user, an "ACTION NEEDED" step
        # must look nothing like the routine cyan/yellow status noise around
        # it, or it gets scrolled past unread (seen live 2026-07-13 - the
        # toggle instruction and the boot banner's own yellow re-explanation
        # of the SAME step were visually indistinguishable). Bright-yellow-bg
        # with black text was tried first but reads as low-contrast/washed
        # out on several real terminal color schemes (also seen live) - white
        # on red is the universal high-contrast "act now" pairing.
        "act": "\033[1m\033[97m\033[41m",
    }
else:
    C = {k: "" for k in ("reset", "dim", "gr", "yl", "rd", "cy", "act")}

# Every run appends here (never truncated), so a whole test session - across
# multiple restarts - stays in one file the user can just send us. Each
# process start writes a banner (see main()) so restarts are easy to spot.
LOGS_DIR = os.path.join(HERE, "logs")
try:
    os.makedirs(LOGS_DIR, exist_ok=True)
except OSError:
    # A read-only install folder (Program Files, a locked sync folder, a ZIP
    # opened in place) used to abort the bridge at import time with a traceback
    # the user never sees. Fall back to the temp folder so the bridge still runs.
    LOGS_DIR = os.path.join(tempfile.gettempdir(), "FeatherScript-logs")
    try:
        os.makedirs(LOGS_DIR, exist_ok=True)
    except OSError:
        LOGS_DIR = ""
LOG_PATH = os.path.join(LOGS_DIR, "bridge_debug.log") if LOGS_DIR else ""
try:
    _log_file = open(LOG_PATH, "a", encoding="utf-8", errors="replace") if LOG_PATH else None
except Exception:
    _log_file = None


class _Spinner:
    """Terminal-only progress indicator for waits that can run several seconds
    (server launch/handshake, Studio attach grace period) so the console never
    just sits there looking dead - the #1 thing that makes a user assume the
    bridge hung and close the window. Purely cosmetic: writes over its own line
    with \\r, never touches bridge_debug.log, and is skipped entirely when
    stdout isn't a real console (redirected to a file, no ANSI)."""
    FRAMES = "|/-\\"
    # Only ONE spinner may animate at a time: server launches now run in
    # PARALLEL (see MCPManager.start_all), and several spinners fighting over
    # the same console line with \r produced interleaved garbage. Whoever
    # acquires this lock animates; the others silently skip (the log lines
    # around them still tell the story).
    _active = threading.Lock()

    def __init__(self, label):
        self.label = label
        self._stop = threading.Event()
        self._thread = None
        self._owns_lock = False

    def __enter__(self):
        if sys.stdout.isatty() and _Spinner._active.acquire(blocking=False):
            self._owns_lock = True
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1.0)
            # Wipe the spinner line so the next log() line doesn't get glued
            # onto trailing spinner characters.
            print("\r" + " " * (len(self.label) + 4) + "\r", end="", flush=True)
        if self._owns_lock:
            _Spinner._active.release()

    def _run(self):
        i = 0
        while not self._stop.is_set():
            frame = self.FRAMES[i % len(self.FRAMES)]
            print(f"\r{C['dim']}{self.label} {frame}{C['reset']}", end="", flush=True)
            i += 1
            self._stop.wait(0.15)


def _clear_spinner_line():
    """Wipe whatever a live _Spinner (running on its own thread, mid-frame) left
    on the current console line via bare \\r writes, so the next print() below
    doesn't get glued onto its trailing characters - seen live 2026-07-14: an
    action_banner() fired while '[roblox] starting... -' was still mid-line and
    the red box rendered smashed onto it instead of starting on a fresh line.
    \\033[K (clear to end of line) doesn't depend on knowing the spinner's label
    length the way Spinner.__exit__'s own wipe does."""
    if sys.stdout.isatty():
        print("\r\033[K", end="", flush=True)


def log(msg, color="dim", terminal=True):
    """terminal=False: written to bridge_debug.log only, not the console. Use
    for noisy/technical detail (raw stderr from child MCP servers, per-call
    traces) that would bury the handful of lines a non-technical user actually
    needs to read. Nothing is ever lost - it all still lands in the file."""
    if terminal:
        _clear_spinner_line()
        ts = time.strftime("%H:%M:%S")
        print(f"{C['dim']}{ts}{C['reset']} {C.get(color,'')}{msg}{C['reset']}", flush=True)
    if _log_file:
        try:
            _log_file.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
            _log_file.flush()
        except Exception:
            pass


def action_banner(lines):
    """Print a step the USER must physically go do, styled so it cannot be
    mistaken for routine status/warning noise (see the 'act' color above).
    Framed with blank lines so it visually stands alone in a scrolling
    terminal - a non-technical user should be able to glance at the window
    and immediately spot this without reading everything above it.

    Every line (header, content, footer) is padded to the SAME width so the
    yellow block renders as one clean rectangle - an earlier version padded
    each line to a fixed guess independently, which produced a ragged block
    with mismatched edges on a real console (seen live 2026-07-13)."""
    header = "ACTION NEEDED"
    width = max([len(header) + 8] + [len(ln) for ln in lines]) + 2
    top = f">>> {header} " + ">" * max(0, width - len(header) - 5)
    _clear_spinner_line()
    print()
    print(f"{C['act']}  {top.ljust(width)}{C['reset']}")
    for ln in lines:
        print(f"{C['act']}  {ln.ljust(width)}{C['reset']}")
    print(f"{C['act']}  {'>' * width}{C['reset']}")
    print()
    if _log_file:
        try:
            _log_file.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} ACTION NEEDED: "
                             f"{' | '.join(lines)}\n")
            _log_file.flush()
        except Exception:
            pass


# Roblox Studio exposes its built-in MCP server on this loopback port. StudioMCP
# (and our bridge, via it) reaches Studio through it.
STUDIO_MCP_PORT = 13469


def _port_owner(port):
    """(pid, name, path) of the process LISTENING on `port`, or None. Win32 only."""
    if sys.platform != "win32":
        return None
    # BOTH stacks: "-p TCP" alone is IPv4-only, and a squatter listening on
    # [::1]:<port> (IPv6 loopback) was then completely invisible to this probe
    # even while Get-NetTCPConnection showed it plainly (the likely reason the
    # boot-time squatter check stayed silent on a machine where ropilot
    # provably held the port - see the 2026-07-13 live report).
    out = ""
    for proto in ("TCP", "TCPv6"):
        try:
            out += subprocess.run(
                ["netstat", "-ano", "-p", proto],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=8,
            ).stdout
        except Exception:
            pass
    if not out:
        return None
    pid = None
    # v4 lines end the local address in ":<port>", v6 in "]:<port>" - matching
    # on the ":<port> " suffix (with the column gap) covers both shapes.
    needle = f":{port} "
    for line in out.splitlines():
        if "LISTENING" in line and needle in line:
            parts = line.split()
            if parts and parts[-1].isdigit():
                pid = parts[-1]
                break
    if not pid:
        return None
    name, path = "?", ""
    try:
        ps = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"$p=Get-Process -Id {pid} -ErrorAction SilentlyContinue; "
             f"if($p){{$p.Name; $p.Path}}"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=8,
        ).stdout.splitlines()
        ps = [l.strip() for l in ps if l.strip()]
        if ps:
            name = ps[0]
            path = ps[1] if len(ps) > 1 else ""
    except Exception:
        pass
    return (pid, name, path)


def _roblox_studio_app_running():
    """True/False whether a real Roblox Studio window process exists, or None
    if this can't be determined (non-Windows, or the check itself failed)."""
    if sys.platform != "win32":
        return None
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq RobloxStudioBeta.exe"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=8,
        ).stdout
    except Exception:
        return None
    return "RobloxStudioBeta.exe" in out


def _process_cmdline(pid):
    """Full command line of `pid`, or "" if it can't be read. Win32 only.

    Used to tell OUR OWN kind of process (a python running bridge.py) apart
    from an unrelated app that merely happens to listen on the same port -
    the process NAME is just "python"/"py"/"pythonw", far too generic to kill
    on. The command line is what proves it is a leftover bridge."""
    if sys.platform != "win32":
        return ""
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"(Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\" "
             f"-ErrorAction SilentlyContinue).CommandLine"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=8,
        ).stdout
    except Exception:
        return ""
    return (out or "").strip()


def _reclaim_bridge_port():
    """Free OUR OWN listen port (17613) from a leftover bridge before we bind.

    The common failure (reported live, WinError 10048 on bind): the user
    relaunches app.bat while an earlier bridge.py is still running - window
    closed with the X instead of Ctrl+C, a previous crash that left a detached
    python, or a double double-click. The old process still holds the port, so
    websockets.serve() dies on bind with a cryptic (localised) OSError and the
    whole bridge exits code 1.

    We reuse _port_owner (already generic over the port) and only ever kill a
    process we can PROVE is another bridge.py - never a same-name innocent
    (some unrelated python listening on 17613): the guard is the command line
    containing "bridge.py", plus an explicit self-exclusion by PID. Anything
    else (a non-python app, or a python whose cmdline we can't read) is left
    alone and surfaced to the user by the caller's friendly bind-error path.
    Returns True if a leftover bridge was killed."""
    owner = _port_owner(PORT)
    if not owner:
        return False
    pid, name, path = owner
    try:
        pid_i = int(pid)
    except (TypeError, ValueError):
        return False
    if pid_i == os.getpid():
        return False  # never kill ourselves (defensive; we haven't bound yet)
    # Must look like a python interpreter AND be running bridge.py. Killing on
    # the port alone would murder whatever legitimately owns 17613.
    if "python" not in (name or "").lower() and "py" != (name or "").lower():
        return False
    cmdline = _process_cmdline(pid_i)
    expected_script = os.path.normcase(os.path.abspath(__file__)).replace("\\", "/")
    normalized_cmdline = os.path.normcase(cmdline).replace("\\", "/")
    if expected_script not in normalized_cmdline:
        log(f"port {PORT} is held by pid {pid_i} ('{name}') but it does not look "
            f"like a FeatherScript bridge - leaving it alone.", "yl")
        return False
    log(f"port {PORT} is held by a leftover FeatherScript bridge (pid {pid_i}) from a "
        "previous session - killing it so this one can start.", "yl")
    try:
        subprocess.run(["taskkill", "/F", "/PID", str(pid_i)],
                       capture_output=True, text=True, timeout=8)
    except Exception as e:
        log(f"could not kill the leftover bridge (pid {pid_i}): {e}", "rd")
        return False
    log(f"killed the leftover bridge (pid {pid_i}); the port is free now.", "cy")
    return True


def check_studio_port():
    """Report a conflicting port owner; never terminate another application's process."""
    owner = _port_owner(STUDIO_MCP_PORT)
    if not owner:
        return False
    pid, name, path = owner
    if "roblox" in (path or "").lower() or "studiomcp" in (name or "").lower():
        return False
    log(f"Studio's MCP port {STUDIO_MCP_PORT} is in use by '{name}' (pid {pid}).", "yl")
    action_banner([
        "Another application is using Studio's MCP port.",
        "Close that application yourself if you no longer need it.",
        "Then toggle Studio's MCP server off/on and restart this bridge.",
        "FeatherScript has left the other application running.",
    ])
    return True


# Retry only explicit pre-execution Studio rejection. A generic "not connected"
# or a success message mentioning a connected instance is not replay evidence.
def _looks_like_transient_studio_drop(text):
    low = (text or '').lower()
    return any(marker in low for marker in (
        'unable to find an active studio instance',
        'no roblox studio instance is connected',
        'no active studio instance is connected',
        'no studio instance connected',
    ))


# Studio's own MCP tools live inside its built-in Assistant plugin package. When
# that plugin domain is (re)loading - which is what entering/leaving Play does,
# and what a still-booting Studio does - the dispatcher cannot resolve its own
# Tools module and answers with the raw require path instead of running the
# command:
#   sabuiltin_Assistant.rbxm.Assistant.Packages._Index.AssistantUI.AssistantUI.Tools
# Seen live 2026-11-03 (bridge log 14:03:46, 14:03:55, 14:04:17 - every one at
# 0.0s) with the same tools succeeding seconds before and after in the session.
# The path is meaningless to the model, so it re-issued different commands into
# the same wall and the user watched red chips. The dispatcher failed BEFORE the
# tool body ever started, so nothing was written and one short retry is safe.
_STUDIO_TOOL_MODULE_MARKERS = ('sabuiltin_assistant.rbxm', '.packages._index.assistantui')

STUDIO_TOOL_MODULE_ERROR = (
    "Studio's Assistant tool module was not loaded, so nothing ran. This is a "
    "Studio-side hiccup, normal while the place is in Play mode or just after "
    "entering/leaving Play. Stop Play, or wait a few seconds, then run the "
    "command again.")


def _looks_like_studio_tool_module(text):
    low = (text or '').lower()
    return any(marker in low for marker in _STUDIO_TOOL_MODULE_MARKERS)


# ── config.json read / write (for extension-driven add/remove) ──────────────
def _read_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            if isinstance(cfg, dict):
                cfg.setdefault("mcpServers", {})
                return cfg
        except Exception as e:
            log(f"config.json unreadable ({e}) - starting from a fresh one", "yl")
    return {"mcpServers": {PRIMARY_SERVER_ID: {"command": "launch_studio_mcp.py", "args": []}}}


def _write_config(cfg):
    """Atomic write so a crash mid-write never leaves a truncated config.json."""
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    os.replace(tmp, CONFIG_PATH)


def config_add_server(server_id, command, args=None, env=None):
    """Add/replace an addon server in config.json. Refuses to touch the primary
    (roblox) server. Returns (ok, error)."""
    sid = (server_id or "").strip()
    if not sid:
        return False, "server id is required"
    if sid == PRIMARY_SERVER_ID:
        return False, f"'{PRIMARY_SERVER_ID}' is the primary server and cannot be edited"
    if not (command or "").strip():
        return False, "a command is required"
    cfg = _read_config()
    spec = {"command": command.strip(), "args": list(args or [])}
    if env:
        spec["env"] = dict(env)
    cfg["mcpServers"][sid] = spec
    try:
        _write_config(cfg)
    except Exception as e:
        return False, f"could not write config.json: {e}"
    return True, None


def config_remove_server(server_id):
    """Remove an addon server from config.json. Refuses the primary server."""
    sid = (server_id or "").strip()
    if sid == PRIMARY_SERVER_ID:
        return False, f"'{PRIMARY_SERVER_ID}' is the primary server and cannot be removed"
    cfg = _read_config()
    if sid not in cfg.get("mcpServers", {}):
        return False, f"server '{sid}' is not in the config"
    del cfg["mcpServers"][sid]
    try:
        _write_config(cfg)
    except Exception as e:
        return False, f"could not write config.json: {e}"
    return True, None


def restart_self():
    """Replace this process with a fresh one so config.json is reloaded from
    scratch. Children are killed first to free their stdio pipes / ports before
    the new instance claims them. Never returns on success (os.execv)."""
    log("restarting bridge to load new server config...", "yl")
    try:
        for c in mgr.clients.values():
            c.stop()
    except Exception:
        pass
    if _log_file:
        try:
            _log_file.flush()
        except Exception:
            pass
    # sys.argv[0] may be relative ('bridge.py'); make it absolute so the restart
    # works regardless of the current working directory.
    argv = list(sys.argv)
    script = os.path.abspath(argv[0]) if argv else os.path.abspath(__file__)
    argv = [script] + argv[1:]
    try:
        os.execv(sys.executable, [sys.executable] + argv)
    except Exception as e:
        # execv failed (rare) - fall back to spawning a detached copy and exiting
        # so the user still ends up with a running, up-to-date bridge.
        log(f"in-place restart failed ({e}); spawning a fresh bridge...", "rd")
        try:
            subprocess.Popen([sys.executable] + argv, cwd=HERE)
        except Exception as e2:
            log(f"could not spawn a fresh bridge: {e2} - please restart it manually", "rd")
        os._exit(0)


# ══════════════════════════════════════════════════════════════════════════
#  HARDENED MCP CLIENT  (one per server in config.json)
# ══════════════════════════════════════════════════════════════════════════
class MCPClient:
    def __init__(self, server_id, command, args, env=None):
        self.id = server_id
        self.command = command
        self.args = list(args or [])
        self.env = env or {}
        self.proc = None
        self.req_id = 1
        self.write_lock = threading.Lock()
        self.call_lock = threading.Lock()   # serialize tool calls (single stdio pipe)
        self.pending = {}                    # id -> queue.Queue (one slot)
        self.active_commands = {}
        self.pend_lock = threading.Lock()
        self.tools_cache = []
        self.start_lock = threading.Lock()
        # Serializes restart() itself: server_watch and studio_watch can both
        # decide to restart the same client on the same tick, and without this
        # the second stop() lands right after the first start() and kills the
        # fresh process (an endless restart ping-pong under a flaky Studio).
        self.restart_lock = threading.Lock()
        self._reader_thread = None
        self._stderr_thread = None
        # Crash-loop forensics (read by server_watch). The auto-restart used to
        # hide a server that something else kills over and over: the terminal
        # showed an endless quiet restart cycle with no explanation at all. We
        # keep just enough state to NAME the problem in the terminal instead:
        #  - last_exit: exit code from the final _reader EOF (crash vs kill hint)
        #  - stderr_tail: the last few stderr lines (usually the actual reason -
        #    port bind failure, missing dependency, crash trace)
        #  - restart_times: recent auto-restart timestamps (loop detector input)
        #  - loop_warned_at: throttle so the big red banner prints once per
        #    cooldown, not every 5s poll
        self.last_exit = None
        self.stderr_tail = []
        self.restart_times = []
        self.loop_warned_at = 0.0
        # Set when the configured command itself couldn't be launched at all
        # (e.g. 'uvx' not installed / not on PATH). This is NOT a crash - the
        # process never existed, so last_exit/stderr_tail stay empty and the
        # generic crash-loop banner used to print "the server printed no error
        # output before dying", which is misleading for a config problem the
        # user can fix in seconds. Kept across restarts so the banner can name
        # the real cause instead.
        self.start_error = None
        # Set when StudioMCP's stderr shows it connected to a FOREIGN WS host on
        # Studio's MCP port (not Studio). The unmistakable signature is a parse
        # error on the host's messages ("missing field `type`") - Studio speaks
        # the expected protocol, a squatter like ropilot speaks its own. This is
        # a timing-independent proof that the port is hijacked, unlike the
        # one-shot check_studio_port() boot probe which can miss a squatter that
        # grabs the port a moment after boot (seen live 2026-07-13: ropilot took
        # the port ~1s after the boot check ran, so nothing was flagged).
        self.saw_foreign_ws_host = False

    # ── lifecycle ─────────────────────────────────────────────────────────
    def _resolve(self, s):
        return os.path.expandvars(os.path.expanduser(str(s)))

    def start(self):
        with self.start_lock:
            if self.is_alive():
                return
            cmd = [self._resolve(self.command)] + [self._resolve(a) for a in self.args]
            # A bare .py command (relative paths resolve against the bridge dir)
            # is run with the SAME interpreter the bridge itself uses, so it works
            # even on installs where only the `py` launcher exists (no `python`
            # on PATH). This is how the Studio MCP launcher is wired by default.
            if cmd[0].lower().endswith(".py"):
                script = cmd[0]
                if not os.path.isabs(script):
                    script = os.path.join(HERE, script)
                cmd = [sys.executable, script] + cmd[1:]
            # On Windows, npx/npm/yarn/pnpm/bunx are .cmd shims that Popen can't
            # launch directly (WinError 2). Run them through cmd.exe so any
            # node-based MCP server "just works" from config.json.
            if sys.platform == "win32":
                base = os.path.basename(cmd[0]).lower()
                if base in ("npx", "npm", "yarn", "pnpm", "bunx"):
                    cmd = ["cmd.exe", "/c"] + cmd
            env = dict(os.environ)
            for k, v in self.env.items():
                env[k] = self._resolve(v)
            log(f"[{self.id}] launching  ({' '.join(cmd)})", "cy")
            with _Spinner(f"    [{self.id}] starting..."):
                try:
                    self.proc = subprocess.Popen(
                        cmd,
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                        bufsize=1,
                        encoding="utf-8",
                        errors="replace",
                        cwd=HERE,
                        env=env,
                    )
                except FileNotFoundError:
                    # The OS couldn't find cmd[0] at all - this is a config
                    # problem (missing dependency, typo, not on PATH), not a
                    # transient crash. Auto-restart will keep retrying (the
                    # user may install it later), but name the real cause so
                    # it doesn't just look like an endless silent restart loop.
                    self.start_error = (
                        f"command not found: '{cmd[0]}' - is it installed and on PATH? "
                        f"(configured for server '{self.id}' in config.json)"
                    )
                    log(f"[{self.id}] {self.start_error}", "rd")
                    raise
                except OSError as e:
                    self.start_error = f"could not launch '{cmd[0]}': {e}"
                    log(f"[{self.id}] {self.start_error}", "rd")
                    raise
                else:
                    self.start_error = None
                with self.pend_lock:
                    self.pending.clear()
                self.saw_foreign_ws_host = False  # fresh process, fresh verdict
                self._reader_thread = threading.Thread(target=self._reader, args=(self.proc,), daemon=True)
                self._reader_thread.start()
                self._stderr_thread = threading.Thread(target=self._stderr_drain, args=(self.proc,), daemon=True)
                self._stderr_thread.start()

                # MCP handshake. A failed/timed-out initialize must kill the
                # process: leaving it alive would make the next start() return
                # early on is_alive() and keep a half-open, unusable client.
                init = self._request("initialize", {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "featherscript-bridge", "version": "1.0"},
                }, timeout=30)
                if not init or init.get("error"):
                    if self._stderr_thread:
                        self._stderr_thread.join(timeout=0.2)
                    reason = (init or {}).get("error") or ("; ".join(self.stderr_tail[-3:]) if not self.is_alive() and self.stderr_tail else "initialize timed out")
                    self.start_error = f"server '{self.id}' failed to initialize: {str(reason)[-1500:]}"
                    self.stop()
                    raise RuntimeError(f"server '{self.id}' failed to initialize: {reason}")
                self._notify("notifications/initialized")
                # Some MCP servers (notably Roblox's StudioMCP) advertise 0 tools at
                # the instant initialize returns, because they connect to their
                # backend (the running Studio) a moment AFTER the stdio handshake.
                # A single tools/list then caches an empty list forever. So if we
                # get nothing, retry for a few seconds to let the backend attach.
                # Short per-attempt timeout so the bridge never looks frozen if the
                # server stays silent (e.g. Studio not open yet); ~12s total budget.
                for _ in range(12):
                    if self.refresh_tools(timeout=3):
                        break
                    if not self.is_alive():
                        break
                    time.sleep(1.0)
            log(f"[{self.id}] MCP server up  ({len(self.tools_cache)} tools advertised)", "cy")

    def is_alive(self):
        return self.proc is not None and self.proc.poll() is None

    def restart(self):
        with self.restart_lock:
            log(f"[{self.id}] restarting...", "yl")
            self.stop()
            time.sleep(0.4)
            self.start()

    def stop(self):
        with self.pend_lock:
            for q in self.pending.values():
                try:
                    q.put_nowait(None)
                except Exception:
                    pass
            self.pending.clear()
        proc, self.proc = self.proc, None
        if proc is None:
            return
        # Closing the request pipe lets cooperative servers release their own
        # children and temporary scenes before bounded termination is needed.
        try:
            proc.stdin.close()
            proc.wait(timeout=2)
        except Exception:
            try:
                if sys.platform == "win32":
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                                   capture_output=True, timeout=8)
                else:
                    proc.terminate()
                proc.wait(timeout=3)
            except Exception:
                try:
                    proc.kill()
                    proc.wait(timeout=2)
                except Exception:
                    pass
        # Reap the process and release all three pipes instead of relying on
        # garbage collection after every bridge restart.
        for reader in (self._reader_thread, self._stderr_thread):
            if reader and reader is not threading.current_thread():
                reader.join(timeout=2)
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            try:
                stream.close()
            except Exception:
                pass

    # ── io threads ────────────────────────────────────────────────────────
    def _reader(self, proc):
        stream = proc.stdout
        while True:
            try:
                line = stream.readline()
            except Exception:
                break
            if line == "":  # EOF -> process exited
                break
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except Exception:
                continue  # stray non-JSON log on stdout
            mid = msg.get("id")
            if mid is None:
                continue  # server notification, nothing waits on it
            with self.pend_lock:
                q = self.pending.get(mid)
            if q is not None:
                try:
                    q.put_nowait(msg)
                except Exception:
                    pass
        code = proc.poll()
        # Identity guard: a restart() may already have replaced self.proc while
        # this reader was winding down. Reporting the OLD process's exit against
        # the new one (and failing the NEW process's pending requests) turned a
        # routine restart into a phantom "server died" + spurious timeouts.
        if self.proc is not proc:
            log(f"[{self.id}] previous stdout closed (exit code {code})", "dim", terminal=False)
            return
        self.last_exit = code  # kept for the crash-loop banner in server_watch
        log(f"[{self.id}] stdout closed (process ended, exit code {code})", "rd")
        with self.pend_lock:
            for q in self.pending.values():
                try:
                    q.put_nowait(None)
                except Exception:
                    pass

    def _stderr_drain(self, proc):
        # Surface the child's stderr instead of silently discarding it - this
        # is often the ONLY clue why a server died (crash trace, port bind
        # failure, missing Studio, etc).
        try:
            for line in iter(proc.stderr.readline, ""):
                line = line.rstrip()
                if line:
                    # Skip a superseded process's late output: it would paint
                    # the crash-loop banner with an unrelated reason.
                    if self.proc is proc:
                        # Ring buffer of the last stderr lines: when the server
                        # enters a crash loop, these are printed in the terminal
                        # banner - they are usually the only real explanation
                        # (port already in use, module not found, crash trace).
                        self.stderr_tail.append(line)
                        if len(self.stderr_tail) > 8:
                            self.stderr_tail.pop(0)
                        # Squatter signature: StudioMCP connected to a non-Studio host
                        # on the MCP port and can't parse its protocol. This is the
                        # ropilot hijack, timing-independent (see saw_foreign_ws_host).
                        low = line.lower()
                        if "failed to parse message from ws host" in low or "missing field `type`" in low:
                            self.saw_foreign_ws_host = True
                    log(f"[{self.id}] stderr: {line}", "yl", terminal=False)
        except Exception:
            pass

    # ── jsonrpc ───────────────────────────────────────────────────────────
    def _next_id(self):
        with self.write_lock:
            rid = self.req_id
            self.req_id += 1
            return rid

    def _notify(self, method, params=None):
        payload = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        with self.write_lock:
            if self.proc is None or self.proc.stdin is None:
                raise RuntimeError(f"server '{self.id}' is not running")
            self.proc.stdin.write(json.dumps(payload) + "\n")
            self.proc.stdin.flush()

    def _request(self, method, params, timeout):
        if not self.is_alive():
            raise RuntimeError(f"server '{self.id}' is not running")
        rid = self._next_id()
        command_key = active_command_key.get() if method == "tools/call" else None
        if command_key: self.active_commands[command_key] = rid
        q = queue.Queue(maxsize=1)
        with self.pend_lock:
            self.pending[rid] = q
        try:
            payload = {"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}}
            try:
                with self.write_lock:
                    # The child can die between is_alive() and this write; a
                    # broken pipe is a dead server, not a tool error - report it
                    # as "no response" so call_tool's restart-and-retry path runs
                    # instead of surfacing a raw BrokenPipeError to the user.
                    if self.proc is None or self.proc.stdin is None:
                        if method == 'tools/call': raise ToolNotWritten('The request was not written to the MCP process.')
                        return None
                    self.proc.stdin.write(json.dumps(payload) + "\n")
                    self.proc.stdin.flush()
            except (BrokenPipeError, OSError, ValueError, TypeError):
                if method == 'tools/call': raise ToolIndeterminate('The MCP pipe failed during a write. Execution may have occurred; inspect state before retrying.') from None
                return None
            try:
                response = q.get(timeout=timeout)
                if response is None and method == 'tools/call':
                    raise ToolIndeterminate('The MCP process exited after submission. Do not replay the operation blindly.')
                return response
            except queue.Empty:
                if method == 'tools/call': raise ToolIndeterminate('MCP execution was submitted but no result arrived. Inspect read-only state before another edit.') from None
                return None
        finally:
            with self.pend_lock:
                self.pending.pop(rid, None)
            if command_key: self.active_commands.pop(command_key, None)

    # ── high-level ────────────────────────────────────────────────────────
    def refresh_tools(self, timeout=20):
        msg = self._request("tools/list", {}, timeout=timeout)
        if msg and "result" in msg:
            self.tools_cache = msg["result"].get("tools", [])
        return self.tools_cache

    def call_tool(self, name, arguments, timeout):
        """Returns {"text":..., "images":[...]}. Raises on error/timeout."""
        with self.call_lock:
            key = active_command_key.get()
            if key and command_journal.status(key)['state'] == 'cancelled':
                raise RuntimeError('Command cancelled before MCP execution began.')
            for attempt in (1, 2):
                if not self.is_alive():
                    self.restart()
                try:
                    msg = self._request("tools/call", {"name": name, "arguments": arguments}, timeout)
                except ToolNotWritten:
                    if attempt == 1:
                        self.restart()
                        continue
                    raise
                if msg is None:
                    raise ToolIndeterminate(f"No final result from server '{self.id}'. Do not replay; inspect actual state first.")
                content = msg.get("result", {}).get("content", [])
                err_text = None
                if msg.get("error"):
                    err = msg["error"]
                    err_text = err.get("message", json.dumps(err))
                elif msg.get("result", {}).get("isError"):
                    err_text = "\n".join(it.get("text", "") for it in content if it.get("type") == "text") or "MCP tool failed"
                if err_text is not None:
                    module_fail = _looks_like_studio_tool_module(err_text)
                    if attempt == 1 and (module_fail or _looks_like_transient_studio_drop(err_text)):
                        log(f"[{self.id}] {name}: "
                            f"{'Studio tool module not loaded' if module_fail else 'transient Studio drop'}, retrying once...", "yl")
                        time.sleep(2 if module_fail else 1.5)
                        continue
                    raise RuntimeError(STUDIO_TOOL_MODULE_ERROR if module_fail else err_text)
                text = "\n".join(it.get("text", "") for it in content if it.get("type") == "text")
                images = [{"data": it["data"], "mimeType": it.get("mimeType", "image/jpeg")}
                          for it in content if it.get("type") == "image" and it.get("data")]
                if not text and not images and content:
                    text = json.dumps(content)[:4000]
                # Studio's own MCP proxy briefly loses its binding to the Studio
                # app every few seconds on some machines (seen live: repeated
                # "Bound studio ... disconnected for proxy ..." stderr, self-
                # healing within ~1-4s). A tool call landing in that window
                # fails with a "no Studio instance connected" style message
                # even though Studio is genuinely open - confirmed live via
                # start_stop_play. One short retry rides through it instead of
                # surfacing a spurious error to the user.
                if attempt == 1 and _looks_like_transient_studio_drop(text):
                    log(f"[{self.id}] {name}: transient Studio drop, retrying once...", "yl")
                    time.sleep(1.5)
                    continue
                return {"text": text, "images": images}


# ══════════════════════════════════════════════════════════════════════════
#  MANAGER  - aggregates every MCP server, routes by tool name.
# ══════════════════════════════════════════════════════════════════════════

# What a user has to DO for the common addons to come back. A dead server used to
# print "startup failed" everywhere with no reason and no step, which left the
# model apologising and the user guessing.
SERVER_HINTS = {
    # blender_headless.py spawns Blender itself, so telling the user to open the
    # desktop app and its addon sends them looking for a window this build never
    # uses. A missing/incompatible Blender is reported by preflight() instead.
    "blender": "restart the bridge to launch its headless Blender worker again",
    "computer": "start the FeatherScript desktop app and switch Computer access on",
    "obsidian": "choose your vault folder in the FeatherScript app",
}


def _blender_preflight(override=""):
    """True/False for the Blender executable the headless server would spawn.
    Import failure means we cannot tell, and unknown is never reported as broken."""
    try:
        import blender_headless
        return blender_headless.preflight(override)
    except Exception:
        return True, None


def _server_state(sid, alive, ready, start_error, studio=None):
    """(state, fix) in the one vocabulary the bar, the app and list_mcp_servers
    all render, so a server can only claim 'working' when its pipe is proven:
      working  - answering and its commands can run
      waiting  - answering, but the thing it drives is not there (no Studio, no
                 place); StudioMCP advertises its whole catalogue in this state
      starting - process up, catalogue not in yet
      failed   - it refused or crashed, with the reason
      offline  - not running at all
    `studio` is probe_studio()'s result; None means the caller has no probe, and
    then the primary server is reported only as far as its own pipe proves."""
    if start_error:
        return "failed", start_error
    if not alive:
        hint = SERVER_HINTS.get(sid)
        return "offline", (f"its process is not running - {hint}." if hint
                           else "its process is not running - restart the bridge to launch it again.")
    if sid == PRIMARY_SERVER_ID and studio is not None:
        if studio.get("app") is not True:
            return "waiting", ("no Roblox Studio is attached - open your place, then "
                               "Studio > Assistant Settings > MCP Servers > 'Enable Studio as MCP server'.")
        if studio.get("place") is False:
            return "waiting", "Roblox Studio is attached but no place is open - open a place."
    if not ready:
        return "starting", "it has not advertised any commands yet - try again in a few seconds."
    return "working", None


class MCPManager:
    def __init__(self):
        self.clients = {}          # server_id -> MCPClient
        self.index = {}            # advertised_name -> (holder, real_name)
        self.index_lock = threading.Lock()
        # One refresh at a time. The extension re-asks every ~30s; a refresh can
        # block for ~12s inside a dead server's start(). Letting a second one
        # queue behind it just made both callers time out, while the cache the
        # second one receives would be identical anyway.
        self.refresh_lock = threading.Lock()

    def load_config(self):
        servers = _read_config().get("mcpServers", {}) or {}
        for sid, spec in servers.items():
            self.clients[sid] = MCPClient(
                sid, spec.get("command"), spec.get("args"), spec.get("env"))
        log(f"configured {len(self.clients)} MCP server(s): {', '.join(self.clients) or '(none)'}", "cy")

    def start_all(self):
        # Launch every configured server IN PARALLEL, not one after another.
        # client.start() can block for up to ~12s (its own "wait for Studio's
        # tools to appear" grace loop) - with a sequential for-loop, Roblox
        # being first in config.json meant every OTHER server (Blender, any
        # addon) didn't even begin launching until Roblox's grace loop gave
        # up, even though that addon has nothing to do with Roblox and could
        # have been ready in 1-2s. A thread per client removes that
        # dependency entirely: a slow/absent Roblox Studio no longer holds up
        # an addon server the user actually wants right now.
        threads = []
        for sid, client in self.clients.items():
            def _run(sid=sid, client=client):
                try:
                    client.start()
                except Exception as e:
                    log(f"[{sid}] failed to start: {e}  (other servers continue)", "rd")
            t = threading.Thread(target=_run, daemon=True)
            t.start()
            threads.append(t)
        for t in threads:
            t.join()
        self.rebuild_index()

    def rebuild_index(self):
        """Aggregate server tools. Collisions get a 'server/' prefix."""
        with self.index_lock:
            self.index = {}
            for sid, client in self.clients.items():
                for t in (client.tools_cache or []):
                    name = t.get("name")
                    if not name:
                        continue
                    advertised = name if name not in self.index else f"{sid}/{name}"
                    self.index[advertised] = (client, name)

    def list_tools(self, refresh=False):
        if refresh and self.refresh_lock.acquire(blocking=False):
            try:
                for sid, client in list(self.clients.items()):
                    try:
                        if not client.is_alive():
                            client.start()
                        else:
                            client.refresh_tools()
                    except Exception as e:
                        log(f"[{sid}] refresh failed: {e}", "yl")
                self.rebuild_index()
            finally:
                self.refresh_lock.release()
        out = []
        with self.index_lock:
            advertised_names = {(id(holder), real): key for key, (holder, real) in self.index.items()}
        for sid, client in self.clients.items():
            for t in (client.tools_cache or []):
                name = t.get("name")
                if name in computer_tools.NAMES:
                    continue
                advertised = advertised_names.get((id(client), name), name)
                tt = dict(t)
                tt["name"] = advertised
                tt["server"] = sid
                out.append(tt)
        # The FeatherScript pack rides on Studio: these tools only mean anything
        # while the primary Roblox server is up and has a catalogue (the Studio
        # MCP advertises zero tools until a Studio attaches, and the extension
        # treats an empty catalogue as "Studio offline" - so mirror that here
        # instead of dangling tools that can never run). The few tools that are
        # pure local file access (feather_getskills) stay listed regardless.
        rbx = self.clients.get(PRIMARY_SERVER_ID)
        if _feather_tools is not None and rbx is not None:
            pack_live = rbx.is_alive() and bool(rbx.tools_cache)
            seen = {t.get("name") for t in out}
            for native in _feather_tools.tool_defs():
                if native["name"] in seen:
                    continue
                if not pack_live and not _feather_tools.always_available(native["name"]):
                    continue
                item = dict(native)
                item["server"] = PRIMARY_SERVER_ID
                out.append(item)
        seen = {tool["name"] for tool in out}
        out.extend(tool for tool in obsidian_vault.tool_defs() if tool["name"] not in seen)
        out.extend(tool for tool in computer_tools.tool_defs() if tool["name"] not in seen)
        return out

    def call(self, name, arguments, timeout):
        if name in computer_tools.NAMES:
            return computer_tools.call(name, arguments, timeout)
        with self.index_lock:
            entry = self.index.get(name)
        if entry is None and name in {tool["name"] for tool in obsidian_vault.tool_defs()}:
            return obsidian_vault.call(name, arguments)
        # Bridge-native tools are not in the index (they are not an MCP server
        # child). A real server tool with the same name always wins, because
        # list_tools() skips native duplicates.
        if entry is None and _feather_tools is not None and _feather_tools.is_native(name):
            return _feather_tools.call(name, arguments, self.call, timeout)
        if entry is None:
            # Maybe a freshly added tool - rebuild once and retry.
            self.rebuild_index()
            with self.index_lock:
                entry = self.index.get(name)
        if entry is None:
            raise RuntimeError(f"unknown tool '{name}'")
        holder, real_name = entry
        return holder.call_tool(real_name, arguments, timeout)

    def restart(self, server_id=None):
        targets = [self.clients[server_id]] if server_id and server_id in self.clients else list(self.clients.values())
        for client in targets:
            try:
                client.restart()
            except Exception as e:
                log(f"[{client.id}] restart failed: {e}", "rd")
        self.rebuild_index()

    def health(self, studio=None):
        """One verdict per server, in the same words the extension bar, the app
        and the model all show. `alive` alone lies: the StudioMCP proxy answers
        with its whole catalogue while no Studio is attached, and a server that
        crashed at launch is simply not running. Every non-working row carries the
        reason and the step that fixes it, so no surface has to invent one.

        `studio` is probe_studio()'s result; without it the primary server is
        reported only as far as its own pipe proves."""
        out = []
        for sid, c in self.clients.items():
            n = len(c.tools_cache)
            # Mirror list_tools(): the full FeatherScript pack counts for the
            # primary server only while it is usable; local-only tools count
            # even when Studio is closed.
            if sid == PRIMARY_SERVER_ID and _feather_tools is not None:
                if c.is_alive() and c.tools_cache:
                    n += len(_feather_tools.tool_defs())
                else:
                    n += sum(1 for t in _feather_tools.tool_defs()
                             if _feather_tools.always_available(t["name"]))
            ready = c.is_alive() and bool(c.tools_cache)
            state, fix = _server_state(sid, c.is_alive(), ready, c.start_error, studio)
            if sid == "blender" and state == "working":
                # A headless Blender answers tools/list from a static table, so its
                # pipe proves the server is up but nothing about Blender itself.
                found, why = _blender_preflight(c.env.get("BLENDER_EXECUTABLE", ""))
                if not found:
                    state, fix = "waiting", why
            out.append({"id": sid, "alive": c.is_alive(), "ready": ready, "tools": n,
                        "error": c.start_error, "state": state, "fix": fix})
        pc = computer_tools.status()
        # Always listed, working or not: omitting the row at zero tools made
        # "no PC commands" indistinguishable from "this build has no PC commands",
        # and the model answered with a guess instead of the real reason.
        out.append({"id": "computer", "alive": pc["state"] == "working",
                    "ready": pc["state"] == "working", "tools": pc["tools"],
                    "error": pc["lastError"], "state": pc["state"], "fix": pc["fix"]})
        vault = obsidian_vault.settings()["path"]
        if vault:
            ok = os.path.isdir(vault)
            out.append({"id": "obsidian", "alive": ok, "ready": ok,
                        "tools": len(obsidian_vault.tool_defs()) if ok else 0,
                        "error": None if ok else f"vault folder not found: {vault}",
                        "state": "working" if ok else "failed",
                        "fix": None if ok else "Choose the real vault folder in the FeatherScript app."})
        return out

    def any_alive(self):
        return bool(computer_tools.tool_defs()) or any(c.is_alive() for c in self.clients.values()) or bool(obsidian_vault.settings()["path"] and os.path.isdir(obsidian_vault.settings()["path"]))


# ══════════════════════════════════════════════════════════════════════════
#  WEBSOCKET SERVER
# ══════════════════════════════════════════════════════════════════════════
mgr = MCPManager()
clients = set()
active_theme = _read_config().get("theme", "auto")
try:
    obsidian_vault.configure(_read_config().get("obsidian", {}))
except (ValueError, OSError) as error:
    log(f"Obsidian vault unavailable: {error}", "yl")


def skills_meta():
    """Installed skill headers for the extension's system prompt (no bodies)."""
    try:
        return _feather_tools.skills_catalog() if _feather_tools else []
    except Exception:
        return []

# ── Studio connectivity probe ──────────────────────────────────────────────
# The MCP server process stays alive even when Roblox Studio is closed or its
# MCP option is disabled - tool calls then return instantly with an "Unable to
# find an active Studio instance" text. So "mcp_alive" alone is misleading.
#
# TWO LEVELS (validated live 2026-06):
#  - list_roblox_studios: instant, side-effect-free. studios == [] means NO Studio
#    is connected to the MCP (app closed, OR its "Studio as MCP Server" option is
#    disabled - the two are indistinguishable at this layer). A non-empty list
#    means a Studio app IS connected, BUT note its entry stays present (active:true)
#    even when no place is open - only its "name" goes null. So presence != usable.
#  - get_studio_state: tells whether a PLACE is actually loaded. With a place open
#    it returns "Available DataModels: ..."; with the Studio on the home screen (or
#    the active place closed) it returns "...doesn't have a place opened / previously
#    active Studio has disconnected". That is the authoritative "place loaded" signal
#    (same phrase the call path already recognises in core/main.js).
STUDIO_PROBE_TOOL = "list_roblox_studios"
STUDIO_STATE_TOOL = "get_studio_state"
# Substrings get_studio_state emits when a Studio is connected but no place is open.
NO_PLACE_MARKERS = ("doesn't have a place", "no place opened", "place opened",
                    "has disconnected", "no active studio")


def _probe_tool_text(tool):
    """Call a side-effect-free probe tool with no args; return its text, or None if
    the tool is unavailable / the server is busy / it errored (best-effort)."""
    with mgr.index_lock:
        entry = mgr.index.get(tool)
    if entry is None:
        return None
    holder, real_name = entry
    # Never queue behind a long-running tool call (the probe is best-effort).
    if not holder.call_lock.acquire(blocking=False):
        return None
    try:
        if not holder.is_alive():
            return None
        msg = holder._request("tools/call", {"name": real_name, "arguments": {}}, timeout=8)
        if not msg or msg.get("error"):
            return None
        content = msg.get("result", {}).get("content", [])
        return "\n".join(it.get("text", "") for it in content if it.get("type") == "text")
    except Exception:
        return None
    finally:
        holder.call_lock.release()


def probe_studio():
    """Two-level Studio connectivity. Returns {"app": x, "place": y} where each is
    True / False / None (None = unknown: probe tool missing or server busy).
      app   - a Roblox Studio instance is connected to the MCP server. False = Studio
              closed OR its MCP-server option disabled (indistinguishable here).
      place - a place/datamodel is actually loaded and usable. False = Studio open on
              the home screen, or the active place was closed. Only meaningful when
              app is True (when app is False/None, place mirrors it)."""
    roblox = mgr.clients.get(PRIMARY_SERVER_ID)
    if roblox is not None and roblox.is_alive() and not roblox.tools_cache:
        # StudioMCP advertises ZERO tools - including list_roblox_studios itself -
        # until Studio actually attaches. That makes _probe_tool_text() below
        # return None (tool missing) the same way it would for a genuinely
        # transient "probe busy" blip, even though "Studio is simply closed" is
        # the common, SUSTAINED case here, not a blip. Left unhandled, the
        # extension's "unknown = don't degrade" rule (by design, for real
        # transient blips) then leaves the status dot stuck GREEN forever with
        # Studio fully closed (seen live 2026-07-11: dot stayed "on", tooltip
        # showing only an addon server's tool count). An alive client with an
        # empty catalogue is an unambiguous "not connected", so short-circuit
        # straight to that verdict instead of falling through to "unknown".
        return {"app": False, "place": False}
    text = _probe_tool_text(STUDIO_PROBE_TOOL)
    if text is None:
        return {"app": None, "place": None}
    try:
        studios = json.loads(text).get("studios") or []
    except Exception:
        return {"app": None, "place": None}
    if not studios:
        return {"app": False, "place": False}
    # A Studio app is connected - now check whether a place is actually open.
    state = _probe_tool_text(STUDIO_STATE_TOOL)
    if state is None:
        return {"app": True, "place": None}
    low = state.lower()
    place = not any(m in low for m in NO_PLACE_MARKERS)
    return {"app": True, "place": place}


# Status snapshots are built on every heartbeat from several threads (probe,
# tasklist, catalogue). A single unexpected exception in any of them must not
# escape into the socket read loop and kill the whole connection - a missed
# status is a grey dot for a few seconds, a dead connection loses tool results.
def _status_payload():
    try:
        st = probe_studio()
    except Exception:
        st = {"app": None, "place": None}
    return {
        "type": "connected", "bridge_id": command_journal.identity, "theme": active_theme,
        "mcp_alive": mgr.any_alive(),
        "studio": st["place"], "studio_app": st["app"],
        "studio_proc": _roblox_studio_app_running(),
        "servers": _safe_health(st),
        "tools": _safe_tools(),
        "skills": skills_meta(),
        "port": PORT,
    }


def _safe_health(studio=None):
    try:
        return mgr.health(studio)
    except Exception:
        return []


def _safe_tools(refresh=False):
    try:
        return mgr.list_tools(refresh)
    except Exception:
        try:
            return mgr.list_tools()
        except Exception:
            return []


def safe_call(name, arguments, timeout):
    """Never raises. Always returns a dict the extension can feed back to DeepSeek."""
    try:
        result = mgr.call(name, arguments, timeout)
        # Native FeatherScript tools only return "text" (and "meta"/"images"
        # when relevant), while MCP tools always carry both keys.
        out = {"ok": True, "stage":"result", "may_have_executed":True, "retryable":False, "text": result.get("text", ""), "images": result.get("images") or []}
        if result.get("meta"):
            out["meta"] = result["meta"]
        return out
    except ToolIndeterminate as e:
        return {"ok": False, "error": str(e), "kind": "indeterminate", "stage": "mcp_result", "may_have_executed": True, "retryable": False}
    except ToolNotWritten as e:
        return {"ok": False, "error": str(e), "kind": "unacknowledged", "stage": "mcp_write", "may_have_executed": False, "retryable": True}
    except TimeoutError as e:
        return {"ok": False, "error": str(e), "kind": "timed_out", "stage": "execution", "may_have_executed": True, "retryable": False}
    except Exception as e:
        return {"ok": False, "error": str(e), "kind": type(e).__name__, "stage":"execution", "may_have_executed":True, "retryable":False}


async def run_tool_task(ws, name, args, timeout, rid, command_id=None, journal_key=None):
    """Execute one tool off the socket read loop and send its result back.

    Kept as a standalone task (not awaited inline in handler) so a long tool
    never starves the connection's ability to answer app-level pings - see the
    call_tool branch in handler() for the full rationale."""
    t0 = time.monotonic()
    try:
        async def operation():
            if command_id:
                try:
                    await ws.send(json.dumps({"type":"command_state","id":rid,"command_id":command_id,"state":"running"}))
                except Exception:
                    pass
            token=active_command_key.set(journal_key)
            try: return await asyncio.to_thread(safe_call, name, args, timeout)
            finally: active_command_key.reset(token)
        res = await command_journal.execute(journal_key, operation) if command_id else await operation()
    except Exception as e:  # thread pool shut down / unexpected escape
        res = {"ok": False, "error": str(e), "kind": type(e).__name__}
    elapsed = time.monotonic() - t0
    tag = "gr" if res.get("ok") else "rd"
    summary = (res.get("text") or res.get("error") or "")[:80].replace("\n", " ")
    slow = "  [SLOW]" if elapsed > 5 else ""
    # Routine per-call traces are technical noise for a non-dev user watching
    # the console; they still land in bridge_debug.log. A failed/slow call
    # DOES surface on the terminal - that's the signal a user should notice.
    log(f"<- {name} ({elapsed:.1f}s){slow}: {summary}", tag, terminal=not res.get("ok") or elapsed > 5)
    try:
        await ws.send(json.dumps({"type": "tool_result", "id": rid, "command_id":command_id, **res}))
    except Exception:
        # The tab may have navigated/closed while the tool ran; the result is
        # simply dropped. Any other exception here must not escape as an
        # unretrieved task error at shutdown.
        pass


async def broadcast_status():
    """Push a fresh status snapshot to every currently-connected extension tab.

    Needed because the socket now starts listening (see _boot_and_diagnose in
    main()) before every MCP server has necessarily finished launching in the
    background - an extension that connects in that window gets an early,
    incomplete "connected" snapshot (e.g. an addon server not started yet).
    The extension's own periodic poll only reads a passively cached copy of
    the LAST message it received (background.js never re-probes on its own),
    so without a follow-up push that stale snapshot can persist forever (seen
    live 2026-07-11: Blender not yet alive at connect-time froze the "Start
    Roblox agent" button in its fully-disabled, non-degraded state even long
    after Blender was actually up). background.js already handles a second
    "connected" message arriving at any time (updates its cache and re-renders
    the bar), so re-sending this exact shape once startup truly settles is
    enough to self-correct with zero extension-side changes needed.
    """
    if not clients:
        return
    try:
        # Build the whole snapshot off-loop: probe_studio can wait seconds for
        # an unresponsive server, and blocking the event loop would stall every
        # other connection's pings and tool results.
        payload = json.dumps(await asyncio.to_thread(_status_payload))
    except Exception:
        return
    for ws in list(clients):
        try:
            await ws.send(payload)
        except Exception:
            pass


async def handler(ws):
    headers = getattr(getattr(ws,'request',None),'headers',None)
    if headers is None: headers = getattr(ws,'request_headers',{})
    try: origin = headers.get('Origin','')
    except Exception: origin = ''
    computer_tools.CLIENT_ORIGIN.set(origin)
    global active_theme
    peer = getattr(ws, "remote_address", ("?",))[0]
    clients.add(ws)
    log(f"extension connected  ({peer})  [{len(clients)} client(s)]", "gr")
    try:
        await ws.send(json.dumps(await asyncio.to_thread(_status_payload)))
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            mtype = msg.get("type")
            rid = msg.get("id")

            if mtype == "project_memory":
                try:
                    if not re.fullmatch(r'(?:chrome-extension://[a-p]{32}|moz-extension://[0-9a-fA-F-]{36})', origin):
                        raise RuntimeError('Project memory is available only to the FeatherScript extension.')
                    request = dict(msg.get('request') or {})
                    request.pop('detected', None)
                    if request.get('detect') and request.get('profile') != 'agent':
                        detected = await asyncio.to_thread(project_memory.detect_place, mgr.call)
                        if detected:
                            request['detected'] = detected
                    result = await asyncio.to_thread(project_memory.request, request)
                    await ws.send(json.dumps({**result, 'type': 'project_memory', 'id': rid}))
                except Exception as error:
                    await ws.send(json.dumps({'type': 'project_memory', 'id': rid, 'ok': False, 'error': str(error)}))

            elif mtype == "get_vault":
                await ws.send(json.dumps({"type": "vault_settings", "id": rid, "ok": True, "settings": obsidian_vault.settings()}))

            elif mtype == "configure_vault":
                previous = obsidian_vault.settings()
                try:
                    settings = obsidian_vault.configure(msg.get("settings") or {})
                    cfg = _read_config()
                    cfg["obsidian"] = settings
                    _write_config(cfg)
                except Exception as error:
                    try:
                        obsidian_vault.configure(previous)
                    except (ValueError, OSError):
                        obsidian_vault.configure({})
                    await ws.send(json.dumps({"type": "vault_settings", "id": rid, "ok": False, "error": str(error)}))
                    continue
                await ws.send(json.dumps({"type": "vault_settings", "id": rid, "ok": True, "settings": settings}))
                asyncio.create_task(broadcast_status())

            elif mtype == "set_theme":
                theme = msg.get("theme")
                if theme not in THEME_IDS:
                    await ws.send(json.dumps({"type": "theme", "id": rid, "ok": False, "error": "Unknown theme"}))
                    continue
                if theme != active_theme:
                    try:
                        cfg = _read_config()
                        cfg["theme"] = theme
                        _write_config(cfg)
                    except Exception as e:
                        # A read-only install must not kill the connection; the
                        # theme still applies for this session.
                        log(f"could not persist theme: {e}", "yl")
                    active_theme = theme
                    payload = json.dumps({"type": "theme", "theme": theme})
                    await asyncio.gather(*(client.send(payload) for client in list(clients)), return_exceptions=True)

                await ws.send(json.dumps({"type": "theme_updated", "id": rid, "ok": True, "theme": active_theme}))

            elif mtype == "ping":
                await ws.send(json.dumps({"type": "pong", "id": rid}))

            elif mtype == "studio_status":
                try:
                    studio = await asyncio.to_thread(probe_studio)
                except Exception:
                    studio = {"app": None, "place": None}
                await ws.send(json.dumps({
                    "type": "studio_status", "id": rid,
                    "studio": studio["place"], "studio_app": studio["app"],
                    "studio_proc": await asyncio.to_thread(_roblox_studio_app_running),
                    "mcp_alive": mgr.any_alive(),
                }))

            elif mtype == "list_tools":
                # Fast path: answer from the catalogue the bridge already holds
                # and refresh behind the response. A wedged or dead MCP server
                # (tools/list can block for seconds, especially with Studio
                # closed) used to sit directly on Start's critical path. Only a
                # genuinely empty catalogue waits, because there is nothing to
                # answer with - the background refresh fills the cache for the
                # extension's next poll either way.
                tools = await asyncio.to_thread(_safe_tools, False)
                if tools:
                    asyncio.create_task(asyncio.to_thread(_safe_tools, True))
                else:
                    tools = await asyncio.to_thread(_safe_tools, True)
                try:
                    _st = await asyncio.to_thread(probe_studio)
                except Exception:
                    _st = {"app": None, "place": None}
                await ws.send(json.dumps({
                    "type": "tools", "id": rid,
                    "tools": tools, "mcp_alive": mgr.any_alive(),
                    "studio": _st["place"], "studio_app": _st["app"],
                    "studio_proc": await asyncio.to_thread(_roblox_studio_app_running),
                    "servers": _safe_health(),
                    "skills": skills_meta(),
                }))

            elif mtype in ('command_status', 'cancel_command'):
                command_id = str(msg.get('command_id') or '')
                if not command_id or len(command_id)>100 or not all(ch.isalnum() or ch in '-_' for ch in command_id):
                    await ws.send(json.dumps({'type':'command_status','id':rid,'state':'rejected','error':'Invalid command ID.'}))
                    continue
                journal_key = origin + '|' + command_id
                status = command_journal.cancel(journal_key) if mtype == 'cancel_command' else command_journal.status(journal_key)
                if mtype == 'cancel_command':
                    entry = command_journal.entries.get(journal_key, {})
                    target = mgr.index.get(entry.get('name'))
                    if target:
                        client = target[0] if isinstance(target, tuple) else None
                        if isinstance(client, str): client = mgr.clients.get(client)
                        if client:
                            request_id = client.active_commands.get(journal_key)
                            if request_id is not None:
                                try: client._notify('notifications/cancelled', {'requestId':request_id,'reason':'User stopped the task'})
                                except Exception: pass
                await ws.send(json.dumps({'type':'command_status','id':rid,'command_id':command_id,'bridge_id':command_journal.identity,**status}))

            elif mtype == "call_tool":
                name = msg.get("name", "")
                args = msg.get("arguments") or {}
                # A malformed timeout (null/string) used to raise TypeError right
                # here and tear down the whole socket read loop - every other
                # request on that connection then went unanswered.
                try:
                    timeout = float(msg.get("timeout", 120000)) / 1000.0
                except (TypeError, ValueError):
                    timeout = 120.0
                timeout = max(1.0, min(timeout, 900.0))
                if not isinstance(args, dict):
                    args = {}
                log(f"-> tool  {name}({', '.join(args.keys())})", "cy", terminal=False)
                # Run the tool as a BACKGROUND task instead of awaiting it here.
                # Awaiting inline parks this read loop for the WHOLE tool call, so
                # a long tool (e.g. wait_job_finished > 25s) means the client's
                # app-level pings are never read/answered - its half-open-socket
                # watchdog then force-closes the connection and the in-flight call
                # is dropped as "bridge unreachable" (reported live). As a task,
                # the loop stays free to answer pings/status while the tool runs.
                # The extension only ever has ONE call_tool in flight (its agent
                # loop awaits each result before sending the next), so this never
                # overlaps tool executions.
                command_id = msg.get('command_id')
                journal_key = None
                if command_id:
                    if not isinstance(command_id,str) or len(command_id)>100 or not all(ch.isalnum() or ch in '-_' for ch in command_id):
                        await ws.send(json.dumps({'type':'tool_result','id':rid,'command_id':command_id,'ok':False,'kind':'rejected','error':'Invalid command ID.','may_have_executed':False}))
                        continue
                    if msg.get('bridge_id') and msg['bridge_id'] != command_journal.identity:
                        await ws.send(json.dumps({'type':'tool_result','id':rid,'command_id':command_id,'ok':False,'kind':'indeterminate','error':'The bridge restarted. Inspect state; do not replay this command.','may_have_executed':True}))
                        continue
                    journal_key = origin + '|' + command_id
                    try:
                        command_journal.reserve(journal_key, name, args)
                    except ValueError as error:
                        await ws.send(json.dumps({'type':'tool_result','id':rid,'command_id':command_id,'ok':False,'kind':'rejected','error':str(error),'may_have_executed':True}))
                        continue
                    await ws.send(json.dumps({'type':'call_ack','id':rid,'command_id':command_id,'bridge_id':command_journal.identity,'state':'acknowledged'}))
                asyncio.create_task(run_tool_task(ws, name, args, timeout, rid, command_id, journal_key))

            elif mtype in ("add_server", "remove_server"):
                # Adding/removing an addon MCP server rewrites config.json, which
                # the bridge only reads at launch - so we ack, then restart the
                # whole process to pick it up cleanly. The primary Roblox server
                # is protected inside config_add/remove_server.
                if mtype == "add_server":
                    ok, err = await asyncio.to_thread(
                        config_add_server,
                        msg.get("server_id"), msg.get("command"),
                        msg.get("args"), msg.get("env"))
                else:
                    ok, err = await asyncio.to_thread(
                        config_remove_server, msg.get("server_id"))
                await ws.send(json.dumps({
                    "type": "server_changed", "id": rid,
                    "ok": ok, "error": err, "restarting": ok,
                }))
                if ok:
                    # Give the ack a beat to flush over the socket, then restart.
                    async def _do_restart():
                        await asyncio.sleep(0.4)
                        restart_self()
                    asyncio.create_task(_do_restart())

            elif mtype == "restart_mcp":
                sid = msg.get("server")
                try:
                    await asyncio.to_thread(mgr.restart, sid)
                    ok, err = True, None
                except Exception as e:
                    ok, err = False, str(e)
                await ws.send(json.dumps({
                    "type": "mcp_status", "id": rid,
                    "alive": mgr.any_alive(), "ok": ok, "error": err,
                    "servers": _safe_health(), "tools": _safe_tools(),
                    "skills": skills_meta(),
                }))

            else:
                await ws.send(json.dumps({
                    "type": "error", "id": rid,
                    "error": f"unknown message type: {mtype}",
                }))
    except websockets.ConnectionClosed:
        pass
    except Exception as e:
        log(f"handler error: {e}", "rd")
    finally:
        clients.discard(ws)
        log(f"extension disconnected  [{len(clients)} client(s)]", "yl")


async def server_watch():
    """Poll every MCP server and restart any that died unexpectedly (e.g. the
    StudioMCP proxy crashing on its own - see stop()'s taskkill /T fix and the
    stderr logging above for why this used to happen silently). Without this,
    a dead server only got noticed on the NEXT real tool call, which is what
    made "Studio looks connected but nothing responds" possible."""
    # Crash-LOOP detection thresholds: LOOP_N deaths within LOOP_WINDOW seconds
    # means something is killing (or instantly crashing) the server every time
    # we bring it back - the silent restart cycle the auto-restart otherwise
    # hides completely. We still keep restarting (the cause may be transient,
    # e.g. the user is about to start Blender), but the terminal now NAMES the
    # problem: exit code, the child's last stderr lines, and - for a port-bound
    # server - who is squatting the port. Banner re-prints at most every
    # LOOP_WARN_COOLDOWN so the terminal stays readable.
    LOOP_N = 3
    LOOP_WINDOW = 60
    LOOP_WARN_COOLDOWN = 120
    while True:
        await asyncio.sleep(5)
        for sid, client in list(mgr.clients.items()):
            try:
                if not client.is_alive():
                    now = time.time()
                    # restart_times holds RESTART ATTEMPTS (appended just before
                    # each start below), never per-poll sightings - appending on
                    # every 5s poll would keep the window full forever and the
                    # "slow down" branch would then block restarts permanently.
                    client.restart_times = [t for t in client.restart_times if now - t < LOOP_WINDOW]
                    looping = len(client.restart_times) >= LOOP_N
                    if looping and now - client.loop_warned_at > LOOP_WARN_COOLDOWN:
                        client.loop_warned_at = now
                        log(f"[{sid}] CRASH LOOP: died {len(client.restart_times)} times in the last "
                            f"{LOOP_WINDOW}s (last exit code: {client.last_exit}). Something is killing it "
                            f"or it cannot start.", "rd")
                        if client.start_error:
                            log(f"[{sid}] {client.start_error}", "rd")
                        elif client.stderr_tail:
                            log(f"[{sid}] last error output (usually the real reason):", "rd")
                            for ln in client.stderr_tail:
                                log(f"[{sid}]   {ln}", "yl")
                        else:
                            log(f"[{sid}] the server printed no error output before dying.", "yl")
                        # Port forensics: name the process squatting a port this
                        # server needs. For the primary Roblox proxy that is
                        # Studio's MCP port; a squatter there (seen live: a
                        # 'ropilot' app) makes the proxy die/misbehave forever.
                        if sid == "roblox":
                            owner = _port_owner(STUDIO_MCP_PORT)
                            if owner:
                                pid, name, path = owner
                                if "roblox" not in (name or "").lower() and "studio" not in (path or "").lower():
                                    log(f"[{sid}] port {STUDIO_MCP_PORT} is held by '{name}' (pid {pid}, {path}) - "
                                        f"close that program, it is squatting Studio's MCP port.", "rd")
                        log(f"[{sid}] common causes: its app is not running (e.g. Blender + addon), a port "
                            f"conflict, an antivirus killing it, or a bad command in config.json. "
                            f"Auto-restart continues in the background.", "yl")
                    if looping and client.restart_times and now - client.restart_times[-1] < 15:
                        # Clearly hopeless right now: drop to a ~15s cadence so a
                        # broken command isn't hammer-spawned every 5 seconds,
                        # while still retrying forever (the cause may clear, e.g.
                        # the user finally opens Blender).
                        continue
                    client.restart_times.append(now)
                    log(f"[{sid}] found dead - auto-restarting...", "yl")
                    await asyncio.to_thread(client.start)
                    mgr.rebuild_index()
                    await broadcast_status()  # tell any connected extension right away
            except Exception as e:
                log(f"[{sid}] auto-restart failed: {e}", "rd")


def _current_studio_exe():
    """The StudioMCP.exe our launcher would currently pick (newest version
    folder paired with a real RobloxStudioBeta.exe), or None. Reused here only
    to detect a Studio update happening mid-session: Roblox's own bug report
    ("Studio MCP turning off after update") says the toggle resets to OFF
    whenever Studio auto-updates - restarting our proxy can't fix that (Studio
    itself refuses the connection while its toggle is off), so the terminal
    should say "re-enable the toggle" instead of "wait for auto-recovery"
    when a version bump coincides with the disconnect."""
    if _studio_scan is None:
        return None
    try:
        return _studio_scan.find_studio_mcp()
    except Exception:
        return None


async def studio_watch(initial_app, initial_place=None):
    """Poll Studio attachment and log transitions, so the terminal confirms in
    GREEN the moment Studio attaches (e.g. after the user toggles its MCP server)
    and warns again if it later drops. Best-effort; never raises.

    Also auto-recovers from a real disconnect: two bugs reported on the Roblox
    devforum leave StudioMCP.exe alive (our client stays "alive" - the process
    never dies, so server_watch's dead-process restart never fires) but stuck
    talking to nothing - (1) StudioMCP keeps a stale named-pipe handle keyed by
    Studio's old PID after Studio is closed and reopened, and never rediscovers
    the new one; (2) MCP silently disconnects every 5-15 minutes on some
    machines. The documented user workaround for both is "toggle Studio's MCP
    server off/on" / "reopen the MCP panel" - which just forces StudioMCP to
    redo its handshake. Restarting OUR proxy process is the equivalent from
    this side (taskkill + fresh launch_studio_mcp.py), so do it automatically
    once a drop looks real (sustained, not a momentary blip) instead of leaving
    the user to notice and toggle it themselves."""
    prev_app = initial_app
    prev_place = initial_place
    disconnected_since = None
    last_auto_restart = 0.0
    empty_since = None       # when the roblox catalogue was first seen empty
    last_reclaim = 0.0       # cooldown for the zombie-StudioMCP port reclaim
    place_transitions = []
    known_studio_exe = await asyncio.to_thread(_current_studio_exe)
    update_suspected = False
    # Only auto-restart a disconnect that follows a real connection (matches
    # the two known bugs above) - never spam-restart while Studio simply isn't
    # open yet at all (prev_app starting False/None is the common cold-start
    # case and restarting there would just be noise every cooldown).
    ever_connected = initial_app is True
    while True:
        await asyncio.sleep(4)
        # If StudioMCP launched while Studio was closed, its catalogue is EMPTY
        # and stays that way: start()'s 12s retry loop has long given up, and
        # nothing else ever re-asks for tools/list (probe_studio can't - the
        # probe tools themselves are part of the missing catalogue, which is
        # why it short-circuits to "not connected" on an empty cache). So a
        # Studio opened AFTER that window was never detected until the user
        # restarted the whole bridge (seen live 2026-07-11). Re-ask here on
        # every poll while the catalogue is empty; the moment Studio attaches,
        # tools appear, the index rebuilds, and the normal probe below flips
        # the state to connected on this same iteration.
        rc0 = mgr.clients.get("roblox")
        if rc0 is not None and rc0.is_alive() and not rc0.tools_cache:
            got = False
            try:
                got = bool(await asyncio.to_thread(rc0.refresh_tools, 3))
            except Exception:
                got = False
            if got:
                mgr.rebuild_index()
                log(f"Roblox Studio's tools appeared ({len(rc0.tools_cache)}) - Studio attached.", "gr")
                empty_since = None
            else:
                now0 = time.time()
                if empty_since is None:
                    empty_since = now0
                # A foreign port owner is a diagnostic, never permission to
                # terminate another application's process. Rate-limit notices.
                if now0 - last_reclaim > 180 and (rc0.saw_foreign_ws_host or now0 - empty_since > 20):
                    last_reclaim = now0
                    await asyncio.to_thread(check_studio_port)

        else:
            empty_since = None
        try:
            st = await asyncio.to_thread(probe_studio)
        except Exception:
            continue
        app, place = st["app"], st["place"]
        if app is not None and app != prev_app:
            if app is True:
                # Roblox-only count, not mgr.list_tools() (sums every server,
                # e.g. + Blender) - this message is specifically about Roblox
                # attaching, so it must not borrow addon tool counts (same
                # class of bug as the startup banner, see roblox_total above).
                rc = mgr.clients.get("roblox")
                roblox_now = len(rc.tools_cache) if rc else 0
                log(f"Roblox Studio connected - {roblox_now} tools ready.", "gr")
                ever_connected = True
                disconnected_since = None
                update_suspected = False
            else:
                cur_exe = await asyncio.to_thread(_current_studio_exe)
                if cur_exe and known_studio_exe and cur_exe != known_studio_exe:
                    # A newer Studio version folder appeared since we last saw
                    # one - restarting the proxy will NOT fix this (Studio
                    # itself refuses the MCP connection while its own toggle
                    # is off), so tell the user the actual fix instead of
                    # letting the generic auto-recovery below spin uselessly.
                    ver = os.path.basename(os.path.dirname(cur_exe))
                    log(f"Roblox Studio appears to have UPDATED (new version: {ver}). "
                        "Studio often turns its MCP toggle back OFF after an update - open "
                        "Roblox Studio > Assistant Settings > MCP Servers and re-enable "
                        "'Enable Studio as MCP server'.", "yl")
                    update_suspected = True
                else:
                    log("Roblox Studio disconnected - re-enable its MCP server (toggle off/on).", "yl")
                    update_suspected = False
                known_studio_exe = cur_exe or known_studio_exe
                if ever_connected and disconnected_since is None:
                    disconnected_since = time.time()
            prev_app = app
            # studio_watch only used to LOG transitions - an extension sitting
            # on the pre-start standby screen (no tool calls happening, so
            # nothing else round-trips to the bridge) never saw Studio connect
            # or disconnect mid-session until it happened to poll for an
            # unrelated reason. Push it immediately instead of leaving that
            # extension staring at a stale snapshot indefinitely.
            await broadcast_status()
        # Set once per iteration: BOTH the app-drop branch and the place-churn
        # block below use it. It used to be assigned only inside the app-drop
        # branch, so any iteration that skipped that branch crashed the whole
        # watcher with UnboundLocalError on the churn line (seen live: the task
        # died right after a successful reconnect, silently ending ALL Studio
        # monitoring and status broadcasts until the bridge was restarted).
        now = time.time()
        if app is False and ever_connected and disconnected_since is not None and not update_suspected:
            # ~20s sustained (5 polls) before treating it as a real drop, not a
            # momentary blip; 90s cooldown between recovery attempts so a
            # Studio that is genuinely closed for a while doesn't get hammered.
            # Skipped entirely when a version bump was the likely cause (see
            # above) - restarting our proxy cannot flip Studio's own toggle
            # back on, so retrying would just be noise every 90s.
            if now - disconnected_since > 20 and now - last_auto_restart > 90:
                last_auto_restart = now
                # Which recovery applies depends on whether a Studio WINDOW is
                # actually running (validated live 2026-07-11, both directions):
                #  - Studio RUNNING but not attached: Studio's MCP plugin only
                #    registers ONCE, at Studio boot or on a toggle flip. It
                #    never retries by itself, and restarting OUR proxy cannot
                #    reach into Studio to re-register it - worse, a restart
                #    that lands while Studio is booting kills the listener at
                #    the exact moment the plugin makes its single attempt,
                #    which is precisely how this state got created. So: do NOT
                #    touch the proxy; tell the user the one action that works.
                #  - No Studio running: a restart is safe (nothing to collide
                #    with) and clears genuinely stuck/stale proxy state.
                if await asyncio.to_thread(_roblox_studio_app_running) is True:
                    log("Roblox Studio is RUNNING but its MCP plugin has not registered with the "
                        "bridge yet.", "yl")
                    log("If Studio is still STARTING UP, give it a minute (its plugin registers "
                        "late in boot).", "yl")
                    log("If Studio is fully loaded and this stays yellow: in Roblox Studio, simply "
                        "OPEN Assistant Settings > MCP Servers - opening that panel makes the "
                        "plugin re-register (validated twice live). If that's not enough, toggle "
                        "'Enable Studio as MCP server' OFF then ON there.", "yl")
                else:
                    log("Roblox Studio proxy looks stuck (known StudioMCP disconnect bug) - "
                        "restarting it to recover.", "yl")
                    try:
                        await asyncio.to_thread(mgr.restart, "roblox")
                        await broadcast_status()
                    except Exception as e:
                        log(f"auto-restart of roblox proxy failed: {e}", "rd")
        # PLACE-level churn: `app` can stay stuck reporting True the whole time
        # (seen live 2026-07-11 - Studio fully closed, list_roblox_studios kept
        # answering with a leftover studio entry for 4+ minutes, so the app-drop
        # trigger above never fires) while `place` flip-flops "loaded"/"closed"
        # every ~10-20s forever. That is not a user opening/closing places that
        # fast - it is the same class of stuck-proxy bug, just visible at the
        # place layer instead of the app layer. A fresh StudioMCP.exe process
        # cannot carry over stale cached state, so the same restart applies.
        place_transitions[:] = [t for t in place_transitions if now - t < 90]
        if len(place_transitions) >= 4 and now - last_auto_restart > 90:
            # Same running-Studio guard as the app-drop recovery above: with a
            # real Studio window up, a proxy restart can only collide with the
            # plugin's one-shot registration; the churn is Studio-side state.
            if await asyncio.to_thread(_roblox_studio_app_running) is not True:
                last_auto_restart = now
                log(f"Roblox Studio's place status flipped {len(place_transitions)} times in the last "
                    "90s (known StudioMCP stuck-proxy bug) - restarting the proxy to recover.", "yl")
                try:
                    await asyncio.to_thread(mgr.restart, "roblox")
                    await broadcast_status()
                except Exception as e:
                    log(f"auto-restart of roblox proxy failed: {e}", "rd")
                place_transitions.clear()
        if place is not None and place != prev_place:
            # Debounce: StudioMCP's binding to Studio blips every few seconds
            # on some machines (self-healing in ~1-4s - seen live as "Bound
            # studio ... disconnected" stderr). A probe landing in that window
            # can misread EITHER direction - most confusingly, reporting
            # "place loaded" from a stale cached response while the place is
            # actually still closed (seen live). Recheck once before trusting
            # a transition, in either direction.
            await asyncio.sleep(1.2)
            try:
                confirm = (await asyncio.to_thread(probe_studio))["place"]
            except Exception:
                confirm = None
            if confirm is None or confirm != place:
                continue  # didn't hold up on recheck - treat as noise, not a real change
            if place is True:
                log("Place loaded in Studio.", "gr")
            else:
                log("Place closed (Studio app still connected).", "yl")
            prev_place = place
            place_transitions.append(time.time())
            await broadcast_status()


async def _supervised(name, coro_factory):
    """Run a watcher coroutine forever, restarting it if it ever raises.

    Both watchers are designed to never raise, but one line proved that wrong
    in practice (an UnboundLocalError killed studio_watch SILENTLY - asyncio
    only prints 'Task exception was never retrieved' at shutdown, so all
    Studio monitoring and status broadcasts just stopped until the user
    restarted the bridge). A crash in a watcher must never be silent or
    permanent: log it loudly, wait a beat, start a fresh instance.
    """
    while True:
        try:
            await coro_factory()
            return  # normal completion (doesn't happen today, but respect it)
        except Exception as e:
            log(f"{name} crashed: {type(e).__name__}: {e} - restarting it in 5s "
                f"(please report this).", "rd")
            await asyncio.sleep(5)


async def main():
    print(f"\n{C['cy']}  FeatherScript Bridge v{BRIDGE_VERSION}{C['reset']}  {C['dim']}- Roblox Studio - ws://{HOST}:{PORT}{C['reset']}\n")
    log(f"===== BRIDGE START  v{BRIDGE_VERSION}  pid={os.getpid()}  log={LOG_PATH or 'unavailable (install folder is read-only)'} =====", "cy")
    studio_port_conflict = await asyncio.to_thread(check_studio_port)
    mgr.load_config()

    # Shared "we already told the user the corrective step" flag. Two producers
    # can print the 'toggle Studio's MCP server' action banner: the early
    # _early_studio_guidance task (fast, doesn't wait for start_all's ~48s grace
    # loop) and the post-start_all diagnostic block in _boot_and_diagnose. This
    # flag lets whichever fires first suppress the other, so the user never sees
    # the same instruction twice. Mutable dict so both nested coroutines share it.
    _guidance_shown = {"v": False}

    async def _early_studio_guidance():
        """Print the corrective action banner WITHOUT waiting for start_all()'s
        full ~48s grace loop.

        RobloxClient.start() retries tools/list for up to ~48s to catch a Studio
        that attaches a little late - correct for a Studio that IS coming, but it
        also means a user whose Studio is simply closed or whose MCP toggle is off
        waits ~48s before the terminal tells them what to do (the extension, which
        reads status over the socket, already says it immediately). So after a
        short grace we check independently and, if still not connected, show the
        step now. If Studio then attaches, studio_watch prints the green
        'connected' line - so an early banner is at worst redundant, never wrong
        (the user confirmed a premature toggle hint during boot is harmless).

        Deliberately does NOT try to distinguish 'Studio closed' from 'MCP toggle
        off': probe_studio can't tell them apart (both read app=False, see its
        docstring), and the banner wording already covers both, so there is no
        finer detection to preserve here. A proven port-squatter case is left to
        _boot_and_diagnose / studio_watch, which print their own, more specific
        hint."""
        if PRIMARY_SERVER_ID not in mgr.clients:
            return
        await asyncio.sleep(12)  # give a fast, normal attach the chance to win
        if _guidance_shown["v"]:
            return
        rc = mgr.clients.get(PRIMARY_SERVER_ID)
        if rc is None or getattr(rc, "saw_foreign_ws_host", False):
            return
        if rc.tools_cache:
            # Tools present - either connected, or an attach is mid-flight; defer
            # to the authoritative probe / studio_watch rather than second-guess.
            st = await asyncio.to_thread(probe_studio)
            if st["app"] is not False:
                return
        _guidance_shown["v"] = True
        action_banner([
            "Open your place in Roblox Studio.",
            "Go to: Assistant Settings > MCP Servers",
            "       > 'Enable Studio as MCP server'",
            "It can take up to ~10s; this window will turn green.",
        ])

    async def _boot_and_diagnose():
        """Launch every configured MCP server and print the boot diagnostic
        banner. Runs as a background task AFTER the socket below is already
        listening, so a slow or absent Roblox Studio never delays the
        extension's ability to connect and use OTHER MCP servers (e.g.
        Blender) right away - only the terminal banner and Roblox's own
        auto-recovery loop wait on this. (mgr.start_all() itself also
        launches every server in parallel now, for the same reason.)"""
        try:
            await asyncio.to_thread(mgr.start_all)
        except Exception as e:
            log(f"server startup error: {e}", "rd")
            log("The bridge will keep running; it retries on the first tool call.", "yl")
        total = len(mgr.list_tools())
        # Roblox-only count for the corrective message below: list_tools() sums
        # every configured server (Roblox + addons like Blender), so printing
        # `total` there falsely blamed addon tools on "NO Roblox Studio connected"
        # (seen live: 49 = 27 Roblox + 22 Blender, message only about Roblox).
        roblox_client = mgr.clients.get("roblox")
        roblox_total = len(roblox_client.tools_cache) if roblox_client else 0

        if (roblox_client is not None and roblox_total == 0
                and roblox_client.saw_foreign_ws_host):
            await asyncio.to_thread(check_studio_port)

        # A tool count alone only proves StudioMCP (the proxy) is up - it advertises
        # its catalogue even with NO Studio attached. The authoritative "a Studio is
        # actually connected" signal is the list_roblox_studios probe. So we probe
        # FIRST and only show the green "ready" line when Studio is really attached;
        # otherwise we show just the corrective step (no misleading green success).
        # Probe even when total == 0: StudioMCP advertises an EMPTY catalogue when
        # Studio's MCP server toggle is off (or no place is open), so 0 tools is the
        # most common "needs a corrective step" state, not a success.
        _st = await asyncio.to_thread(probe_studio)
        # Even when Studio (and its place) were ALREADY open before the bridge
        # started, the freshly-launched StudioMCP proxy needs a moment to (re)bind
        # to Studio's own MCP port - so an instant probe right after launch often
        # reads app=False for a beat before flipping True a few seconds later
        # (studio_watch would catch it, but only after printing a scary yellow
        # "not connected" block first). Give it the same grace period the tools
        # probe already gets before deciding it is a real problem.
        if _st["app"] is False:
            with _Spinner("    waiting for Roblox Studio to attach..."):
                for _ in range(8):
                    await asyncio.sleep(1)
                    _st = await asyncio.to_thread(probe_studio)
                    if _st["app"] is not False:
                        break
        # A single app=True reading can be a STALE positive: StudioMCP.exe can
        # answer list_roblox_studios with a leftover studio entry from a PREVIOUS
        # session even though no Studio window is actually open right now (seen
        # live 2026-07-11: bridge booted with Studio fully closed, still printed
        # "Roblox Studio connected" from the very first probe). studio_watch
        # already distrusts a single reading for PLACE transitions the same way -
        # apply the identical confirm-before-trusting step here for APP, so the
        # boot banner can't announce a connection that isn't really there.
        if _st["app"] is True:
            await asyncio.sleep(1.5)
            confirm = await asyncio.to_thread(probe_studio)
            if confirm["app"] is not True:
                _st = confirm
        if roblox_client is not None and (roblox_total == 0 or _st["app"] is False):
            if studio_port_conflict or _guidance_shown["v"]:
                # The action banner was ALREADY shown - either right after a kill
                # (check_studio_port) or by
                # the early _early_studio_guidance task. Repeating the full
                # explanation here in a different color, seconds later, reads as a
                # second unrelated problem to a non-technical user (seen live
                # 2026-07-13: the toggle instruction and this block blurred
                # together). Just confirm we're still waiting, no new instructions.
                log("    still waiting for you to toggle Studio's MCP server "
                    "(see the action box above)...", "yl")
            else:
                _guidance_shown["v"] = True
                # No squatter: Studio is simply closed, or its MCP option is off.
                # Match the exact steps the extension itself tells the user
                # (Assistant Settings > MCP Servers), not a paraphrase - a
                # differently-worded instruction here reads as a second,
                # unrelated problem instead of the same one step.
                if roblox_total > 0:
                    log(f"    {roblox_total} Roblox tools loaded, but NO Roblox Studio is connected yet.", "yl")
                    log("    (This can be a slow attach that clears itself within ~10-15s -", "yl")
                    log("    watch for a green 'Roblox Studio connected' line right after.)", "yl")
                action_banner([
                    "Open your place in Roblox Studio.",
                    "Go to: Assistant Settings > MCP Servers",
                    "       > 'Enable Studio as MCP server'",
                    "It can take up to ~10s; this window will turn green.",
                ])
        elif _st["app"] is True:
            log(f"ready {total} tools available - Roblox Studio connected", "gr")
        else:
            log(f"ready {total} tools available ({len(mgr.clients)} MCP server(s))", "gr")
        asyncio.create_task(_supervised(
            "studio_watch", lambda: studio_watch(_st["app"], _st["place"])))

    async def _early_status_pushes():
        """A few follow-up status broadcasts shortly after boot.

        mgr.start_all() still doesn't RETURN until every server's thread has
        joined - including Roblox's, which can take up to ~48s (StudioMCP's
        own internal "waiting for tools" retry loop, seen live). So a single
        broadcast placed after start_all() would be just as slow as the old
        blocking behavior for the exact case this is meant to fix: an addon
        server (e.g. Blender) that's ready in 1-13s while Roblox is still
        slowly timing out. Poll-and-broadcast a few times instead, cheaply,
        so any extension that connected during that window self-corrects
        quickly instead of staying stuck on its first, incomplete snapshot.
        """
        for interval in (2, 2, 4, 6, 6):  # cumulative: 2s, 4s, 8s, 14s, 20s after boot
            await asyncio.sleep(interval)
            await broadcast_status()

    # Free our own port from a leftover bridge (double-launch / X-closed window /
    # prior crash) BEFORE binding, so relaunching app.bat "just works" instead
    # of dying on WinError 10048. Only ever kills a proven bridge.py; anything
    # else falls through to the friendly bind-error below.
    if await asyncio.to_thread(_reclaim_bridge_port):
        await asyncio.sleep(0.6)  # let Windows release the socket before we bind

    try:
        server_ctx = await websockets.serve(
            handler, HOST, PORT, ping_interval=20, ping_timeout=20,
            max_size=16 * 1024 * 1024)
    except OSError as e:
        # errno 10048 (Win) / EADDRINUSE: something we could NOT auto-kill still
        # owns the port - another app, or a python whose cmdline we couldn't read.
        if getattr(e, "errno", None) in (98, 10048) or "10048" in str(e):
            owner = await asyncio.to_thread(_port_owner, PORT)
            who = f" by '{owner[1]}' (pid {owner[0]})" if owner else ""
            log(f"could not start: port {PORT} is already in use{who}.", "rd")
            log(f"    A previous bridge may still be running, or another app took "
                f"the port. Close it, then relaunch. To find it:", "yl")
            log(f"      netstat -ano | findstr {PORT}", "yl")
            log(f"      taskkill /F /PID <the pid from the last column>", "yl")
            log(f"    Or set a different port before app.bat:  set ZS_BRIDGE_PORT=17614", "yl")
            return
        raise

    async with server_ctx:
        log(f"listening on ws://{HOST}:{PORT}  - load the extension and open a supported AI chat", "cy")
        asyncio.create_task(_supervised("server_watch", server_watch))
        asyncio.create_task(_boot_and_diagnose())
        asyncio.create_task(_early_studio_guidance())
        asyncio.create_task(_early_status_pushes())
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("shutting down...", "yl")
        for c in mgr.clients.values():
            c.stop()
    finally:
        log("===== BRIDGE STOP =====", "cy")
