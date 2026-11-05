import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from blender_headless import BlenderSession, find_blender


class HeadlessTests(unittest.TestCase):
    def test_malformed_worker_reply_is_terminal(self):
        import io
        from unittest.mock import Mock
        session = BlenderSession()
        reader_process = Mock(stdout=io.StringIO('FEATHERSCRIPT_RESULT:[]\n'))
        session._read(reader_process, session.responses)
        process = Mock()
        process.poll.return_value = None
        session.proc = process
        with self.assertRaisesRegex(RuntimeError, 'Invalid response from Blender'):
            session.call('get_scene_info', {})
        self.assertIsNone(session.proc)
        self.assertTrue(session.failed)
        with self.assertRaisesRegex(RuntimeError, 'Invalid response from Blender'):
            session.start()

    def test_worker_eof_cleans_session_and_retains_exit_error(self):
        import io
        from unittest.mock import Mock
        session = BlenderSession()
        session._read(Mock(stdout=io.StringIO('')), session.responses)
        session.proc = Mock()
        session.proc.poll.return_value = None
        with self.assertRaisesRegex(RuntimeError, 'exited before completing'):
            session.call('get_scene_info', {})
        self.assertIsNone(session.proc)
        with self.assertRaisesRegex(RuntimeError, 'exited before completing'):
            session.start()

    def test_exited_worker_cleans_temp_without_starting_new_scene(self):
        from unittest.mock import Mock
        session = BlenderSession()
        session.temp = tempfile.TemporaryDirectory(prefix='blender-exit-test-')
        temporary = Path(session.temp.name)
        session.proc = Mock()
        session.proc.poll.return_value = 9
        with self.assertRaisesRegex(RuntimeError, 'exited'):
            session.start()
        self.assertIsNone(session.proc)
        self.assertFalse(temporary.exists())

    def test_failed_spawn_cleans_temporary_scene_and_preserves_reason(self):
        session = BlenderSession('configured-blender')
        with patch('blender_headless.find_blender', return_value='configured-blender'), \
             patch('blender_headless.subprocess.Popen', side_effect=OSError('Access denied')):
            with self.assertRaisesRegex(OSError, 'Access denied'):
                session.start()
        self.assertIsNone(session.temp)
        self.assertIsNone(session.proc)
        with self.assertRaisesRegex(RuntimeError, 'could not start.*Access denied'):
            session.start()
        session.close()

    def test_closed_session_is_not_reported_as_timeout(self):
        session = BlenderSession()
        session.close()
        with self.assertRaisesRegex(RuntimeError, 'session is closed'):
            session.start()

    def test_broken_pipe_does_not_retry_unknown_outcome(self):
        from unittest.mock import Mock
        session = BlenderSession()
        process = Mock()
        process.stdin.write.side_effect = BrokenPipeError('worker exited')
        process.poll.return_value = None
        session.proc = process
        with self.assertRaisesRegex(RuntimeError, 'outcome is unknown.*not retried'):
            session.call('generate_3d', {'primitive': 'cube'})
        process.stdin.write.assert_called_once()
        self.assertIsNone(session.proc)
        with self.assertRaisesRegex(RuntimeError, 'outcome is unknown'):
            session.start()

    @unittest.skipUnless(os.environ.get('FS_TEST_BLENDER'), 'Set FS_TEST_BLENDER for real Blender integration')
    def test_real_diagnostic_verifies_render(self):
        process = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'blender_headless.py'), '--diagnose'],
            env=dict(os.environ, BLENDER_EXECUTABLE=os.environ['FS_TEST_BLENDER']),
            text=True, capture_output=True, timeout=45)
        self.assertEqual(process.returncode, 0, process.stderr)
        result = json.loads(process.stdout)
        self.assertTrue(result['headless'])
        self.assertTrue(result['rendered'])
        self.assertGreater(result['previewBytes'], 8)

    def test_safe_mode_does_not_launch_for_code(self):
        session = BlenderSession()
        with self.assertRaisesRegex(ValueError, 'disabled in safe mode'):
            session.call('execute_blender_code', {'code': 'print(1)'})
        self.assertIsNone(session.proc)
        with self.assertRaises(ValueError):
            session.call('unknown', {})
        with self.assertRaises(ValueError):
            session.call('generate_3d', {})

    def test_missing_executable(self):
        with self.assertRaises(FileNotFoundError):
            find_blender(str(Path(__file__).with_name('missing-blender-executable')))

    @unittest.skipUnless(os.environ.get('FS_TEST_BLENDER'), 'Set FS_TEST_BLENDER for real Blender integration')
    def test_real_worker_crash_releases_temporary_scene(self):
        session = BlenderSession(os.environ['FS_TEST_BLENDER'])
        try:
            session.start()
            temporary = Path(session.temp.name)
            process = session.proc
            process.kill()
            process.wait(timeout=10)
            with self.assertRaisesRegex(RuntimeError, 'session exited'):
                session.call('get_scene_info', {})
            self.assertIsNone(session.proc)
            self.assertFalse(temporary.exists())
            with self.assertRaisesRegex(RuntimeError, 'session exited'):
                session.start()
        finally:
            session.close()

    def test_stdio_catalogue_without_blender(self):
        requests = [
            {'id': 1, 'method': 'initialize'},
            {'method': 'notifications/initialized'},
            {'id': 2, 'method': 'tools/list'},
            {'id': 3, 'method': 'tools/call', 'params': {'name': 'execute_blender_code', 'arguments': {'code': 'print(1)'}}},
            {'id': 4, 'method': 'tools/call', 'params': []},
        ]
        process = subprocess.run([sys.executable, str((Path(__file__).resolve().parents[1] / 'blender_headless.py'))],
            input='\n'.join(json.dumps(dict(jsonrpc='2.0', **item)) for item in requests) + '\n',
            text=True, capture_output=True, timeout=10)
        self.assertEqual(process.returncode, 0, process.stderr)
        responses = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual([item['id'] for item in responses], [1, 2, 3, 4])
        # The whole catalogue is served from a static table with no Blender present.
        # That is exactly why bridge.MCPManager.health() preflights the executable
        # instead of trusting this reply as proof Blender works.
        from blender_headless import TOOLS
        self.assertEqual([tool['name'] for tool in responses[1]['result']['tools']], [tool['name'] for tool in TOOLS])
        self.assertTrue(responses[2]['result']['isError'])
        self.assertEqual(responses[3]['error']['code'], -32602)

    def test_diagnostic_reports_missing_executable(self):
        process = subprocess.run([sys.executable, str((Path(__file__).resolve().parents[1] / 'blender_headless.py')), '--diagnose'],
            env=dict(os.environ, BLENDER_EXECUTABLE=str(Path(__file__).with_name('missing-blender-executable'))),
            text=True, capture_output=True, timeout=10)
        self.assertEqual(process.returncode, 1)
        self.assertIn('does not exist', json.loads(process.stdout)['error'])

    def test_preflight_answers_before_any_blender_is_launched(self):
        from blender_headless import preflight
        missing = str(Path(__file__).with_name('missing-blender-executable'))
        found, reason = preflight(missing)
        self.assertFalse(found)
        self.assertIn('does not exist', reason)
        # health() re-asks every couple of seconds; the filesystem search is cached.
        with patch('blender_headless.find_blender', side_effect=FileNotFoundError('Blender was not found.')) as resolve:
            first = preflight('cached-override')
            self.assertEqual(preflight('cached-override'), first)
            self.assertEqual(resolve.call_count, 1)
            self.assertEqual(preflight('other-override')[0], False, 'a different executable setting is re-checked')
        with patch('blender_headless.find_blender', return_value='/usr/bin/blender'):
            self.assertEqual(preflight('/usr/bin/blender'), (True, None))

    @unittest.skipUnless(os.environ.get('FS_TEST_BLENDER'), 'Set FS_TEST_BLENDER for real Blender integration')
    def test_real_stdio_mcp_path(self):
        from bridge import MCPClient
        client = MCPClient('blender', 'blender_headless.py', [], {
            'BLENDER_EXECUTABLE': os.environ['FS_TEST_BLENDER'], 'BLENDER_MCP_SAFE_MODE': '1'})
        try:
            client.start()
            self.assertTrue(client.is_alive())
            client.call_tool('generate_3d', {'primitive': 'cube', 'name': 'STDIO integration'}, 45)
            result = client.call_tool('get_scene_info', {}, 45)
            self.assertIn('STDIO integration', result['text'])
            preview = client.call_tool('look', {'resolution': 64}, 45)
            self.assertTrue(preview['images'])
        finally:
            client.stop()

    @unittest.skipUnless(os.environ.get('FS_TEST_BLENDER'), 'Set FS_TEST_BLENDER for real Blender integration')
    def test_real_blender(self):
        session = BlenderSession(os.environ['FS_TEST_BLENDER'])
        with tempfile.TemporaryDirectory(prefix='blender-test-', dir=Path(__file__).parent) as output:
            try:
                session.call('generate_3d', {'primitive': 'sphere', 'name': 'Persistent test', 'location': [2, 0, 0]})
                process = session.proc
                info = json.loads(session.call('get_scene_info', {})['content'][0]['text'])
                self.assertTrue(info['headless'])
                self.assertTrue(any(obj['name'] == 'Persistent test' for obj in info['objects']))
                self.assertIs(session.proc, process)
                target = str((Path(output) / 'scene.blend').resolve())
                session.call('save_scene', {'path': target})
                self.assertGreater(Path(target).stat().st_size, 1000)
                with self.assertRaises(RuntimeError):
                    session.call('save_scene', {'path': target})
                with self.assertRaises(RuntimeError):
                    session.call('generate_3d', {'primitive': 'unknown'})
                preview = session.call('look', {'resolution': 64})['content'][0]
                self.assertEqual(base64.b64decode(preview['data'])[:8], b'\x89PNG\r\n\x1a\n')
                session.safe_mode = False
                reply = session.call('execute_blender_code', {'code': "print(bpy.app.background)"})
                self.assertIn('True', json.loads(reply['content'][0]['text'])['output'])
                temporary = Path(session.temp.name)
            finally:
                session.close()
            self.assertIsNotNone(process.poll())
            self.assertFalse(temporary.exists())


if __name__ == '__main__':
    unittest.main()
