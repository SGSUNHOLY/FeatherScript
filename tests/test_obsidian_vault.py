import json
from pathlib import Path
import tempfile
import unittest

import obsidian_vault as vault


class VaultTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.root = Path(self.temporary.name)
        (self.root / 'Welcome.md').write_text('# Welcome\nProject notes for FeatherScript', encoding='utf-8')
        (self.root / '.obsidian').mkdir()
        (self.root / '.obsidian' / 'secret.md').write_text('hidden')
        vault.configure({'path': str(self.root)})

    def tearDown(self):
        vault.configure({})
        self.temporary.cleanup()

    def test_read_search_and_list(self):
        listed = json.loads(vault.call('obsidian_list_notes', {})['text'])
        self.assertEqual(listed['notes'], ['Welcome.md'])
        found = json.loads(vault.call('obsidian_search', {'query': 'featherscript'})['text'])
        self.assertEqual(found['notes'][0]['path'], 'Welcome.md')
        self.assertIn('Project notes', vault.call('obsidian_read_note', {'path': 'Welcome.md'})['text'])

    def test_path_and_permission_guards(self):
        for path in ['../outside.md', '.obsidian/secret.md', str(self.root / 'Welcome.md'), 'note.txt', 'note:stream.md']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                vault.call('obsidian_read_note', {'path': path})
        with self.assertRaises(ValueError):
            vault.call('obsidian_write_note', {'path': 'New.md', 'content': 'test'})
        self.assertNotIn('obsidian_write_note', [tool['name'] for tool in vault.tool_defs()])

    def test_explicit_note_edits_and_disconnect(self):
        vault.configure({'path': str(self.root), 'allowWrite': True})
        vault.call('obsidian_write_note', {'path': 'Project/Task.md', 'content': 'first'})
        with self.assertRaises(FileExistsError):
            vault.call('obsidian_write_note', {'path': 'Project/Task.md', 'content': 'second'})
        vault.call('obsidian_write_note', {'path': 'Project/Task.md', 'content': 'second', 'overwrite': True})
        self.assertEqual((self.root / 'Project' / 'Task.md').read_text(), 'second')
        vault.configure({})
        self.assertEqual(vault.tool_defs(), [])
        with self.assertRaises(ValueError):
            vault.call('obsidian_list_notes', {})


if __name__ == '__main__':
    unittest.main()
