// Regression tests for alumni batch derivation and grouping.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert';

import {
    alumniBatchLabel,
    alumniJoiningYear,
    batchLabelFromJoiningYear,
    groupAlumniByBatch,
    joiningYearFromLegacyBatch,
    normalizeJoiningYear,
} from '../src/lib/alumni.ts';

const currentYear = new Date().getFullYear();

test('a joining year produces a four-year batch label', () => {
    assert.strictEqual(batchLabelFromJoiningYear(2025), '2025-2029');
    assert.strictEqual(batchLabelFromJoiningYear(2020), '2020-2024');
});

test('joining years are validated, never guessed', () => {
    assert.strictEqual(normalizeJoiningYear('2025'), 2025);
    assert.strictEqual(normalizeJoiningYear(2025), 2025);
    assert.strictEqual(normalizeJoiningYear(' 2025 '), 2025);
    assert.strictEqual(normalizeJoiningYear(''), null);
    assert.strictEqual(normalizeJoiningYear('abc'), null);
    assert.strictEqual(normalizeJoiningYear(2025.5), null);
    assert.strictEqual(normalizeJoiningYear(1999), null);
    // A person cannot join in the future.
    assert.strictEqual(normalizeJoiningYear(currentYear + 1), null);
});

test('legacy free-text batches yield their first year', () => {
    assert.strictEqual(joiningYearFromLegacyBatch('2020-2024'), 2020);
    assert.strictEqual(joiningYearFromLegacyBatch('Batch of 2021'), 2021);
    assert.strictEqual(joiningYearFromLegacyBatch('2023'), 2023);
    assert.strictEqual(joiningYearFromLegacyBatch('unknown'), null);
    assert.strictEqual(joiningYearFromLegacyBatch(undefined), null);
});

test('the stored joining year wins over the legacy label', () => {
    assert.strictEqual(alumniJoiningYear({ joiningYear: 2025, batchYear: '2019-2023' }), 2025);
    assert.strictEqual(alumniJoiningYear({ batchYear: '2019-2023' }), 2019);
    // An invalid stored year (e.g. a typo from a previous import) falls back.
    assert.strictEqual(alumniJoiningYear({ joiningYear: 2205, batchYear: '2018-2022' }), 2018);
});

test('batch labels use the derived year, preserve unknown legacy text, and never go blank', () => {
    assert.strictEqual(alumniBatchLabel({ joiningYear: 2025 }), '2025-2029');
    assert.strictEqual(alumniBatchLabel({ batchYear: '2020-2024' }), '2020-2024');
    assert.strictEqual(alumniBatchLabel({ batchYear: '2024' }), '2024-2028');
    assert.strictEqual(alumniBatchLabel({ batchYear: 'Legacy label' }), 'Legacy label');
    assert.strictEqual(alumniBatchLabel({}), 'Batch not set');
});

test('groups are newest first, unassigned last, and members are name-ordered', () => {
    const alumni = [
        { id: '1', name: 'Zara', joiningYear: 2022 },
        { id: '2', name: 'Alice', joiningYear: 2022 },
        { id: '3', name: 'Bob', joiningYear: 2025 },
        { id: '4', name: 'Old', batchYear: '2019-2023' },
        { id: '5', name: 'NoYear' },
    ];

    const groups = groupAlumniByBatch(alumni);
    assert.deepStrictEqual(groups.map(g => g.title), [
        'Batch 2025-2029',
        'Batch 2022-2026',
        'Batch 2019-2023',
        'Batch not set',
    ]);
    assert.deepStrictEqual(groups[1].members.map(m => m.name), ['Alice', 'Zara']);
    assert.deepStrictEqual(groups[3].members.map(m => m.name), ['NoYear']);
});
