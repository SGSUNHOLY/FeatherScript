const assert = require('node:assert/strict');
const profiles = require('./profile-store');
const empty = () => ({ memory: '', notes: [], settings: { theme: 'default', customPrompt: '' } });
const original = {
  version: 1,
  accounts: [{ id: 'old-a', name: 'Builder', email: 'old@example.test', salt: 'old-salt', hash: 'old-hash', avatar: 'avatar', createdAt: 12 }, { id: 'old-b', name: 'Writer' }],
  session: { accountId: 'old-a' },
  data: { 'old-a': { memory: 'Keep this memory', notes: [{ id: 'note', text: 'Keep this note' }], settings: { theme: 'purple', customPrompt: 'Keep this prompt' } } },
};
const store = profiles.migrate(original, empty);
assert.equal(store.activeProfileId, 'old-a');
assert.deepEqual(store.data['old-a'], original.data['old-a']);
assert.equal(store.profiles[0].avatar, 'avatar');
assert.equal(store.accounts, undefined);
assert.equal(store.profiles[0].hash, undefined);
assert.equal(store.profiles[0].email, undefined);
const next = profiles.create(store, { name: 'Personal' }, empty);
assert.equal(profiles.current(store).id, next.id);
assert.deepEqual(store.data[next.id], empty());
assert.throws(() => profiles.create(store, { name: 'personal' }, empty));
profiles.select(store, 'old-a');
assert.equal(profiles.current(store).name, 'Builder');
assert.equal(store.data['old-a'].memory, 'Keep this memory');
assert.throws(() => profiles.select(store, 'missing'));
assert.deepEqual(profiles.migrate(store, empty), store);
const fresh = profiles.migrate({}, empty);
assert.equal(profiles.current(fresh).name, 'Personal');
console.log('PASS account migration, data preservation, credential removal, local profile creation, isolation and selection');
