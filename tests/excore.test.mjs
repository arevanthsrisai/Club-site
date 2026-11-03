// Unit tests for the pure Ex-Core domain logic (src/lib/excore.ts) —
// academic-year labels, tenure/year grouping and role-history sanitization.
// Tenure model: role-history entries carry { startYear, endYear, role };
// legacy { year } entries and exCoreBatch fallbacks must keep displaying.
import test from 'node:test';
import assert from 'node:assert';
import {
    normalizeYear, academicYearLabel, tenureLabel,
    groupByTenureYearDesc, YEARLESS, memberTenureYears, globalDisplayOrder,
    normalizeRoleEntry, sanitizeRoleHistory,
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

test('academicYearLabel renders the academic-year range', () => {
    assert.strictEqual(academicYearLabel(2026), '2026–27');
    assert.strictEqual(academicYearLabel('2027'), '2027–28');
    assert.strictEqual(academicYearLabel(12345), '—');
});

test('tenureLabel collapses a one-year tenure and spans a two-year one', () => {
    assert.strictEqual(tenureLabel(2026, 2027), '2026–27'); // one batch: 2026–27
    assert.strictEqual(tenureLabel(2026, 2028), '2026–28'); // two batches: 2026–27 + 2027–28
    assert.strictEqual(tenureLabel(2026, 2025), '—'); // end <= start → invalid
    assert.strictEqual(tenureLabel('junk', 2026), '—');
});

test('normalizeRoleEntry handles both the tenure and legacy shapes', () => {
    assert.deepStrictEqual(normalizeRoleEntry({ startYear: 2026, endYear: 2027, role: 'CTO' }),
        { startYear: 2026, endYear: 2027, role: 'CTO' });
    assert.deepStrictEqual(normalizeRoleEntry({ year: 2026, role: 'CTO' }), // legacy → one-year tenure (exclusive end)
        { startYear: 2026, endYear: 2027, role: 'CTO' });
    assert.strictEqual(normalizeRoleEntry({ startYear: 2026, endYear: 2027, role: '  ' }), null);
    assert.deepStrictEqual(normalizeRoleEntry({ startYear: 2026, endYear: 2026, role: 'CTO' }),
        { startYear: 2026, endYear: 2027, role: 'CTO' }); // same start/end → one-year tenure, not deleted
    assert.deepStrictEqual(normalizeRoleEntry({ startYear: 2025, endYear: 2024, role: 'CTO' }),
        { startYear: 2024, endYear: 2025, role: 'CTO' }); // years typed backwards → swapped, not deleted
    assert.strictEqual(normalizeRoleEntry({ role: 'CTO' }), null); // no year at all
    assert.strictEqual(normalizeRoleEntry(2026), null);
});

test('sanitizeRoleHistory strips invalid entries, normalizes legacy, dedupes and sorts newest first', () => {
    const out = sanitizeRoleHistory([
        { startYear: 2026, endYear: 2027, role: 'CTO' },
        { startYear: 2026, endYear: 2027, role: 'CTO' }, // exact duplicate range+role → dropped
        { startYear: 2026, endYear: 2026, role: '' }, // end not > start → dropped
        { startYear: 'nothing', endYear: 2026, role: 'President' }, // bad year → dropped
        { startYear: 2027, endYear: 2028, role: 'President' },
        { role: 'Loner' },                            // missing year → dropped
    ]);
    assert.deepStrictEqual(out, [
        { startYear: 2027, endYear: 2028, role: 'President' },
        { startYear: 2026, endYear: 2027, role: 'CTO' },
    ]);
});

test('a legacy one-year entry dedupes against an identical two-year entry on the same start year', () => {
    // Legacy { year: 2026 } normalizes to a ONE-year tenure { startYear: 2026, endYear: 2027 },
    // so it is deduped against an identical entry rather than kept separately.
    const out = sanitizeRoleHistory([
        { startYear: 2026, endYear: 2027, role: 'CTO' },
        { year: 2026, role: 'CTO' }, // same one-year range → dropped as exact duplicate
    ]);
    assert.deepStrictEqual(out, [
        { startYear: 2026, endYear: 2027, role: 'CTO' },
    ]);
});

test('sanitizeRoleHistory returns null for empty/garbage input', () => {
    assert.strictEqual(sanitizeRoleHistory(null), null);
    assert.strictEqual(sanitizeRoleHistory([]), null);
    assert.strictEqual(sanitizeRoleHistory([{ startYear: 2026, endYear: 2026, role: '' }]), null);
    assert.strictEqual(sanitizeRoleHistory('nope'), null);
});

test('memberTenureYears expands a two-year entry to BOTH years', () => {
    const m = { id: 'x', name: 'X', memberType: 'core', displayOrder: 0,
        roleHistory: [{ startYear: 2026, endYear: 2028, role: 'CTO' }] };
    assert.deepStrictEqual(memberTenureYears(m), [2027, 2026]);
});

test('memberTenureYears falls back to the legacy exCoreBatch when there is no history', () => {
    const m = { id: 'x', name: 'X', memberType: 'core', displayOrder: 0, roleHistory: [], exCoreBatch: 2025 };
    assert.deepStrictEqual(memberTenureYears(m), [2025]);
    const nothing = { id: 'y', name: 'Y', memberType: 'activator', displayOrder: 0, roleHistory: [] };
    assert.deepStrictEqual(memberTenureYears(nothing), []);
});

test('groupByTenureYearDesc: an exclusive-end member appears in each covered year section', () => {
    const members = [
        { id: 'two', name: 'Two Year', memberType: 'core', displayOrder: 0,
            roleHistory: [{ startYear: 2026, endYear: 2028, role: 'President' }] },
        { id: 'one', name: 'One Year', memberType: 'core', displayOrder: 1,
            roleHistory: [{ startYear: 2025, endYear: 2026, role: 'CTO' }] },
    ];
    const groups = groupByTenureYearDesc(members);
    assert.deepStrictEqual(groups.map(g => g.year), [2027, 2026, 2025]);
    assert.deepStrictEqual(groups.map(g => g.label), ['2027–28', '2026–27', '2025–26']);

    // The two-year member (2026→2028) shows up in both 2026 and 2027.
    const in2027 = groups[0].core.map(m => m.id);
    const in2026 = groups[1].core.map(m => m.id);
    assert.deepStrictEqual(in2027, ['two']);
    assert.deepStrictEqual(in2026, ['two']);

    // Same profile id everywhere — the modal always opens the same record.
    assert.strictEqual(in2027.length, 1);
    assert.strictEqual(in2026.length, 1);
    assert.deepStrictEqual(groups[0].core[0], groups[1].core[0]);
});

test('groupByTenureYearDesc sorts newest first, keeps display order inside a year, splits core/activators', () => {
    const members = [
        { id: 'z', name: 'Zed', memberType: 'core', displayOrder: 5,
            roleHistory: [{ startYear: 2027, endYear: 2028, role: 'CTO' }] },
        { id: 'm', name: 'Mia', memberType: 'core', displayOrder: 1,
            roleHistory: [{ startYear: 2027, endYear: 2028, role: 'President' }] },
        { id: 'k', name: 'Kit', memberType: 'activator', displayOrder: 0,
            roleHistory: [{ startYear: 2026, endYear: 2027, role: 'Activator' }] },
        { id: 'old', name: 'Old Batch', memberType: 'core', displayOrder: 0,
            roleHistory: [], exCoreBatch: 2025 }, // legacy fallback year
    ];
    const groups = groupByTenureYearDesc(members);
    assert.deepStrictEqual(groups.map(g => g.year), [2027, 2026, 2025]);
    // z and m both cover 2027 (z: 2027→2028, m: 2027→2028)
    assert.deepStrictEqual(groups[0].core.map(m => m.id), ['m', 'z']); // displayOrder wins, not alphabetical
    // k covers year 2026 only (2026→2027 = one batch: 2026–27)
    assert.deepStrictEqual(groups[1].activators.map(m => m.id), ['k']);
    assert.deepStrictEqual(groups[2].core.map(m => m.id), ['old']); // legacy exCoreBatch keeps displaying
});

test('groupByTenureYearDesc is stable for equal displayOrder (insertion order)', () => {
    const members = [
        { id: 'x', name: 'X', memberType: 'core', displayOrder: 3,
            roleHistory: [{ startYear: 2027, endYear: 2027, role: 'CTO' }] },
        { id: 'y', name: 'Y', memberType: 'core', displayOrder: 3,
            roleHistory: [{ startYear: 2027, endYear: 2027, role: 'President' }] },
    ];
    const [g] = groupByTenureYearDesc(members);
    assert.deepStrictEqual(g.core.map(m => m.id), ['x', 'y']);
});

test('members with no tenure at all sink to the bottom "Other" section', () => {
    const members = [
        { id: 'good', name: 'Good', memberType: 'core', displayOrder: 0,
            roleHistory: [{ startYear: 2026, endYear: 2027, role: 'CTO' }] },
        { id: 'bad', name: 'Bad', memberType: 'core', displayOrder: 1,
            roleHistory: [{ startYear: 'junk', endYear: 2026, role: 'CTO' }] }, // unsalvageable
    ];
    const groups = groupByTenureYearDesc(members);
    const last = groups[groups.length - 1];
    assert.strictEqual(last.year, YEARLESS);
    assert.strictEqual(last.label, 'Other');
    assert.strictEqual(last.core.map(m => m.id)[0], 'bad');
    assert.strictEqual(groups[0].core.map(m => m.id)[0], 'good');
});

test('globalDisplayOrder yields one cross-year sequence with stable ties', () => {
    const members = [
        { id: 'a', name: 'A', memberType: 'core', displayOrder: 3,
            roleHistory: [{ startYear: 2026, endYear: 2028, role: 'CTO' }] },
        { id: 'b', name: 'B', memberType: 'core', displayOrder: 1,
            roleHistory: [{ startYear: 2027, endYear: 2028, role: 'President' }] },
        { id: 'c', name: 'C', memberType: 'core', displayOrder: 3,
            roleHistory: [{ startYear: 2027, endYear: 2028, role: 'VP' }] },
    ];
    assert.deepStrictEqual(globalDisplayOrder(members), ['b', 'a', 'c']); // rank, then insertion order
});

test('owner self-edit field whitelist behaves as designed', () => {
    assert.deepStrictEqual([...OWNER_EDITABLE_FIELDS], ['name', 'photoURL', 'bio', 'socials']);
    assert.strictEqual(hasOnlyOwnerFields({ name: 'x' }), true);
    assert.strictEqual(hasOnlyOwnerFields({ name: 'x', bio: 'y' }), true);
    assert.strictEqual(hasOnlyOwnerFields({}), false);
    assert.strictEqual(hasOnlyOwnerFields({ exCoreBatch: 2027 }), false);
    assert.strictEqual(hasOnlyOwnerFields({ roleHistory: [] }), false);
    assert.strictEqual(containsPrivilegedField({ roleHistory: [] }), true);
    assert.strictEqual(containsPrivilegedField({ displayOrder: 1 }), true);
    assert.strictEqual(containsPrivilegedField({ exCoreBatch: 2027 }), true);
    assert.strictEqual(containsPrivilegedField({ bio: 'safe' }), false);
});
