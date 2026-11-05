"""Process-local at-most-once tool dispatch. Unknown outcomes are never replayed."""
import asyncio
import hashlib
import json
import uuid


class Journal:
    def __init__(self, maximum=10000, payload_limit=32_000_000):
        self.identity = str(uuid.uuid4())
        self.entries = {}
        self.maximum = maximum
        self.payload_limit = payload_limit
        self.payload_bytes = 0

    def reserve(self, command_id, name, arguments):
        fingerprint = hashlib.sha256(json.dumps([name, arguments], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        entry = self.entries.get(command_id)
        if entry:
            if entry['state']=='cancelled' and entry['fingerprint'] is None:
                return entry
            if entry['fingerprint'] != fingerprint:
                raise ValueError('Command ID was reused with different arguments; execution refused.')
            return entry
        if len(self.entries) >= self.maximum:
            raise ValueError('Command journal is full. Save your work and restart the bridge before starting new tasks.')
        entry = {'fingerprint': fingerprint, 'name': name, 'state': 'queued', 'result': None, 'task': None, 'late_result': None, 'size': 0}
        self.entries[command_id] = entry
        return entry

    def status(self, command_id):
        entry = self.entries.get(command_id)
        if not entry:
            return {'state': 'unknown', 'may_have_executed': True}
        return {'state': entry['state'], 'result': entry['result'], 'may_have_executed': entry['state'] not in ('queued', 'rejected'), 'has_late_result': entry['late_result'] is not None}

    def cancel(self, command_id):
        entry = self.entries.get(command_id)
        if not entry:
            # A pre-start cancellation is a tombstone; it cannot later become running.
            if len(self.entries) >= self.maximum:
                return self.status(command_id)
            self.entries[command_id] = {'fingerprint': None, 'name': '', 'state': 'cancelled', 'result': self.cancelled(False), 'task': None, 'late_result': None, 'size': 0}
        elif entry['state'] in ('queued', 'running'):
            executed = entry['state'] == 'running'
            entry['state'] = 'cancelled'
            entry['result'] = self.cancelled(executed)
        return self.status(command_id)

    @staticmethod
    def cancelled(executed=True):
        return {'ok': False, 'kind': 'cancelled', 'stage': 'cancellation', 'may_have_executed': executed, 'retryable': False, 'error': 'Cancellation requested. It is not a rollback; inspect actual state before repeating edits.'}

    def keep(self, entry, result, late=False):
        size = len(json.dumps(result))
        for old in self.entries.values():
            if self.payload_bytes + size <= self.payload_limit:
                break
            if old is not entry and old['task'] is None:
                self.payload_bytes -= old['size']; old['size'] = 0
                old['result'] = None; old['late_result'] = None
        if size <= self.payload_limit and self.payload_bytes + size <= self.payload_limit:
            entry['late_result' if late else 'result'] = result
            entry['size'] += size; self.payload_bytes += size

    async def execute(self, command_id, operation):
        entry = self.entries[command_id]
        if entry['state'] == 'cancelled':
            return entry['result'] or self.cancelled()
        if entry['task'] is not None:
            return await asyncio.shield(entry['task'])
        if entry['state'] != 'queued':
            return entry['result'] or {'ok': False, 'kind': 'indeterminate', 'may_have_executed': True, 'retryable': False, 'error': 'This command already ran, but its cached result expired. Inspect state; do not replay it.'}

        async def run():
            if entry['state'] == 'cancelled':
                return entry['result']
            entry['state'] = 'running'
            try:
                result = await operation()
            except Exception as error:
                result = {'ok': False, 'kind': 'indeterminate', 'stage': 'execution', 'may_have_executed': True, 'retryable': False, 'error': str(error)}
            if entry['state'] == 'cancelled':
                self.keep(entry, result, late=True)
                return entry['result'] or self.cancelled()
            entry['state'] = 'completed' if result.get('ok') else result.get('kind') if result.get('kind') in ('timed_out','indeterminate','unacknowledged') else 'failed'
            self.keep(entry, result)
            return result

        entry['task'] = asyncio.create_task(run())
        try:
            return await asyncio.shield(entry['task'])
        finally:
            if entry['task'] and entry['task'].done():
                entry['task'] = None
