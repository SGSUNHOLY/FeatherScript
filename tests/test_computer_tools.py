import unittest, os, json, contextvars
from unittest.mock import patch
import computer_tools as pc

class ComputerToolsTests(unittest.TestCase):
    def test_disabled_without_broker(self):
        with patch.dict(os.environ,{'FS_PC_PORT':'','FS_PC_TOKEN':''}):
            self.assertEqual(pc.tool_defs(),[])
            with self.assertRaises(RuntimeError): pc.call('pc_system_info',{})

    def test_schema_names_unique(self):
        self.assertEqual(len(pc.TOOLS),21)
        self.assertEqual(len(pc.NAMES),106)
        for tool in pc.TOOLS:
            self.assertEqual(tool['inputSchema']['type'],'object')
            self.assertFalse(tool['inputSchema']['additionalProperties'])
            self.assertEqual(tool['server'],'computer')
        self.assertIn('pc_search_files',pc.NAMES)
        self.assertIn('pc_clipboard_write',pc.NAMES)
        self.assertIn('pc_open_url',pc.NAMES)

    def test_base_names_match_the_desktop_broker(self):
        # computer_tools.py and computer-access.js each hand-list the base pc_*
        # names. A rename on one side silently changes which tools the permission
        # broker is willing to accept, so the two lists are asserted identical.
        import re
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, '..', 'computer_tools.py'), encoding='utf-8-sig') as handle:
            source = handle.read()
        declared = set(re.findall(r"schema\('(pc_[a-z_]+)'", source))
        with open(os.path.join(here, '..', 'featherscript-app', 'computer-access.js'), encoding='utf-8-sig') as handle:
            broker = handle.read()
        listed = set(re.findall(r"'(pc_[a-z_]+)'", broker.split('const TOOL_NAMES')[1].split('const TRUSTED_TOOLS')[0]))
        self.assertTrue(declared)
        self.assertEqual(declared, listed)

    def test_context_is_per_client(self):
        first=contextvars.copy_context();second=contextvars.copy_context()
        first.run(pc.CLIENT_ORIGIN.set,'chrome-extension://'+'a'*32)
        second.run(pc.CLIENT_ORIGIN.set,'chrome-extension://'+'b'*32)
        self.assertNotEqual(first.run(pc.CLIENT_ORIGIN.get),second.run(pc.CLIENT_ORIGIN.get))

if __name__=='__main__':unittest.main()
