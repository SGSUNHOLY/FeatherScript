"""Grouped calls preserve original validation, transport, and permission identity."""
import json
import unittest
from unittest.mock import patch
import computer_tools as pc
import feather_tools as ft
from tests.test_expanded_tools import arguments
import roblox_workflows as workflows


class GroupedToolsTests(unittest.TestCase):
    def test_all_roblox_operations_use_the_same_transport(self):
        for definition in workflows.DEFINITIONS:
            group, action = ft._workflow_group(definition['name'])
            args = arguments(definition)
            legacy, grouped = [], []
            def transport(records):
                def send(name, params, timeout):
                    records.append((name, params, timeout))
                    return {'text': '{"ok":true,"data":{"fixture":true}}'}
                return send
            ft.call(definition['name'], args, transport(legacy), 30)
            result = ft.call(group, {'action': action, 'params': args}, transport(grouped), 30)
            self.assertEqual(grouped, legacy, definition['name'])
            self.assertTrue(json.loads(result['text'])['fixture'])

    def test_schema_lookup_does_not_execute_or_mutate(self):
        def forbidden(*_):
            self.fail('Schema lookup touched Studio')
        response = ft.call('rbx_workflow_schema', {'tool': 'rbx_create_object', 'action': 'point_light'}, forbidden, 30)
        description = json.loads(response['text'])
        self.assertEqual(description['name'], 'rbx_create_point_light')
        self.assertIn('parent', description['inputSchema']['properties'])
        description['inputSchema']['properties'].clear()
        self.assertIn('parent', ft._WORKFLOW_GROUPS.describe({'tool': 'rbx_create_object', 'action': 'point_light'})['inputSchema']['properties'])

    def test_invalid_groups_and_parameters_cannot_dispatch(self):
        sent = []
        for name, args in [
            ('rbx_get_inventory', {'action': 'delete_instance'}),
            ('rbx_edit_batch', {'action': 'set_color', 'params': []}),
            ('rbx_edit_batch', {'action': 'set_color', 'params': {'paths': ['game.X'], 'color': 'bad'}}),
            ('rbx_get_inventory', {'action': 'camera_state', 'unexpected': True}),
            ('rbx_workflow_schema', {'tool': 'rbx_get_inventory', 'action': 'missing'}),
        ]:
            with self.assertRaises(ft.NativeError):
                ft.call(name, args, lambda *a: sent.append(a), 30)
        self.assertEqual(sent, [])

    def test_all_pc_actions_reach_broker_as_the_original_tool(self):
        token = pc.CLIENT_ORIGIN.set('chrome-extension://fixture')
        try:
            with patch.object(pc, 'request', return_value={'ok': True, 'result': {'fixture': True}}) as request:
                for group, actions in pc._OPERATION_GROUPS.routes.items():
                    for action, actual in actions.items():
                        params = {'fixture': 'broker must validate actual parameters'}
                        pc.call(group, {'action': action, 'params': params}, 12)
                        route, payload = request.call_args.args
                        self.assertEqual(route, '/call')
                        self.assertEqual(payload, {'tool': actual, 'arguments': params, 'origin': 'chrome-extension://fixture'})
                        self.assertEqual(request.call_args.kwargs['timeout'], 12)
        finally:
            pc.CLIENT_ORIGIN.reset(token)

    def test_pc_denial_and_unknown_actions_stay_denied(self):
        with patch.object(pc, 'request', return_value={'ok': False, 'error': 'Permission denied'}) as request:
            with self.assertRaisesRegex(RuntimeError, 'Permission denied'):
                pc.call('pc_file_operations', {'action': 'replace_text', 'params': {'path': 'C:/fixture'}})
            self.assertEqual(request.call_args.args[1]['tool'], 'pc_replace_text')
            request.reset_mock()
            for args in [{'action': 'run_program'}, {'action': 'file_hash', 'params': []}, {'action': 'file_hash', 'extra': 1}]:
                with self.assertRaises(ValueError):
                    pc.call('pc_file_operations', args)
            request.assert_not_called()

    def test_catalogue_is_small_and_omits_the_old_wrappers(self):
        catalogue = ft.tool_defs() + pc.TOOLS
        self.assertEqual(len(catalogue), 67)
        names = {tool['name'] for tool in catalogue}
        self.assertNotIn('rbx_create_part_block', names)
        self.assertNotIn('pc_json_format', names)
        self.assertIn('create_part', names)
        self.assertIn('set_properties', names)
        self.assertIn('pc_read_file', names)
        self.assertLess(len(json.dumps(catalogue).encode()), 40000)
