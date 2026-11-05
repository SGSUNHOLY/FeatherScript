"""Per-server MCP verdicts - the words the bar chip, the dashboard, the popup, the
app and the model's own list_mcp_servers all quote from one place. A server may
only claim "working" when its pipe AND the thing it drives are proven, which is
exactly what StudioMCP (answers with no Studio) and the headless Blender server
(lists tools before Blender was ever found) fake."""
import unittest
from unittest.mock import patch

import bridge


class FakeClient:
    def __init__(self, server_id, alive=True, tools=("execute_luau",), error=None, env=None):
        self.id = server_id
        self.alive = alive
        self.tools_cache = list(tools)
        self.start_error = error
        self.env = env or {}

    def is_alive(self):
        return self.alive


def health(clients, studio=None):
    manager = bridge.MCPManager()
    manager.clients = {client.id: client for client in clients}
    pc = {"state": "working", "tools": 40, "lastError": None, "fix": None}
    with patch.object(bridge, "_feather_tools", None), \
            patch.object(bridge.computer_tools, "status", return_value=pc), \
            patch.object(bridge.obsidian_vault, "settings", return_value={"path": ""}):
        return {row["id"]: row for row in manager.health(studio)}


class VerdictTests(unittest.TestCase):
    def test_studio_proxy_answering_is_not_working_without_a_studio(self):
        row = health([FakeClient("roblox")], {"app": False, "place": False})["roblox"]
        self.assertEqual(row["state"], "waiting")
        self.assertIn("Assistant Settings", row["fix"])
        self.assertTrue(row["alive"], "the pipe really is up - which is why alive alone was never proof")

    def test_a_place_and_an_attached_studio_are_working(self):
        row = health([FakeClient("roblox")], {"app": True, "place": True})["roblox"]
        self.assertEqual(row["state"], "working")
        self.assertIsNone(row["fix"])

    def test_no_probe_from_an_older_caller_stops_at_the_pipe(self):
        row = health([FakeClient("roblox")])["roblox"]
        self.assertEqual(row["state"], "working", "with no Studio probe the primary is reported only as far as its pipe proves")

    def test_a_live_pipe_with_no_catalogue_is_starting(self):
        row = health([FakeClient("fetch", tools=())])["fetch"]
        self.assertEqual(row["state"], "starting")

    def test_a_crashed_server_keeps_its_reason(self):
        row = health([FakeClient("git", alive=False, error="ModuleNotFoundError: mcp_server_git")])["git"]
        self.assertEqual(row["state"], "failed")
        self.assertEqual(row["fix"], "ModuleNotFoundError: mcp_server_git")

    def test_an_offline_addon_names_the_step_that_fixes_it(self):
        row = health([FakeClient("blender", alive=False)])["blender"]
        self.assertEqual(row["state"], "offline")
        self.assertIn("headless Blender worker", row["fix"])
        self.assertNotIn("addon", row["fix"], "headless Blender never uses the desktop app's MCP addon")

    def test_headless_blender_is_only_working_when_blender_exists(self):
        clients = [FakeClient("blender", env={"BLENDER_EXECUTABLE": ""})]
        with patch.object(bridge, "_blender_preflight", return_value=(False, "Blender was not found.")):
            row = health(clients)["blender"]
        self.assertEqual(row["state"], "waiting")
        self.assertEqual(row["fix"], "Blender was not found.")
        with patch.object(bridge, "_blender_preflight", return_value=(True, None)):
            self.assertEqual(health(clients)["blender"]["state"], "working")

    def test_an_unreadable_preflight_is_not_reported_as_broken(self):
        with patch.dict("sys.modules", {"blender_headless": None}):
            self.assertEqual(bridge._blender_preflight(), (True, None))

    def test_pc_control_is_listed_even_at_zero_tools(self):
        rows = health([FakeClient("roblox")])
        self.assertIn("computer", rows, "an omitted row read as 'this build has no PC commands'")
        self.assertEqual(rows["computer"]["state"], "working")

    def test_a_down_pc_broker_carries_its_own_fix(self):
        manager = bridge.MCPManager()
        manager.clients = {}
        with patch.object(bridge.computer_tools, "status",
                          return_value={"state": "failed", "tools": 0, "lastError": "Computer access is off",
                                         "fix": "switch Computer access on"}), \
                patch.object(bridge.obsidian_vault, "settings", return_value={"path": ""}):
            rows = {row["id"]: row for row in manager.health()}
        self.assertEqual(rows["computer"]["state"], "failed")
        self.assertEqual(rows["computer"]["fix"], "switch Computer access on")

    def test_an_unconfigured_vault_is_not_listed_as_a_server(self):
        # health() only appends the obsidian row when a vault path is set, so an
        # unset vault cannot show up as a broken server the user never enabled.
        self.assertNotIn("obsidian", health([FakeClient("roblox")]))


if __name__ == "__main__":
    unittest.main()
