#!/usr/bin/env python3
"""Build the small, first-run-install release using only Python's standard library."""

import ast
import hashlib
import json
import os
from pathlib import Path
import zipfile

from svg_assets import validate_svg


ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_DIRS = {
    "node_modules", "__pycache__", ".git", ".codex", ".agents", ".venv",
    "venv", "logs", "releases", "Compressed", "Deprecated", "devtools",
    ".qa", ".pytest_cache", ".mypy_cache", "ExtensionPresentation", "presentation",
}
# Promotional artwork is source material, unused by the app and extension.
SOURCE_ONLY_FILES = {"assets/banner.svg", "assets/banner.png"}
# Keep the baseline skill families plus the explicitly requested VFX and Eclipse authoring packs.
# Optional development toolkits remain in source and are not silently bundled.
CORE_SKILLS = {
    "roblox-characters-animations", "roblox-npc-ai", "roblox-performance",
    "roblox-world-building", "roblox-graphics", "roblox-ui", "roblox-code", "stud-ui-clean", "roblox-vfx-mastery", "eclipse-animator",
}
EXCLUDED_FILES = {".DS_Store", "Thumbs.db", "desktop.ini", ".env", "computer-access.json", "featherscript-store.json"}
DEFAULT_CONFIG = {
    "mcpServers": {"roblox": {"command": "launch_studio_mcp.py", "args": []}},
    "blender": {"enabled": False, "mode": "headless", "executable": "", "safeMode": True},
    "theme": "dark",
}


def release_files(root=ROOT):
    # Prune before descending: installed Electron is never read or compressed.
    for directory, folders, files in os.walk(root, followlinks=False):
        folders[:] = sorted(
            name for name in folders
            if name not in EXCLUDED_DIRS and not name.startswith('.test-')
            and not (Path(directory) / name).is_symlink()
        )
        relative_directory = Path(directory).relative_to(root)
        if relative_directory == Path("skills"):
            folders[:] = [name for name in folders if name in CORE_SKILLS]
        for name in sorted(files):
            source = Path(directory) / name
            if source.relative_to(root).as_posix() in SOURCE_ONLY_FILES:
                continue
            if (source.is_symlink() or name in EXCLUDED_FILES or name.startswith(".env.")
                    or source.suffix.lower() in {".zip", ".pyc", ".pyo", ".log"}):
                continue
            yield source


def release_data(source, relative):
    if relative == 'config.json':
        return (json.dumps(DEFAULT_CONFIG, indent=2) + '\n').encode()
    if relative == 'skills/.aliases.json':
        aliases = json.loads(source.read_text('utf-8-sig'))
        included = {name: value for name, value in aliases.items()
                    if (value.get('folder') if isinstance(value, dict) else value) in CORE_SKILLS}
        return (json.dumps(included, indent=2) + '\n').encode()
    return source.read_bytes()


def main():
    version = json.loads((ROOT / "featherscript-app/package.json").read_text("utf-8"))["version"]
    prefix = f"FeatherScript-{version}"
    output = ROOT / "releases" / f"{prefix}-Lite.zip"
    output.parent.mkdir(exist_ok=True)
    temporary = output.with_suffix(".zip.tmp")
    source_bytes = 0
    count = 0
    hashes = []
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for source in release_files():
                relative = source.relative_to(ROOT).as_posix()
                if relative == "FILES.sha256":
                    continue
                if source.suffix.lower() in {".exe", ".dll", ".scr", ".com", ".msi", ".pyd"}:
                    raise RuntimeError(f"Unexpected native binary in Lite release: {relative}")
                data = release_data(source, relative)
                if source.suffix.lower() == ".py":
                    # Reject broken Python source before shipping an app that
                    # cannot start its bridge (for example, a merged class and
                    # method declaration on the same line).
                    ast.parse(data.decode("utf-8-sig"), filename=relative)
                if source.suffix.lower() == ".svg":
                    validate_svg(data, relative)
                info = zipfile.ZipInfo(f"{prefix}/{relative}", (2026, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (0o100755 if relative.endswith(".command") else 0o100644) << 16
                archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
                source_bytes += len(data)
                count += 1
                hashes.append(f"{hashlib.sha256(data).hexdigest()}  {relative}")
            manifest = ("\n".join(hashes) + "\n").encode("utf-8")
            archive.writestr(f"{prefix}/FILES.sha256", manifest, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
            count += 1
        with zipfile.ZipFile(temporary) as archive:
            bad_file = archive.testzip()
            if bad_file:
                raise RuntimeError(f"Archive integrity check failed: {bad_file}")
            required = {
                'FILES.sha256',
                'LICENSE',
                'app.bat',
                'blender_headless.py',
                'blender_worker.py',
                'bridge.py',
                'project_memory.py',
                'featherscript-app/project-service.js',
                'featherscript-app/renderer/modules/projects.js',
                'featherscript-app/renderer/styles/projects.css',
                'featherscript-extension/core/projects.js',
                'featherscript-extension/core/projects-ui.js',
                'featherscript-extension/projects.css',
                'docs/PROJECT_MEMORY.md',
                'command_journal.py',
                'computer_tools.py',
                'featherscript-app/computer-tool-catalog.json',
                'featherscript-app/computer-tool-pack.js',
                'roblox_workflows.py',
                'config.json',
                'featherscript-app/blender-diagnostics.js',
                'featherscript-extension/audio.html',
                'featherscript-extension/audio.js',
                'featherscript-extension/audio.css',
                'featherscript-extension/core/audio-broker.js',
                'featherscript-extension/core/audio-ui.js',
                'featherscript-extension/assets/ambient.wav',
                'docs/EXTENSION_AUDIO.md',
                'featherscript-app/computer-access.js',
                'featherscript-app/main.js',
                'featherscript-app/package-lock.json',
                'featherscript-app/renderer/index.html',
                'featherscript-app/renderer/modules/blender-controller.js',
                'featherscript-app/renderer/modules/computer-controller.js',
                'featherscript-app/renderer/modules/guides.js',
                'featherscript-app/renderer/modules/layout-transition.js',
                'featherscript-app/renderer/styles/guides.css',
                'featherscript-app/renderer/styles/layouts.css',
                'featherscript-app/renderer/styles/native-backdrop.css',
                'featherscript-app/renderer/styles/motion-finish.css',
                'featherscript-app/renderer/styles/ambient-motion.css',
                'featherscript-app/renderer/styles/refinements.css',
                'featherscript-app/renderer/styles/studio-finish.css',
                'featherscript-app/renderer/styles/workspace-finish.css',
                'featherscript-app/scripts/install-electron.js',
                'featherscript-app/window-effects.js',
                'featherscript-extension/core/commands.js',
                'featherscript-extension/core/cowork.js',
                'featherscript-extension/core/task-policy.js',
                'featherscript-extension/core/theme-presets.json',
                'featherscript-extension/core/workflow.js',
                'featherscript-extension/manifest.json',
                'featherscript-extension/workflow.css',
                'featherscript-extension/controller-layout.css',
                'featherscript-extension/controller-skin.css',
                'featherscript-extension/theme-identities.css',
                'featherscript-extension/core/theme-identities.json',
                'featherscript-app/renderer/theme-identities.css',
                'skills/roblox-vfx-mastery/SKILL.md',
                'mcp-presets.json','launch_optional_mcp.py','featherscript-app/mcp-presets.js','featherscript-app/renderer/modules/mcp-presets.js',
            }
            identities = json.loads((ROOT / 'featherscript-extension/core/theme-identities.json').read_text('utf-8-sig'))
            required.update(f'featherscript-extension/assets/themes/{theme}.svg' for theme in identities)
            missing = required - {name.removeprefix(prefix + "/") for name in archive.namelist()}
            if missing:
                raise RuntimeError(f"Missing release files: {sorted(missing)}")
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(".zip.sha256").write_text(f"{digest}  {output.name}\n", encoding="ascii")
    print(f"Created {output}\n{count} files; {source_bytes:,} bytes before compression; {output.stat().st_size:,} bytes ZIP")
    print(f"SHA256 {digest}")


if __name__ == "__main__":
    main()
