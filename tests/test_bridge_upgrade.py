"""Bridge upgrade regression tests; no Blender or Studio installation required."""
import asyncio
import json
import unittest
from unittest.mock import patch

import bridge


class FakeProcess:
    def poll(self):
        return None


class BridgeTests(unittest.TestCase):
    def test_port_conflict_never_terminates_other_app(self):
        with patch.object(bridge, '_port_owner', return_value=('123', 'OtherApp', 'C:/Other/app.exe')), \
             patch.object(bridge.subprocess, 'run') as run, \
             patch.object(bridge, 'action_banner'), patch.object(bridge, 'log'):
            self.assertTrue(bridge.check_studio_port())
            run.assert_not_called()

    def test_unrelated_python_bridge_is_not_terminated(self):
        with patch.object(bridge, '_port_owner', return_value=('123', 'python', 'python.exe')), \
             patch.object(bridge, '_process_cmdline', return_value='python C:/Other/bridge.py'), \
             patch.object(bridge.subprocess, 'run') as run, patch.object(bridge, 'log'):
            self.assertFalse(bridge._reclaim_bridge_port())
            run.assert_not_called()

    def test_mcp_error_is_not_success(self):
        client = bridge.MCPClient("blender", "unused", [], {})
        client.proc = FakeProcess()
        client._request = lambda *args, **kwargs: {
            "result": {"isError": True, "content": [{"type": "text", "text": "safe mode rejected code"}]}
        }
        with self.assertRaisesRegex(RuntimeError, "safe mode rejected"):
            client.call_tool("execute_blender_code", {"code": "test"}, 1)

    def test_schema_collision_routing(self):
        class Client:
            def __init__(self, name):
                self.tools_cache = [{"name": "get_scene_info", "inputSchema": {"type": "object", "properties": {name: {"type": "string"}}}}]

        manager = bridge.MCPManager()
        manager.clients = {"first": Client("first"), "blender": Client("blender")}
        manager.rebuild_index()
        tools = manager.list_tools()
        self.assertEqual([t["name"] for t in tools], ["get_scene_info", "blender/get_scene_info"])
        self.assertIn("blender", tools[1]["inputSchema"]["properties"])

    def test_theme_persistence_and_push(self):
        async def scenario():
            config = {"mcpServers": {}}
            with patch.object(bridge, "_read_config", return_value=config), \
                 patch.object(bridge, "_write_config") as write, \
                 patch.object(bridge, "probe_studio", return_value={"place": None, "app": None}), \
                 patch.object(bridge, "_roblox_studio_app_running", return_value=False):
                bridge.active_theme = "auto"
                class Socket:
                    remote_address = ("127.0.0.1", 0)
                    def __init__(self, messages=()):
                        self.messages = iter(messages)
                        self.sent = []
                    def __aiter__(self):
                        return self
                    async def __anext__(self):
                        try:
                            return json.dumps(next(self.messages))
                        except StopIteration:
                            raise StopAsyncIteration
                    async def send(self, message):
                        self.sent.append(json.loads(message))
                first = Socket([
                    {"type": "set_theme", "theme": "azure"},
                    {"type": "set_theme", "theme": "azure"},
                    {"type": "set_theme", "theme": "invalid", "id": 9},
                ])
                second = Socket()
                bridge.clients.add(second)
                try:
                    await bridge.handler(first)
                    self.assertEqual(second.sent, [{"type": "theme", "theme": "azure"}])
                    write.assert_called_once()
                    self.assertEqual(config["theme"], "azure")
                    self.assertFalse(first.sent[-1]["ok"])
                    self.assertEqual(bridge.active_theme, "azure")
                finally:
                    bridge.clients.discard(second)
        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
