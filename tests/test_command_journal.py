import asyncio
import unittest
from command_journal import Journal


class JournalTests(unittest.IsolatedAsyncioTestCase):
    async def test_replay_and_canonical_arguments(self):
        journal=Journal();calls=0
        async def operation():
            nonlocal calls
            calls+=1
            return {'ok':True,'text':'executed'}
        journal.reserve('a','write',{'b':2,'a':1})
        first=await journal.execute('a',operation)
        journal.reserve('a','write',{'a':1,'b':2})
        self.assertEqual(await journal.execute('a',operation),first)
        self.assertEqual(calls,1)
        with self.assertRaises(ValueError):journal.reserve('a','write',{'a':99})

    async def test_join_and_interleaved_calls(self):
        journal=Journal();event=asyncio.Event();calls=0
        async def slow():
            nonlocal calls
            calls+=1;await event.wait();return {'ok':True,'text':'slow'}
        async def fast():return {'ok':True,'text':'fast'}
        journal.reserve('a','slow',{});journal.reserve('b','fast',{})
        first=asyncio.create_task(journal.execute('a',slow));await asyncio.sleep(0)
        duplicate=asyncio.create_task(journal.execute('a',slow))
        self.assertEqual((await journal.execute('b',fast))['text'],'fast')
        event.set();self.assertEqual(await first,await duplicate);self.assertEqual(calls,1)

    async def test_cancel_before_start(self):
        journal=Journal();journal.cancel('a');journal.reserve('a','write',{})
        async def forbidden():self.fail('pre-cancelled command executed')
        result=await journal.execute('a',forbidden);self.assertEqual(result['kind'],'cancelled')

    async def test_cancel_preserves_late_result(self):
        journal=Journal();journal.reserve('a','write',{});event=asyncio.Event()
        async def operation():await event.wait();return {'ok':True,'text':'late'}
        task=asyncio.create_task(journal.execute('a',operation));await asyncio.sleep(0);await asyncio.sleep(0)
        journal.cancel('a');event.set();result=await task
        self.assertEqual(result['kind'],'cancelled');self.assertEqual(journal.status('a')['state'],'cancelled');self.assertTrue(journal.status('a')['has_late_result'])

    async def test_bounded_cache_does_not_allow_reexecution(self):
        journal=Journal(maximum=2,payload_limit=100)
        async def operation():return {'ok':True,'text':'x'*101}
        journal.reserve('a','write',{});await journal.execute('a',operation)
        replay=await journal.execute('a',operation);self.assertEqual(replay['kind'],'indeterminate')
        journal.reserve('b','write',{})
        with self.assertRaises(ValueError):journal.reserve('c','write',{})

if __name__=='__main__':unittest.main()
