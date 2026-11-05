"""Default releases must not silently bundle optional development toolkits."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('package_release', ROOT / 'scripts/package-release.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class ReleaseTests(unittest.TestCase):
    def test_release_aliases_only_reference_shipped_skills(self):
        import json
        with tempfile.TemporaryDirectory(prefix='alias-test-', dir=ROOT) as directory:
            source = Path(directory) / '.aliases.json'
            source.write_text(json.dumps({'old-vfx': 'roblox-vfx-mastery', 'private-tool': 'ul-private', 'old-code': {'folder': 'ul-luau-code'}}), encoding='utf-8')
            self.assertEqual(json.loads(package.release_data(source, 'skills/.aliases.json')), {'old-vfx': 'roblox-vfx-mastery'})

    def test_baseline_skills_and_runtime_files(self):
        with tempfile.TemporaryDirectory(prefix='release-test-', dir=ROOT) as directory:
            root = Path(directory)
            files = ['bridge.py', 'featherscript-extension/providers/aistudio.js',
                     '.test-temp/private.txt', 'featherscript-app/.test-temp/fixture.exe',
                     'blender_headless.py', 'blender_worker.py', 'tool_groups.py', 'assets/banner.svg',
                     'assets/banner.png', 'computer-access.json', 'featherscript-store.json', 'logs/private.log', 'featherscript-app/node_modules/test.js',
                     'skills/ul-game-pipeline/scripts/capture_frames.ps1',
                     'skills/custom-user-skill/SKILL.md']
            files += [f'skills/{name}/SKILL.md' for name in package.CORE_SKILLS]
            for relative in files:
                file = root / relative
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('fixture', encoding='utf-8')
            included = {p.relative_to(root).as_posix() for p in package.release_files(root)}
            self.assertEqual(included, {'bridge.py', 'blender_headless.py', 'blender_worker.py', 'tool_groups.py',
                'featherscript-extension/providers/aistudio.js',
                *(f'skills/{name}/SKILL.md' for name in package.CORE_SKILLS)})
            self.assertTrue((root / 'skills/custom-user-skill/SKILL.md').exists())
            self.assertTrue((root / 'skills/ul-game-pipeline/scripts/capture_frames.ps1').exists())


if __name__ == '__main__':
    unittest.main()
