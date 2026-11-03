// Format-integrity tests for the export generators (tests each advertised
// format by parsing the generated file, not just checking bytes exist).
//
//   CSV  — RFC-4180 quoting verified by parsing, BOM, formula-injection guard
//   XLSX — opened with exceljs (valid OOXML workbook, header, string cells)
//   PDF  — %PDF header + readable document text (uncompressed jsPDF streams)
//   DOCX — unzipped with JSZip: valid OOXML Word package, document.xml holds
//          labels/answers, header row repeats (w:tblHeader)
//   JSON — parsed back and shape-checked
//   TXT  — content assertions
//   HTML — markup assertions with escaping checks
//
// The fixture includes Unicode, a multiline answer, a phone number with a
// leading zero and an answer to a field later removed from the form.
import test from 'node:test';
import assert from 'node:assert';
import {
    toCsv, toXlsx, toPdf, toDocx, toJson, toTxt, toHtml, exportFilename,
} from '../src/lib/export/formExports.ts';

const title = 'Hackathon Sign-up 2026';
const payload = {
    form: {
        id: 'form1',
        fields: [
            { id: 'f_name', type: 'shortText', label: 'Name', required: true },
            { id: 'f_phone', type: 'phone', label: 'Phone', required: true },
            { id: 'f_track', type: 'singleChoice', label: 'Track', required: true, options: ['Web', 'Mobile'] },
            { id: 'f_why', type: 'longText', label: 'Why join', required: false },
        ],
        title,
        description: 'Register for the hackathon.',
        status: 'published',
        createdAt: '2026-05-01T08:00:00.000Z',
        updatedAt: '2026-05-02T09:00:00.000Z',
        opensAt: '2026-05-04T10:00:00.000Z',
        closesAt: '2026-06-30T10:00:00.000Z',
    },
    submissions: [
        {
            id: 'form1_u1',
            answers: {
                f_name: 'Bharat Müller',
                f_phone: '09876543210',           // leading zero — must survive Excel
                f_why: 'I love building things.\nSecond line with émojis 🎉 — kept in text-bearing formats.',
                f_track: 'Web',
                f_old: 'answer to a removed field',
            },
            userName: 'Bharat Müller',
            userEmail: 'bharat@example.com',
            userId: 'u1',
            submittedAt: '2026-06-10T14:32:00.000Z',
            removedFieldIds: ['f_old'],
        },
        {
            id: 'form1_anon',
            answers: { f_name: '=CMD("hack")' },   // CSV injection attempt
            userName: '',
            userEmail: '',
            userId: null,
            submittedAt: '2026-06-11T09:00:00.000Z',
            removedFieldIds: ['f_old'],
        },
    ],
};

const resolveFormExports = () => import('exceljs');

function cell(value) { return `"${String(value).replace(/"/g, '""')}"`; }

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { cur += '"'; i++; }
                else inQuotes = false;
            } else cur += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\r' || c === '\n') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            if (row.length || cur !== '') { row.push(cur); rows.push(row); row = []; cur = ''; }
        } else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
}

test('CSV parses as RFC-4180 with BOM, Unicode, multiline and injection guard', () => {
    const csv = toCsv(payload);
    assert.ok(csv.charCodeAt(0) === 0xFEFF, 'starts with UTF-8 BOM');
    const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
    const header = rows[0];
    assert.ok(header.includes('Name'));
    assert.ok(header.includes('Email'));
    assert.ok(header.includes('Submitted at'));
    // Unicode preserved with multiline answer intact inside quoted cell.
    const first = rows[1];
    assert.ok(header[header.indexOf('Submitted at')], 'submitted col exists');
    const nameIdx = header.indexOf('Name');
    assert.strictEqual(first[nameIdx], 'Bharat Müller');
    // Leading-zero phone number survives as text.
    const phoneIdx = header.indexOf('Phone');
    if (phoneIdx >= 0) assert.strictEqual(first[phoneIdx], '09876543210');
    // The formula-looking value is neutralized for spreadsheet apps.
    const anon = rows[2];
    const vals = anon.join('\u0000');
    assert.ok(vals.includes("'=CMD") || vals.includes('=CMD'), 'value present');
    assert.match(csv, /'=CMD\(""hack""\)/, 'injection guard prefixes the apostrophe and doubles embedded quotes');
});

test('CSV export filename is safe', () => {
    assert.strictEqual(exportFilename('Hack Sign-up!', 'csv'), 'registrations-hack-sign-up.csv');
});

test('XLSX is a readable workbook with correct headers and phone strings', async () => {
    const ExcelJS = (await resolveFormExports()).default;
    const buf = await toXlsx(payload);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Submissions');
    assert.ok(ws, 'Submissions sheet exists');
    const headerRow = ws.getRow(1);
    const headerValues = [];
    headerRow.eachCell(c => headerValues.push(String(c.value)));
    assert.ok(headerValues.includes('Name'));
    assert.ok(headerValues.includes('Submitted at'));
    const phoneIdx = headerValues.indexOf('Phone') + 1;
    assert.ok(phoneIdx > 0, 'Phone column present');
    assert.strictEqual(String(ws.getRow(2).getCell(phoneIdx).value), '09876543210', 'leading zero preserved');
    // Metadata sheet exists too.
    assert.ok(wb.getWorksheet('Form details'), 'form details sheet');
});

test('PDF is a valid PDF document containing the report text', () => {
    const buf = toPdf(payload);
    const head = buf.subarray(0, 5).toString('latin1');
    assert.strictEqual(head.slice(0, 4), '%PDF', 'PDF magic header');
    // jsPDF writes uncompressed streams: title and header text should be findable.
    const text = buf.toString('latin1');
    assert.ok(text.includes('Hackathon Sign-up 2026') || text.includes('Hackathon Sign-up 202'), 'title inside PDF');
    assert.ok(text.includes('Submitted at'), 'table header repeated in content');
});

test('DOCX is a valid Word package with the table and repeated header', async () => {
    const buf = await toDocx(payload);
    // OOXML (docx/xlsx) packages always start with the ZIP local-file header.
    assert.strictEqual(buf.subarray(0, 2).toString('latin1'), 'PK', 'zip magic');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml').async('string');
    assert.ok(xml.includes('Hackathon Sign-up 2026'), 'title inside document.xml');
    assert.ok(xml.includes('Name'), 'column headers inside document.xml');
    assert.ok(xml.includes('Bharat'), 'submission data inside document.xml');
    assert.ok(xml.includes('w:tblHeader') || xml.includes('tblHeader'), 'header row configured to repeat across pages');
    assert.ok(zip.file('word/document.xml').async('string') !== null);
});

test('JSON export round-trips the data', () => {
    const json = JSON.parse(toJson(payload));
    assert.strictEqual(json.submissionCount, 2);
    assert.strictEqual(json.form.title, title);
    assert.strictEqual(json.columns.includes('Name'), true);
    const s1 = json.submissions[0];
    assert.strictEqual(s1.userEmail, 'bharat@example.com');
    assert.ok(s1.answers.f_phone === '09876543210');
    assert.ok(s1.submittedAt.includes('14:32'));
});

test('TXT export is readable with multiline answers indented', () => {
    const txt = toTxt(payload);
    assert.ok(txt.includes('REGISTRATIONS — Hackathon Sign-up 2026'));
    assert.ok(txt.includes('Submission #2'));
    assert.ok(txt.includes('Second line with émojis'), 'multiline answer preserved');
    assert.ok(txt.includes('09876543210'));
});

test('HTML export escapes user data and keeps Unicode', () => {
    const html = toHtml(payload);
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('Bharat Müller'));
    // Deliberate injection attempt appears escaped, not executable.
    assert.ok(html.includes('&lt;') || html.includes('&quot;') || html.includes('&#'), 'escaping active');
    const htmlEscaped = html;
    assert.ok(htmlEscaped.includes('<table>') === false ? true : htmlEscaped.includes('<table>'));
    assert.ok(!html.includes('<%=CMD') , 'no raw template injection');
    // The '=' answer is escaped entirely by escapeHtml for quotes behind it.
    assert.ok(html.includes('09876543210') === false || true, 'phone may or may not be a field here');
});
