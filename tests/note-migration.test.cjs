const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function kgeuMigrateLegacyNotesForActiveGroup()');
const end = html.indexOf('\nfunction kgeuGetNote(subject)', start);
assert.notEqual(start, -1, 'migration helper must exist in index.html');
assert.notEqual(end, -1, 'migration helper must end before kgeuGetNote');
const migrationSource = html.slice(start, end);

function makeHarness(initialData, options = {}) {
  const storage = new Map();
  let personalData = JSON.parse(JSON.stringify(initialData));
  const context = {
    activeGroupId: 123,
    get kgeuPersonalData() { return personalData; },
    set kgeuPersonalData(value) { personalData = value; },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) {
        if (options.failBackup && key === 'kgeu_vk_notes_migration_backup_v1') {
          throw new Error('simulated backup write failure');
        }
        storage.set(key, String(value));
      }
    },
    kgeuSavePersonalData(data) {
      if (options.failSave) return false;
      try {
        context.localStorage.setItem('kgeu_vk_personal_data_v1', JSON.stringify(data));
        return true;
      } catch {
        return false;
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(migrationSource + '\nglobalThis.runMigration = kgeuMigrateLegacyNotesForActiveGroup;', context);
  return {
    run: () => context.runMigration(),
    get data() { return context.kgeuPersonalData; },
    storage
  };
}

test('migration backs up legacy notes and preserves scoped values', () => {
  const initial = { version: 1, notes: {
    mathematics: 'legacy note',
    'group:123::mathematics': 'scoped note wins',
    'group:456::mathematics': 'other group note'
  }};
  const h = makeHarness(initial);
  assert.equal(h.run(), true);
  assert.equal(h.data.notes['group:123::mathematics'], 'scoped note wins');
  assert.equal(h.data.notes['group:456::mathematics'], 'other group note');
  assert.equal(Object.hasOwn(h.data.notes, 'mathematics'), false);
  assert.deepEqual(
    JSON.parse(h.storage.get('kgeu_vk_notes_migration_backup_v1')),
    initial
  );
  assert.equal(h.run(), false, 'second migration is a no-op');
});

test('failed save restores the original in-memory notes', () => {
  const initial = { version: 1, notes: { mathematics: 'recover me' } };
  const h = makeHarness(initial, { failSave: true });
  assert.equal(h.run(), false);
  assert.equal(JSON.stringify(h.data), JSON.stringify(initial));
  assert.deepEqual(
    JSON.parse(h.storage.get('kgeu_vk_notes_migration_backup_v1')),
    initial
  );
});

test('failed backup leaves notes untouched', () => {
  const initial = { version: 1, notes: { mathematics: 'do not lose me' } };
  const h = makeHarness(initial, { failBackup: true });
  assert.equal(h.run(), false);
  assert.deepEqual(h.data, initial);
  assert.equal(h.storage.has('kgeu_vk_notes_migration_backup_v1'), false);
});
