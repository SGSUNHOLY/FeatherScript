"""Local Markdown vault tools. Configuration is explicit; note paths stay in the vault."""
import json
import os
import tempfile
import threading
from pathlib import Path

_settings = {"path": "", "allowWrite": False}
_lock = threading.RLock()
MAX_NOTE_BYTES = 1024 * 1024


def configure(value):
    raw = value.get("path", "")
    if not isinstance(raw, str):
        raise ValueError("Vault path must be text.")
    allow_write = value.get("allowWrite", False)
    if not isinstance(allow_write, bool):
        raise ValueError("Allow note edits must be a boolean.")
    folder = Path(raw).expanduser().resolve() if raw.strip() else None
    if folder and not folder.is_dir():
        raise ValueError("Choose an existing Obsidian vault folder.")
    with _lock:
        _settings.update(path=str(folder) if folder else "", allowWrite=allow_write)
        return dict(_settings)


def settings():
    with _lock:
        return dict(_settings)


def _root():
    if not _settings["path"]:
        raise ValueError("Connect an Obsidian vault in the extension dashboard first.")
    root = Path(_settings["path"]).resolve()
    if not root.is_dir():
        raise ValueError("The connected vault folder is unavailable.")
    return root


def _note(root, name):
    if not isinstance(name, str) or not name.strip():
        raise ValueError("A relative Markdown note path is required.")
    relative = Path(name)
    if relative.is_absolute() or relative.drive or any(p.startswith('.') or ':' in p for p in relative.parts):
        raise ValueError("Use a relative note path without hidden folders or parent traversal.")
    target = (root / relative).resolve()
    if not target.is_relative_to(root) or target.suffix.lower() != '.md':
        raise ValueError("Only Markdown notes inside the connected vault are accessible.")
    return target


def _notes(root):
    # Do not follow directory links or scan Obsidian metadata, Git or trash.
    for folder, directories, files in os.walk(root, followlinks=False):
        directories[:] = sorted(d for d in directories if not d.startswith('.') and not Path(folder, d).is_symlink())
        for name in sorted(files):
            if not name.startswith('.') and name.lower().endswith('.md'):
                note = Path(folder, name)
                if not note.is_symlink() and note.resolve().is_relative_to(root):
                    yield note


def _read(note):
    if note.stat().st_size > MAX_NOTE_BYTES:
        raise ValueError("Note exceeds the 1 MiB limit.")
    return note.read_text(encoding='utf-8-sig')


def tool_defs():
    if not settings()["path"]:
        return []
    definitions = [
        ("obsidian_list_notes", "List Markdown note paths in the connected Obsidian vault (up to 500).", {"limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 100}}, []),
        ("obsidian_read_note", "Read a Markdown note from the connected Obsidian vault.", {"path": {"type": "string", "description": "Relative .md path in the vault"}}, ["path"]),
        ("obsidian_search", "Search note names and text in the connected Obsidian vault. Returns matching paths and short excerpts.", {"query": {"type": "string", "minLength": 1}, "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20}}, ["query"]),
    ]
    if settings()["allowWrite"]:
        definitions.append(("obsidian_write_note", "Create or replace a Markdown note. Replacing an existing note requires overwrite=true.", {"path": {"type": "string"}, "content": {"type": "string"}, "overwrite": {"type": "boolean", "default": False}}, ["path", "content"]))
    return [{"name": name, "description": description, "inputSchema": {"type": "object", "properties": properties, "required": required, "additionalProperties": False}, "server": "obsidian"} for name, description, properties, required in definitions]


def call(name, arguments):
    with _lock:
        root = _root()
        if name == "obsidian_read_note":
            value = {"path": arguments.get("path"), "content": _read(_note(root, arguments.get("path")))}
        elif name in ("obsidian_list_notes", "obsidian_search"):
            limit = arguments.get("limit", 100 if name == "obsidian_list_notes" else 20)
            maximum = 500 if name == "obsidian_list_notes" else 100
            if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= maximum:
                raise ValueError(f"limit must be an integer from 1 to {maximum}.")
            query = arguments.get("query", "")
            if name == "obsidian_search" and (not isinstance(query, str) or not query.strip()):
                raise ValueError("Enter a nonempty search query.")
            results = []
            scanned = 0
            read_bytes = 0
            limited_by_bytes = False
            for note in _notes(root):
                scanned += 1
                if scanned > 10000:
                    break
                relative = note.relative_to(root).as_posix()
                if name == "obsidian_list_notes":
                    results.append(relative)
                else:
                    try:
                        size = note.stat().st_size
                        if size > MAX_NOTE_BYTES:
                            continue
                        if read_bytes + size > 16 * 1024 * 1024:
                            limited_by_bytes = True
                            break
                        read_bytes += size
                        content = _read(note)
                    except (OSError, UnicodeError, ValueError):
                        continue
                    index = content.casefold().find(query.casefold())
                    if index < 0 and query.casefold() not in relative.casefold():
                        continue
                    results.append({"path": relative, "excerpt": content[max(0, index - 80):max(0, index) + 240]})
                if len(results) >= limit:
                    break
            value = {"notes": results, "scanned": min(scanned, 10000), "limited": len(results) >= limit or scanned > 10000 or limited_by_bytes}
        elif name == "obsidian_write_note":
            if not _settings["allowWrite"]:
                raise ValueError("Note edits are disabled for this vault.")
            note = _note(root, arguments.get("path"))
            content = arguments.get("content")
            overwrite = arguments.get("overwrite", False)
            if not isinstance(overwrite, bool):
                raise ValueError("overwrite must be a boolean.")
            if not isinstance(content, str) or len(content.encode('utf-8')) > MAX_NOTE_BYTES:
                raise ValueError("Note content must be text no larger than 1 MiB.")
            note.parent.mkdir(parents=True, exist_ok=True)
            if not overwrite:
                with note.open('x', encoding='utf-8') as stream:
                    stream.write(content)
            else:
                descriptor, temporary = tempfile.mkstemp(prefix='.fs-note-', dir=note.parent)
                try:
                    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
                        stream.write(content)
                    os.replace(temporary, note)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
            value = {"path": note.relative_to(root).as_posix(), "saved": True}
        else:
            raise ValueError(f"Unknown vault tool: {name}")
        return {"text": json.dumps(value, ensure_ascii=False), "images": []}
