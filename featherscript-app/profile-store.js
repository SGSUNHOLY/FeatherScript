// Local identities only. Legacy IDs and their data survive the account migration.
const crypto = require('node:crypto');
function migrate(source = {}, emptyData) {
  const legacy = Array.isArray(source.profiles) ? source.profiles : source.accounts || [];
  const profiles = legacy.map((profile) => ({
    id: profile.id, name: profile.name || 'Personal', avatar: profile.avatar || '', createdAt: profile.createdAt || Date.now(),
  }));
  if (!profiles.length) profiles.push({ id: crypto.randomUUID(), name: 'Personal', avatar: '', createdAt: Date.now() });
  const preferred = source.activeProfileId || source.session?.accountId;
  const activeProfileId = profiles.some((p) => p.id === preferred) ? preferred : profiles[0].id;
  const data = { ...(source.data || {}) };
  for (const profile of profiles) data[profile.id] ||= emptyData();
  return { version: 3, profiles, activeProfileId, data };
}
function current(store) { return store.profiles.find((p) => p.id === store.activeProfileId); }
function create(store, input, emptyData) {
  const name = String(input.name || '').trim();
  if (name.length < 2 || name.length > 40) throw Error('Choose a profile name between 2 and 40 characters.');
  if (store.profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw Error('A profile with that name already exists.');
  const profile = { id: crypto.randomUUID(), name, avatar: '', createdAt: Date.now() };
  store.profiles.push(profile);
  store.activeProfileId = profile.id;
  store.data[profile.id] = emptyData();
  return profile;
}
function select(store, id) {
  const profile = store.profiles.find((p) => p.id === id);
  if (!profile) throw Error('That local profile is unavailable.');
  store.activeProfileId = id;
  return profile;
}
module.exports = { migrate, current, create, select };

module.exports.remove = function remove(store,id) {
  if(store.profiles.length < 2)throw Error('Keep at least one local profile.');
  if(!store.profiles.some(profile => profile.id === id))throw Error('Profile unavailable.');
  store.profiles = store.profiles.filter(profile => profile.id !== id); delete store.data[id];
  if(store.activeProfileId === id)store.activeProfileId = store.profiles[0].id;
  return module.exports.current(store);
};
