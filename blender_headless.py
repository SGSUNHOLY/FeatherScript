# SPDX-License-Identifier: GPL-3.0-or-later
"""Dependency-free STDIO MCP server controlling one lazy, persistent Blender."""
from __future__ import annotations

import atexit
import base64
import json
import os
from pathlib import Path
import queue
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

PREFIX = "FEATHERSCRIPT_RESULT:"
VECTOR = {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}
SURFACE = {"color": {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"},
           "metallic": {"type": "number", "minimum": 0, "maximum": 1},
           "roughness": {"type": "number", "minimum": 0, "maximum": 1}}


def tool(name, description, properties=None, required=None):
    return {"name": name, "description": description, "inputSchema": {
        "type": "object", "properties": properties or {}, "required": required or [], "additionalProperties": False}}


TOOLS = [
    tool("get_scene_info", "Inspect the persistent headless Blender scene and its objects."),
    tool("generate_3d", "Create a procedural Blender primitive with optional PBR color/material settings.", {
        "primitive": {"type": "string", "enum": ["cube", "sphere", "cylinder", "cone", "torus", "plane"]},
        "name": {"type": "string"}, "location": VECTOR, "scale": VECTOR, **SURFACE}, ["primitive"]),
    tool("create_model", "Build an editable, grouped low-poly table, chair, building or crate using reusable geometry and optional PBR materials. Dimensions are width, depth, height; location is the base position.", {
        "model": {"type": "string", "enum": ["table", "chair", "building", "crate"]},
        "name": {"type": "string"}, "location": VECTOR, "dimensions": VECTOR, **SURFACE}, ["model"]),
    tool("export_glb", "Export scene meshes to a new binary glTF (.glb) for Roblox Studio's 3D Importer. By default includes only FeatherScript-generated meshes. Existing files are never overwritten.", {
        "path": {"type": "string"}, "generated_only": {"type": "boolean"}}, ["path"]),
    tool("look", "Render a PNG preview using CPU Cycles. Adds a camera if the scene has none.", {
        "resolution": {"type": "integer", "minimum": 64, "maximum": 1024}}),
    tool("animate_object", "Add bounded transform keyframes to an existing object. Rotation is XYZ radians. Does not clear other animation tracks.", {
        "name": {"type": "string"}, "frame": {"type": "integer", "minimum": 1, "maximum": 10000},
        "location": VECTOR, "rotation": VECTOR, "scale": VECTOR}, ["name", "frame"]),
    tool("save_scene", "Save the current scene to an absolute .blend path. Existing files are not overwritten.", {
        "path": {"type": "string"}}, ["path"]),
    tool("execute_blender_code", "Execute Python with bpy in the persistent scene. Disabled in safe mode; outside safe mode this has full local Python access.", {
        "code": {"type": "string", "maxLength": 100000}}, ["code"]),
]


def find_blender(override=""):
    if override:
        candidate = Path(override).expanduser()
        if candidate.is_file():
            return str(candidate.resolve())
        raise FileNotFoundError("The configured Blender executable does not exist.")
    on_path = shutil.which("blender")
    if on_path:
        return on_path
    candidates = [Path("/Applications/Blender.app/Contents/MacOS/Blender")]
    for variable in ("ProgramFiles", "ProgramFiles(x86)"):
        base = os.environ.get(variable)
        if base:
            candidates.extend((Path(base) / "Blender Foundation").glob("Blender*/blender.exe"))
    installed = [p for p in candidates if p.is_file()]
    if installed:
        # Folder version is stable; timestamps change when installers repair files.
        def version_key(candidate):
            numbers = re.findall(r"\d+", candidate.parent.name)
            return tuple(int(value) for value in numbers) or (0,)
        return str(max(installed, key=version_key))
    raise FileNotFoundError("Blender was not found. Install Blender or set its executable in MCPs.")


# (checked_at, override, (found, reason)) - see preflight().
_preflight = (0.0, None, None)


def preflight(override=""):
    """(found, reason) for the Blender this server would launch, WITHOUT launching
    it. tools/list is answered from a static table, so on a machine with no Blender
    installed the bridge still reports a fully working Blender server and the first
    real command is where the user finds out. The filesystem search is cached for
    20s because health() re-asks every couple of seconds."""
    global _preflight
    now = time.monotonic()
    if now - _preflight[0] < 20 and _preflight[1] == override and _preflight[2]:
        return _preflight[2]
    try:
        find_blender(override)
        verdict = (True, None)
    except FileNotFoundError as error:
        verdict = (False, str(error))
    _preflight = (now, override, verdict)
    return verdict


class BlenderSession:
    def __init__(self, executable="", safe_mode=True, timeout=90):
        self.executable, self.safe_mode, self.timeout = executable, safe_mode, timeout
        self.proc = None
        self.temp = None
        self.responses = queue.Queue()
        self.reader = None
        self.failed = False
        self.failure_reason = "The Blender session is closed. Restart the bridge for a new scene."
        self.version = ""
        self.resolved_executable = ""

    def _read(self, proc, responses):
        try:
            for line in proc.stdout:
                if line.startswith(PREFIX):
                    try:
                        result = json.loads(line[len(PREFIX):])
                        if not isinstance(result, dict):
                            raise ValueError("Worker response must be an object.")
                    except ValueError:
                        responses.put({"error": "Invalid response from Blender. Restart the bridge; the command was not retried.", "_fatal": True})
                        return
                    responses.put(result)
                else:
                    print(line.rstrip(), file=sys.stderr, flush=True)
        except (OSError, ValueError):
            # close() may close the pipe while the reader is winding down.
            pass
        finally:
            responses.put({"error": "Blender exited before completing the operation. Restart the bridge; the command was not retried.", "_fatal": True})

    def start(self):
        if self.failed:
            raise RuntimeError(self.failure_reason)
        if self.proc is not None:
            if self.proc.poll() is None:
                return
            self.failure_reason = "The Blender session exited. Restart the bridge to start a new scene."
            self.close()
            raise RuntimeError(self.failure_reason)
        executable = find_blender(self.executable)
        self.resolved_executable = executable
        self.temp = tempfile.TemporaryDirectory(prefix="featherscript-blender-")
        worker = Path(__file__).with_name("blender_worker.py")
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        try:
            self.proc = subprocess.Popen(
                [executable, "--background", "--factory-startup", "--python", str(worker), "--", self.temp.name],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr, text=True,
                encoding="utf-8", errors="replace", bufsize=1, env=env,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
            self.reader = threading.Thread(target=self._read, args=(self.proc, self.responses), daemon=True)
            self.reader.start()
            ready = self.responses.get(timeout=self.timeout)
            if not ready.get("ready"):
                raise RuntimeError(ready.get("error", "Blender did not complete its startup handshake."))
            self.version = ready.get("version", "unknown")
        except queue.Empty:
            self.failure_reason = "Blender startup timed out. Check the executable, then restart the bridge."
            self.close()
            raise TimeoutError(self.failure_reason) from None
        except Exception as error:
            self.failure_reason = f"Blender could not start: {error}. Check the executable, then restart the bridge."
            self.close()
            raise

    def call(self, name, arguments):
        spec = next((item for item in TOOLS if item["name"] == name), None)
        if not spec:
            raise ValueError("Unknown Blender tool.")
        if not isinstance(arguments, dict):
            raise ValueError("Tool arguments must be an object.")
        if set(arguments) - set(spec["inputSchema"]["properties"]):
            raise ValueError("Unknown tool argument.")
        if any(key not in arguments for key in spec["inputSchema"]["required"]):
            raise ValueError("Missing required tool argument.")
        if name == "execute_blender_code" and self.safe_mode:
            raise ValueError("Python execution is disabled in safe mode. Use procedural tools or disable safe mode in MCPs.")
        self.start()
        try:
            self.proc.stdin.write(json.dumps({"tool": name, "arguments": arguments}) + "\n")
            self.proc.stdin.flush()
        except (OSError, ValueError) as error:
            self.failure_reason = "The Blender connection closed while sending a command. Its outcome is unknown. Restart the bridge; the command was not retried."
            self.close()
            raise RuntimeError(self.failure_reason) from error
        try:
            result = self.responses.get(timeout=self.timeout)
        except queue.Empty:
            self.failure_reason = "Blender operation timed out; the process was stopped. Restart the bridge for a new session."
            self.close()
            raise TimeoutError(self.failure_reason) from None
        if "error" in result:
            if result.get("_fatal"):
                self.failure_reason = result["error"]
                self.close()
            raise RuntimeError(result["error"])
        if name == "look":
            image = Path(self.temp.name) / "preview.png"
            return {"content": [{"type": "image", "mimeType": "image/png", "data": base64.b64encode(image.read_bytes()).decode("ascii")}]}
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}

    def close(self):
        self.failed = True
        proc, self.proc = self.proc, None
        if proc:
            try:
                proc.stdin.close()
                proc.wait(timeout=3)
            except (OSError, ValueError, subprocess.TimeoutExpired):
                proc.kill()
                proc.wait(timeout=5)
            if self.reader:
                self.reader.join(timeout=2)
            proc.stdout.close()
        if self.temp:
            self.temp.cleanup()
            self.temp = None


def serve():
    session = BlenderSession(os.environ.get("BLENDER_EXECUTABLE", ""), os.environ.get("BLENDER_MCP_SAFE_MODE", "1") != "0")
    atexit.register(session.close)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: sys.exit(0))
    try:
        for line in sys.stdin:
            try:
                message = json.loads(line)
                if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
                    raise ValueError("Invalid JSON-RPC request.")
            except ValueError:
                print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Invalid JSON-RPC request"}}), flush=True)
                continue
            if "id" not in message:
                continue
            method, params = message.get("method"), message.get("params", {})
            response = {"jsonrpc": "2.0", "id": message["id"]}
            if not isinstance(params, dict):
                response["error"] = {"code": -32602, "message": "Params must be an object"}
            elif method == "initialize":
                response["result"] = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}},
                                      "serverInfo": {"name": "featherscript-headless-blender", "version": "2.0.1"}}
            elif method == "ping":
                response["result"] = {}
            elif method == "tools/list":
                response["result"] = {"tools": TOOLS}
            elif method == "tools/call":
                try:
                    response["result"] = session.call(params.get("name"), params.get("arguments", {}))
                except Exception as error:
                    response["result"] = {"isError": True, "content": [{"type": "text", "text": str(error)}]}
            else:
                response["error"] = {"code": -32601, "message": "Method not found"}
            print(json.dumps(response, ensure_ascii=False), flush=True)
    finally:
        session.close()


def diagnose():
    """Bounded startup and CPU render check in a disposable scene."""
    session = BlenderSession(os.environ.get("BLENDER_EXECUTABLE", ""), timeout=25)
    deadline = time.monotonic() + 35
    atexit.register(session.close)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: sys.exit(1))
    try:
        session.start()
        session.timeout = max(1, deadline - time.monotonic())
        result = session.call("get_scene_info", {})
        scene = json.loads(result["content"][0]["text"])
        session.timeout = max(1, deadline - time.monotonic())
        preview = session.call("look", {"resolution": 64})
        png = base64.b64decode(preview["content"][0]["data"], validate=True)
        if not png.startswith(b"\x89PNG\r\n\x1a\n"):
            raise RuntimeError("Blender started but did not produce a valid PNG preview.")
        print(json.dumps({"ok": True, "executable": session.resolved_executable,
                          "version": session.version, "objects": len(scene["objects"]),
                          "headless": scene["headless"], "rendered": True,
                          "previewBytes": len(png)}), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}), flush=True)
        return 1
    finally:
        session.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["--diagnose"]:
        sys.exit(diagnose())
    serve()
