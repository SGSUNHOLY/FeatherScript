import asyncio
import json
import unittest
from unittest.mock import patch
import bridge
from command_journal import Journal


class Process:
    def poll(self):return None


class Socket:
    remote_address=('127.0.0.1',)
    request_headers={'Origin':'chrome-extension://'+'a'*32}
    def __init__(self,messages,results):self.messages=messages;self.sent=[];self.results=results
    async def send(self,message):self.sent.append(json.loads(message))
    def __aiter__(self):return self.iterate()
    async def iterate(self):
        for message in self.messages:yield json.dumps(message)
        until=asyncio.get_running_loop().time()+2
        while len([item for item in self.sent if item['type']=='tool_result'])<self.results and asyncio.get_running_loop().time()<until:await asyncio.sleep(.01)


class CommandBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_handler_ack_correlation_and_deduplication(self):
        journal=Journal();ws=Socket([
            {'type':'call_tool','id':1,'command_id':'cmd-test','name':'write','arguments':{'a':1}},
            {'type':'call_tool','id':2,'command_id':'cmd-test','name':'write','arguments':{'a':1}},
        ],2)
        with patch.object(bridge,'command_journal',journal),patch.object(bridge,'_status_payload',return_value={'type':'connected'}),patch.object(bridge,'clients',set()),patch.object(bridge,'log'),patch.object(bridge.mgr,'call',return_value={'text':'once'}) as execute:
            await bridge.handler(ws)
        execute.assert_called_once()
        self.assertEqual(len([item for item in ws.sent if item['type']=='call_ack']),2)
        results=[item for item in ws.sent if item['type']=='tool_result']
        self.assertEqual({item['id'] for item in results},{1,2})
        self.assertTrue(all(item['command_id']=='cmd-test' and item['ok'] for item in results))

    async def test_cancel_before_dispatch_is_not_overwritten(self):
        journal=Journal();ws=Socket([
            {'type':'cancel_command','id':1,'command_id':'cmd-cancel'},
            {'type':'call_tool','id':2,'command_id':'cmd-cancel','name':'write','arguments':{}},
        ],1)
        with patch.object(bridge,'command_journal',journal),patch.object(bridge,'_status_payload',return_value={'type':'connected'}),patch.object(bridge,'clients',set()),patch.object(bridge,'log'),patch.object(bridge.mgr,'call') as execute:
            await bridge.handler(ws)
        execute.assert_not_called()
        result=next(item for item in ws.sent if item['type']=='tool_result')
        self.assertEqual(result['kind'],'cancelled')

    async def test_changed_bridge_identity_refuses_execution(self):
        ws=Socket([{'type':'call_tool','id':1,'command_id':'cmd-old','bridge_id':'previous-process','name':'write','arguments':{}}],1)
        with patch.object(bridge,'_status_payload',return_value={'type':'connected'}),patch.object(bridge,'clients',set()),patch.object(bridge,'log'),patch.object(bridge.mgr,'call') as execute:
            await bridge.handler(ws)
        execute.assert_not_called()
        self.assertEqual(next(item for item in ws.sent if item['type']=='tool_result')['kind'],'indeterminate')

    def test_written_unanswered_tool_is_not_replayed(self):
        client=bridge.MCPClient('test','unused',[],{});client.proc=Process()
        with patch.object(client,'_request',return_value=None) as request,patch.object(client,'restart') as restart:
            with self.assertRaises(bridge.ToolIndeterminate):client.call_tool('write',{},1)
        request.assert_called_once();restart.assert_not_called()

    def test_transient_retry_requires_explicit_non_execution(self):
        self.assertTrue(bridge._looks_like_transient_studio_drop('Unable to find an active Studio instance'))
        self.assertFalse(bridge._looks_like_transient_studio_drop('Studio instance connected; edits applied'))
        self.assertFalse(bridge._looks_like_transient_studio_drop('Not connected to another service after applying edits'))

    def test_indeterminate_error_metadata(self):
        with patch.object(bridge.mgr,'call',side_effect=bridge.ToolIndeterminate('unknown')):
            result=bridge.safe_call('write',{},1)
        self.assertEqual(result['kind'],'indeterminate');self.assertTrue(result['may_have_executed']);self.assertFalse(result['retryable'])

    def test_unwritten_request_can_retry_once(self):
        client=bridge.MCPClient('test','unused',[],{});client.proc=Process()
        result={'result':{'content':[{'type':'text','text':'ok'}]}}
        with patch.object(client,'_request',side_effect=[bridge.ToolNotWritten('not sent'),result]) as request,patch.object(client,'restart') as restart:
            self.assertEqual(client.call_tool('write',{},1)['text'],'ok')
        self.assertEqual(request.call_count,2);restart.assert_called_once()

    def test_studio_tool_module_path_is_translated(self):
        raw='sabuiltin_Assistant.rbxm.Assistant.Packages._Index.AssistantUI.AssistantUI.Tools'
        self.assertTrue(bridge._looks_like_studio_tool_module(raw))
        self.assertFalse(bridge._looks_like_studio_tool_module('Edit datamodel is not available in Play mode'))
        self.assertFalse(bridge._looks_like_studio_tool_module('Modified Fx (ModuleScript) with 3 edits applied'))

    def test_studio_tool_module_failure_retries_once_then_explains(self):
        raw='sabuiltin_Assistant.rbxm.Assistant.Packages._Index.AssistantUI.AssistantUI.Tools'
        fail={'result':{'isError':True,'content':[{'type':'text','text':raw}]}}
        ok={'result':{'content':[{'type':'text','text':'applied'}]}}
        client=bridge.MCPClient('test','unused',[],{});client.proc=Process()
        with patch.object(client,'_request',side_effect=[fail,ok]) as request,patch.object(client,'restart'),patch.object(bridge.time,'sleep'),patch.object(bridge,'log'):
            self.assertEqual(client.call_tool('multi_edit',{},1)['text'],'applied')
        self.assertEqual(request.call_count,2)
        with patch.object(client,'_request',return_value=fail) as request,patch.object(client,'restart'),patch.object(bridge.time,'sleep'),patch.object(bridge,'log'):
            with self.assertRaises(RuntimeError) as caught:client.call_tool('multi_edit',{},1)
        message=str(caught.exception)
        self.assertIn('Assistant tool module was not loaded',message)
        self.assertNotIn('sabuiltin',message)
        self.assertEqual(request.call_count,2)

if __name__=='__main__':unittest.main()
