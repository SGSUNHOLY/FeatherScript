"""MCP client lifecycle regressions: stale reader threads, dead pipes and the
single-flight tool refresh. No MCP server or Studio install is required."""
import json
import queue
import unittest
from unittest.mock import patch

import bridge


class FakeStream:
    def __init__(self, lines=()):
        self.lines = list(lines)
        self.written = []

    def readline(self):
        return self.lines.pop(0) if self.lines else ""

    def write(self, text):
        self.written.append(text)

    def flush(self):
        pass


class FakeProc:
    def __init__(self, exit_code=None):
        self.pid = 4242
        self.stdout = FakeStream()
        self.stderr = FakeStream()
        self.stdin = FakeStream()
        self.exit_code = exit_code

    def poll(self):
        return self.exit_code


class BrokenStdin(FakeStream):
    def write(self, text):
        raise BrokenPipeError("child is gone")


class ClientTests(unittest.TestCase):
    def test_stale_reader_does_not_report_against_the_new_process(self):
        client = bridge.MCPClient("roblox", "unused", [], {})
        old = FakeProc(exit_code=1)
        client.proc = FakeProc()  # a restart already installed a fresh process
        wake = queue.Queue(maxsize=1)
        client.pending[7] = wake
        with patch.object(bridge, "log"):
            client._reader(old)
        self.assertIsNone(client.last_exit, "the old exit code must not describe the new process")
        self.assertTrue(wake.empty(), "the new process's pending call must not be failed")
        self.assertIn(7, client.pending)

    def test_reader_reports_the_current_process(self):
        client = bridge.MCPClient("roblox", "unused", [], {})
        proc = FakeProc(exit_code=3)
        client.proc = proc
        wake = queue.Queue(maxsize=1)
        client.pending[9] = wake
        with patch.object(bridge, "log"):
            client._reader(proc)
        self.assertEqual(client.last_exit, 3)
        self.assertIsNone(wake.get_nowait(), "waiters are woken on EOF")

    def test_request_reports_a_dead_pipe_as_no_response(self):
        client = bridge.MCPClient("roblox", "unused", [], {})
        proc = FakeProc()
        proc.stdin = BrokenStdin()
        client.proc = proc
        self.assertIsNone(client._request("tools/list", {}, 0.5))
        self.assertEqual(client.pending, {}, "no request is left in the table")

    def test_failed_initialize_kills_the_half_started_process(self):
        client = bridge.MCPClient("roblox", "unused", [], {})
        proc = FakeProc()

        class Spinner:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        with patch.object(bridge.subprocess, "Popen", return_value=proc), \
             patch.object(bridge.subprocess, "run"), \
             patch.object(bridge, "_Spinner", Spinner), \
             patch.object(bridge, "log"), \
             patch.object(bridge.MCPClient, "_request", return_value=None):
            with self.assertRaises(RuntimeError):
                client.start()
        self.assertIsNone(client.proc, "a client that failed to initialize must not look alive")

    def test_concurrent_refresh_serves_the_cache(self):
        manager = bridge.MCPManager()

        class Client:
            tools_cache = [{"name": "a"}]

            def __init__(self):
                self.refreshed = 0

            def is_alive(self):
                return True

            def refresh_tools(self, timeout=20):
                self.refreshed += 1
                return self.tools_cache

        client = Client()
        manager.clients = {"blender": client}
        manager.rebuild_index()
        manager.refresh_lock.acquire()  # another thread is already refreshing
        try:
            with patch.object(bridge, "log"):
                tools = manager.list_tools(refresh=True)
        finally:
            manager.refresh_lock.release()
        self.assertEqual([t["name"] for t in tools], ["a"])
        self.assertEqual(client.refreshed, 0, "a second refresh must not queue behind the first")


if __name__ == "__main__":
    unittest.main()
