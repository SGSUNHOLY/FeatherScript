"""Tool pack coverage: complete schemas, bounded payloads, and official Luau compilation."""
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import feather_tools as ft
import computer_tools as pc
import roblox_workflows as workflows


def sample(schema, key):
    if 'enum' in schema:return schema['enum'][0]
    kinds=schema['type'];kind=kinds[0] if isinstance(kinds,list) else kinds
    if kind=='string':return '#112233' if 'pattern' in schema else ('Fixture' if key in ('name','tag','attribute','prefix','suffix') else 'game.Workspace.Fixture')
    if kind=='boolean':return True
    if kind in ('number','integer'):return max(1,schema.get('minimum',1))
    if kind=='array':return [sample(schema['items'],key) for _ in range(schema.get('minItems',1))]
    raise AssertionError(kind)


def arguments(definition):
    return {key:sample(definition['properties'][key],key) for key in definition['required']}


class ExpandedToolsTests(unittest.TestCase):
    def test_exact_inventory_and_no_duplicate_aliases(self):
        native=ft.tool_defs()
        self.assertEqual(len(native),46)
        self.assertEqual(len(pc.TOOLS),21)
        self.assertEqual(len(native)+len(pc.TOOLS),67)
        self.assertEqual(len({t['name'] for t in native+pc.TOOLS}),67)
        self.assertEqual(len(workflows.DEFINITIONS),130)
        for tool in native+pc.TOOLS:
            self.assertIsInstance(tool['description'],str)
            self.assertTrue(tool['description'].strip())
            self.assertIsInstance(tool['inputSchema']['properties'],dict)
            for field in tool['inputSchema'].get('required',[]):self.assertIn(field,tool['inputSchema']['properties'])

    def test_memory_updates_need_no_exact_match_and_stay_data(self):
        def transport(name, args, timeout):
            return {'text': json.dumps({'ok': True, 'data': {'exists': True, 'class': 'ModuleScript', 'characters': 7, 'memory': '-- verified fact'}})}
        read = ft.call('feather_memory', {'action': 'read'}, transport, 30)
        self.assertIn('-- verified fact', read['text'])
        self.assertIn('ServerStorage.FeatherScript.Memory', read['text'])
        sent = []
        def capture(name, args, timeout):
            sent.append(args['code'])
            return {'text': json.dumps({'ok': True, 'data': {'characters': 3}})}
        ft.call('feather_memory', {'action': 'append', 'heading': 'Shop', 'content': 'a");workspace:ClearAllChildren();--'}, capture, 30)
        code = sent[-1]
        self.assertNotIn('{{', code)
        self.assertIn('\\"', code)          # the payload is a quoted literal, never code
        self.assertIn('Instance.new("ModuleScript")', code)  # created on first write
        self.assertNotIn('old_string', json.dumps([t for t in ft.tool_defs() if t['name'] == 'feather_memory']))

    def test_memory_arguments_are_validated_before_studio(self):
        sent = []
        def transport(name, args, timeout):
            sent.append(args)
            return {'text': '{"ok":true,"data":{}}'}
        for args in [{'action': 'replace'}, {'action': 'append'}, {'action': 'write', 'content': 'x' * 6001},
                     {'action': 'append', 'content': 'fact', 'heading': 'y' * 200}]:
            with self.assertRaises(ft.NativeError): ft.call('feather_memory', args, transport, 30)
        self.assertEqual(sent, [])

    def test_every_workflow_dispatches_on_real_transport_shape(self):
        for definition in workflows.DEFINITIONS:
            sent=[]
            def transport(name,args,timeout):
                sent.append((name,args,timeout))
                return {'text':json.dumps({'ok':True,'data':{'fixture':True}})}
            result=ft.call(definition['name'],arguments(definition),transport,30)
            self.assertTrue(json.loads(result['text'])['fixture'],definition['name'])
            self.assertEqual(len(sent),1,definition['name'])
            self.assertEqual(sent[0][0],'execute_luau')
            self.assertEqual(sent[0][1]['datamodel_type'],'Edit')
            self.assertNotIn('{{',sent[0][1]['code'])
            self.assertLess(len(sent[0][1]['code']),20000)

    def test_runtime_datamodel_is_explicit(self):
        sent=[]
        ft.call('rbx_get_network_ownership',{'datamodel':'Server'},lambda name,args,timeout:sent.append(args) or {'text':'{"ok":true,"data":[]}'},30)
        self.assertEqual(sent[0]['datamodel_type'],'Server')

    def test_invalid_arguments_never_reach_studio(self):
        def forbidden(*args):raise AssertionError('Invalid call reached Studio')
        for args in [{'paths':[],'value':.5},{'paths':['game.Workspace.X'],'value':float('nan')},{'paths':['game.Workspace.X'],'value':2},{'paths':['game.Workspace.X'],'value':True},{'paths':['game.Workspace.X'],'value':.5,'unexpected':True}]:
            with self.assertRaises(ft.NativeError):ft.call('rbx_batch_set_transparency',args,forbidden,30)
        with self.assertRaises(ft.NativeError):ft.call('rbx_create_text_button',{},forbidden,30)
        with self.assertRaises(ft.NativeError):ft.call('rbx_get_camera_state',{'datamodel':'Everything'},forbidden,30)

    def test_engine_errors_are_not_reported_as_success(self):
        with self.assertRaisesRegex(ft.NativeError,'No current camera'):
            ft.call('rbx_get_camera_state',{},lambda *args:{'text':'{"ok":false,"error":"No current camera"}'},30)

    @unittest.skipUnless(os.environ.get('FS_TEST_LUAU'),'Set FS_TEST_LUAU to an official luau-compile binary for syntax coverage')
    def test_all_130_programs_compile(self):
        with tempfile.TemporaryDirectory(prefix='fs-luau-tools-') as folder:
            files=[]
            for definition in workflows.DEFINITIONS:
                def transport(name,args,timeout):
                    target=Path(folder)/(definition['name']+'.luau')
                    target.write_text(args['code'],encoding='utf-8')
                    files.append(str(target))
                    return {'text':'{"ok":true,"data":{}}'}
                ft.call(definition['name'],arguments(definition),transport,30)
            # A malicious-looking value is still a quoted string, not executable code.
            def escaped(name,args,timeout):
                target=Path(folder)/'quoted-input.luau';target.write_text(args['code'],encoding='utf-8');files.append(str(target));return {'text':'{"ok":true,"data":{}}'}
            ft.call('rbx_batch_add_tag',{'paths':['game.Workspace.X'],'tag':'a");workspace:ClearAllChildren();--'},escaped,30)
            result=subprocess.run([os.environ['FS_TEST_LUAU'],'--null',*files],capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertEqual(len(files),131)

if __name__=='__main__':unittest.main()
