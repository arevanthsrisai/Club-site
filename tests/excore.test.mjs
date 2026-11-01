// Unit tests for the pure Ex-Core domain logic (src/lib/excore.ts) —
// batch labels, grouping/ordering and role-history sanitization.
import test from 'node:test';
import assert from 'node:assert';
import {
    normalizeYear, batchLabel, academicYearLabel, groupByBatchDesc,
    mergedBatchOrder, sanitizeRoleHistory,
    OWNER_EDITABLE_FIELDS, hasOnlyOwnerFields, containsPrivilegedField,
} from '../src/lib/excore.ts';

test('normalizeYear accepts academic-year integers and rejects junk', () => {
    assert.strictEqual(normalizeYear(2027), 2027);
    assert.strictEqual(normalizeYear('2027'), 2027);
    assert.strictEqual(normalizeYear('2027.5'), null);
    assert.strictEqual(normalizeYear(0), null);
    assert.strictEqual(normalizeYear(1999), null);
    assert.strictEqual(normalizeYear(2101), null);
    assert.strictEqual(normalizeYear(null), null);
    assert.strictEqual(normalizeYear('abc'), null);
});

test('batchLabel and academicYearLabel render the academic-year range', () => {
    assert.strictEqual(batchLabel(2027), '2027–28 Batch');
    assert.strictEqual(batchLabel('2026'), '2026–27 Batch');
    assert.strictEqual(academicYearLabel(2026), '2026–27');
    assert.strictEqual(batchLabel(2001), '2001–02 Batch');
    assert.strictEqual(batchLabel('nonsense'), 'Other');
    assert.strictEqual(academicYearLabel(12345), '—');
});

test('groupByBatchDesc sorts newest batch first', () => {
    const members = [
        { id: 'a', exCoreBatch: 2025, memberType: 'core', displayOrder: 0, name: 'A' },
        { id: 'b', exCoreBatch: 2027, memberType: 'core', displayOrder: 0, name: 'B' },
        { id: 'c', exCoreBatch: 2026, memberType: 'activator', displayOrder: 0, name: 'C' },
    ];
    const groups = groupByBatchDesc(members);
    assert.deepStrictEqual(groups.map(g => g.year), [2027, 2026, 2025]);
    assert.deepStrictEqual(groups.map(g => g.label), ['2027–28 Batch', '2026–27 Batch', '2025–26 Batch']);
});

test('groupByBatchDesc: custom displayOrder wins inside a batch, core before activators', () => {
    const members = [
        { id: 'z', exCoreBatch: 2027, memberType: 'core', displayOrder: 5, name: 'Zed' },
        { id: 'm', exCoreBatch: 2027, memberType: 'core', displayOrder: 1, name: 'Mia' },
        { id: 'k', exCoreBatch: 2027, memberType: 'activator', displayOrder: 0, name: 'Kit' },
    ];
    const [g] = groupByBatchDesc(members);
    assert.deepStrictEqual(g.core.map(m => m.id), ['m', 'z']); // displayOrder, not alphabetical
    assert.deepStrictEqual(g.activators.map(m => m.id), ['k']);
    assert.deepStrictEqual(mergedBatchOrder(g).map(m => m.id), ['k', 'm', 'z']);
});

test('groupByBatchDesc is stable for equal displayOrder (insertion order)', () => {
    const members = [
        { id: 'x', exCoreBatch: 2027, memberType: 'core', displayOrder: 3, name: 'X' },
        { id: 'y', exCoreBatch: 2027, memberType: 'core', displayOrder: 3, name: 'Y' },
    ];
    const [[g]] = [groupByBatchDesc(members)];
    assert.deepStrictEqual(g.core.map(m => m.id), ['x', 'y']);
});

test('malformed batches sink to the bottom of the page', () => {
    const members = [
        { id: 'bad', exCoreBatch: 'junk', memberType: 'core', displayOrder: 0, name: 'Bad' },
        { id: 'good', exCoreBatch: 2026, memberType: 'core', displayOrder: 0, name: 'Good' },
    ];
    const groups = groupByBatchDesc(members);
    const last = groups[groups.length - 1];
    assert.strictEqual(last.core.map(m => m.id)[0], 'bad', 'malformed batch renders last');
    assert.strictEqual(last.label, 'Other');
    assert.strictEqual(groups[0].core.map(m => m.id)[0], 'good');
});

test('sanitizeRoleHistory strips invalid entries, dedupes and sorts newest first', () => {
    const out = sanitizeRoleHistory([
        { year: 2026, role: 'CTO' },
        { year: '2026', role: 'cto' },               // case-insensitive dup → dropped
        { year: 2025, role: '' },                     // empty role → dropped
        { year: 'nothing', role: 'President' },      // bad year → dropped
        { year: 2027, role: 'President' },
        { role: 'Loner' },                            // missing year → dropped
    ]);
    assert.deepStrictEqual(out, [
        { year: 2027, role: 'President' },
        { year: 2026, role: 'CTO' },
    ]);
});

test('sanitizeRoleHistory returns null for empty/garbage input', () => {
    assert.strictEqual(sanitizeRoleHistory(null), null);
    assert.strictEqual(sanitizeRoleHistory([]), null);
    assert.strictEqual(sanitizeRoleHistory([{ year: 2026, role: '' }]), null);
    assert.strictEqual(sanitizeRoleHistory('nope'), null);
});

test('owner self-edit field whitelist behaves as designed', () => {
    assert.deepStrictEqual([...OWNER_EDITABLE_FIELDS], ['name', 'photoURL', 'bio', 'socials']);
    assert.strictEqual(hasOnlyOwnerFields({ name: 'x' }), true);
    assert.strictEqual(hasOnlyOwnerFields({ name: 'x', bio: 'y' }), true);
    assert.strictEqual(hasOnlyOwnerFields({}), false);
    assert.strictEqual(hasOnlyOwnerFields({ exCoreBatch: 2027 }), false);
    assert.strictEqual(containsPrivilegedField({ roleHistory: [] }), true);
    assert.strictEqual(containsPrivilegedField({ displayOrder: 1 }), true);
    assert.strictEqual(containsPrivilegedField({ bio: 'safe' }), false);
});
