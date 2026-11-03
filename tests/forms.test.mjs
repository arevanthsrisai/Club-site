// Unit tests for the pure Forms domain logic (src/lib/forms.ts) —
// payload normalization, submission validation, availability windows,
// label resolution with removed fields, and export row building.
import test from 'node:test';
import assert from 'node:assert';
import {
    normalizeFormPayload, validateSubmission, computeAvailability,
    resolveFieldLabel, formatAnswerValue, persistableAnswers,
    buildExportColumns, buildExportRows, estimateAnswerColumns, slugifyFormTitle,
    AVAILABILITY_MESSAGE, newFieldId,
} from '../src/lib/forms.ts';

const SITE = { fields: [], name: '', email: '' };

function fieldList(...fields) { return { fields }; }

test('normalizeFormPayload accepts a valid form', () => {
    const res = normalizeFormPayload({
        title: 'Hack Signup',
        description: 'Fill this in',
        status: 'draft',
        fields: [
            { id: 'f1', type: 'shortText', label: 'Name', required: true },
            { id: 'f2', type: 'singleChoice', label: 'Track', options: ['Web', 'Mobile'], required: false },
        ],
    });
    assert.ok(res.ok);
    assert.strictEqual(res.value.title, 'Hack Signup');
    assert.strictEqual(res.value.fields.length, 2);
    assert.strictEqual(res.value.fields[0].required, true);
    assert.deepStrictEqual(res.value.fields[1].options, ['Web', 'Mobile']);
});

test('normalizeFormPayload rejects empty titles and empty-choice fields', () => {
    assert.ok(!normalizeFormPayload({ title: '   ', fields: [] }).ok);
    const badChoice = normalizeFormPayload({
        title: 'F', fields: [{ id: 'a', type: 'dropdown', label: 'Pick', options: ['Only one'] }],
    });
    assert.ok(!badChoice.ok);
});

test('normalizeFormPayload cleans options and dedupes case-insensitively', () => {
    const res = normalizeFormPayload({
        title: 'F',
        fields: [{ id: 'a', type: 'dropdown', label: 'Pick', options: [' Web ', 'web', 'Mobile ', ''] }],
    });
    assert.ok(res.ok);
    assert.deepStrictEqual(res.value.fields[0].options, ['Web', 'Mobile']);
});

test('normalizeFormPayload rejects publishing with zero fields', () => {
    const res = normalizeFormPayload({ title: 'F', status: 'published', fields: [] });
    assert.ok(!res.ok);
    assert.match(res.error, /at least one field/);
});

test('normalizeFormPayload validates opensAt/closesAt window', () => {
    const ok = normalizeFormPayload({
        title: 'F', fields: [{ type: 'shortText', label: 'A' }],
        opensAt: '2026-01-01T00:00:00',
        closesAt: '2026-01-02T00:00:00',
    });
    assert.ok(ok.ok);
    assert.ok(ok.value.opensAt instanceof Date);
    const bad = normalizeFormPayload({
        title: 'F', fields: [{ type: 'shortText', label: 'A' }],
        opensAt: '2026-01-02T00:00:00', closesAt: '2026-01-01T00:00:00',
    });
    assert.ok(!bad.ok);
    const junk = normalizeFormPayload({ title: 'F', fields: [], opensAt: 'not-a-date' });
    assert.ok(!junk.ok);
});

test('normalizeFormPayload validates number min/max and defaults', () => {
    const ok = normalizeFormPayload({
        title: 'F',
        fields: [{ id: 'n', type: 'number', label: 'Age', min: 13, max: 25, defaultValue: 18 }],
    });
    assert.ok(ok.ok);
    assert.strictEqual(ok.value.fields[0].defaultValue, 18);
    const badMin = normalizeFormPayload({
        title: 'F', fields: [{ type: 'number', label: 'Age', min: 10, max: 5 }],
    });
    assert.ok(!badMin.ok);
    const badDefault = normalizeFormPayload({
        title: 'F', fields: [{ type: 'number', label: 'Age', min: 10, max: 4, defaultValue: 18 }],
    });
    assert.ok(!badDefault.ok);
    const junkDefault = normalizeFormPayload({
        title: 'F', fields: [{ type: 'number', label: 'Age', defaultValue: 'eighteen' }],
    });
    assert.ok(!junkDefault.ok);
});

test('normalizeFormPayload validates date defaults', () => {
    const ok = normalizeFormPayload({
        title: 'F', fields: [{ type: 'date', label: 'DOB', defaultValue: '2028-02-29' }],
    });
    assert.ok(ok.ok);
    const bad = normalizeFormPayload({
        title: 'F', fields: [{ type: 'date', label: 'DOB', defaultValue: '2026-02-30' }],
    });
    assert.ok(!bad.ok);
});

test('validateSubmission enforces required, types, choices and lengths', () => {
    const form = {
        fields: [
            { id: 'a', type: 'shortText', label: 'Name', required: true },
            { id: 'b', type: 'email', label: 'Email', required: true },
            { id: 'c', type: 'phone', label: 'Phone', required: false },
            { id: 'd', type: 'number', label: 'Age', required: false, min: 13, max: 25 },
            { id: 'e', type: 'singleChoice', label: 'Track', required: true, options: ['Web', 'Mobile'] },
            { id: 'f', type: 'multiChoice', label: 'Skills', required: false, options: ['js', 'py'] },
            { id: 'g', type: 'checkbox', label: 'Consent', required: true },
            { id: 'h', type: 'longText', label: 'Why', required: false },
        ],
    };
    // everything missing
    let errs = validateSubmission(form, {});
    assert.ok(errs.a && errs.b && errs.e && errs.g);
    assert.ok(!errs.c && !errs.d && !errs.f && !errs.h);

    // type errors
    errs = validateSubmission(form, { a: 'x', b: 'nope', c: '12', d: 5, e: 'Alien', g: true, h: 'why' });
    assert.ok(errs.b && errs.c && errs.d && errs.e);
    assert.strictEqual(errs.a, undefined);
    assert.strictEqual(errs.g, undefined);
    assert.strictEqual(errs.h, undefined);

    // multiChoice rejects values outside options
    errs = validateSubmission(form, { a: 'x', b: 'a@b.co', e: 'Web', f: ['js', 'rust'], g: true });
    assert.ok(errs.f);
    errs = validateSubmission(form, { a: 'x', b: 'a@b.co', e: 'Web', f: ['js'], g: true });
    assert.deepStrictEqual(errs, {});

    // number boundary
    errs = validateSubmission(form, { a: 'x', b: 'a@b.co', e: 'Web', d: 25, g: true });
    assert.deepStrictEqual(errs, {});

    // checkbox consent must be true when required
    errs = validateSubmission(form, { a: 'x', b: 'a@b.co', e: 'Web', g: false });
    assert.ok(errs.g);

    // long text length cap (5000)
    errs = validateSubmission(form, { a: 'x', b: 'a@b.co', e: 'Web', g: true, h: 'x'.repeat(5001) });
    assert.ok(errs.h);
    errs = validateSubmission(form, { a: 'x', b: 'a@b.co', e: 'Web', g: true, h: 'x'.repeat(5000) });
    assert.ok(!errs.h);
});

test('persistableAnswers coerces types and drops empties', () => {
    const fields = [
        { id: 'n', type: 'number', label: 'Age' },
        { id: 'm', type: 'multiChoice', label: 'Skills', options: ['js', 'py'] },
        { id: 't', type: 'shortText', label: 'Name' },
        { id: 'chk', type: 'checkbox', label: 'Yes' },
        { id: 'empty', type: 'shortText', label: 'Skip' },
    ];
    const out = persistableAnswers(fields, { n: '18', m: ['js'], t: '  Sam  ', chk: true, empty: '' });
    assert.deepStrictEqual(out, { n: 18, m: ['js'], t: 'Sam', chk: true });
});

test('computeAvailability honors status and the open/close window', () => {
    const base = { opensAt: null, closesAt: null };
    const now = new Date('2026-01-15T12:00:00Z');
    assert.strictEqual(computeAvailability({ ...base, status: 'draft' }, now), 'draft');
    assert.strictEqual(computeAvailability({ ...base, status: 'closed' }, now), 'closed-status');
    assert.strictEqual(computeAvailability({ ...base, status: 'published' }, now), 'open');
    assert.strictEqual(
        computeAvailability({ ...base, status: 'published', closesAt: '2026-01-15T00:00:00Z' }, now),
        'deadline-passed'
    );
    assert.strictEqual(
        computeAvailability({ ...base, status: 'published', opensAt: '2026-01-16T00:00:00Z' }, now),
        'not-yet-open'
    );
    // Deadline exactly now counts as passed.
    assert.strictEqual(
        computeAvailability({ ...base, status: 'published', closesAt: '2026-01-15T12:00:00Z' }, now),
        'deadline-passed'
    );
    // Every reason maps to a human message.
    for (const key of ['draft', 'closed-status', 'not-yet-open', 'deadline-passed', 'open']) {
        assert.strictEqual(typeof AVAILABILITY_MESSAGE[key], 'string');
    }
});

test('resolveFieldLabel handles removed fields gracefully', () => {
    const form = { fields: [{ id: 'f1', type: 'shortText', label: 'Team name' }] };
    assert.deepStrictEqual(resolveFieldLabel(form, 'f1'), { label: 'Team name', removed: false });
    const gone = resolveFieldLabel(form, 'f_gone');
    assert.ok(gone.removed);
});

test('formatAnswerValue renders all answer shapes', () => {
    assert.strictEqual(formatAnswerValue(undefined, undefined), '');
    assert.strictEqual(formatAnswerValue(undefined, ['a', 'b']), 'a, b');
    assert.strictEqual(formatAnswerValue({ type: 'checkbox' }, true), 'Yes');
    assert.strictEqual(formatAnswerValue({ type: 'checkbox' }, false), 'No');
    assert.strictEqual(formatAnswerValue({ type: 'date' }, '2026-03-05'), '05/03/2026');
    assert.strictEqual(formatAnswerValue({ type: 'number' }, 42), '42');
    assert.strictEqual(formatAnswerValue({ type: 'shortText' }, 'line'), 'line');
});

test('export columns/rows include removed-field columns when present', () => {
    const form = { fields: [{ id: 'f1', type: 'shortText', label: 'Name' }] };
    const submissions = [{
        id: 's1',
        answers: { f1: 'Sam', f_gone: 'old answer' },
        userName: 'Sam', userEmail: 's@x.co', userId: null,
        submittedAt: '2026-06-01T10:00:00.000Z',
        removedFieldIds: ['f_gone'],
    }];
    const cols = estimateAnswerColumns(form, submissions);
    assert.ok(cols.some(c => c.header === 'Name'));
    assert.ok(cols.some(c => c.header.includes('Removed') && c.header.includes('removed')));

    const rows = buildExportRows(form, submissions, iso => iso.slice(0, 10));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].cells['f1'], 'Sam');
    assert.strictEqual(rows[0].cells['removed_f_gone'], 'old answer');
    assert.strictEqual(rows[0].userEmail, 's@x.co');
});

test('slugifyFormTitle produces safe filenames', () => {
    assert.strictEqual(slugifyFormTitle('Hack: Sign-up / 2026!'), 'hack-sign-up-2026');
    assert.strictEqual(slugifyFormTitle('   '), 'form');
});

test('newFieldId is unique and prefixed', () => {
    const a = newFieldId();
    const b = newFieldId();
    assert.ok(a.startsWith('fid_'));
    assert.notStrictEqual(a, b);
    assert.ok(new Set([a, b]).size === 2);
});

test('normalizeFormPayload caps field count', () => {
    const fields = Array.from({ length: 51 }, (_, i) => ({ id: `f${i}`, type: 'shortText', label: `F${i}` }));
    const res = normalizeFormPayload({ title: 'F', fields });
    assert.ok(!res.ok);
});
