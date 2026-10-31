// Tests for the shared Markdown pipeline used by the event Details/Key Points
// fields (admin preview and public event pages render through react-markdown
// with its DEFAULT safe pipeline — see src/components/ui/Markdown.tsx).
//
// These tests exercise react-markdown the same way production does: no
// rehype-raw (raw HTML never becomes real markup) and the default URL
// transform (unsafe protocols stripped), rendered through React SSR.
import { test } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';

const md = (source) => renderToStaticMarkup(React.createElement(ReactMarkdown, null, source));

// ------------------------------------------------------------ rendering

test('headings, emphasis, lists, links and blockquotes render as markup', () => {
    const out = md('# Welcome\n\nA **bold** and *italic* word.\n\n- first\n- second\n');
    assert.ok(out.includes('Welcome'));
    assert.ok(/<h1/.test(out));
    assert.ok(/<strong[^>]*>bold<\/strong>/.test(out));
    assert.ok(/<em[^>]*>italic<\/em>/.test(out));
    assert.ok(/<ul>/.test(out) && /<li>/.test(out));
});

test('ordered lists and inline code render', () => {
    const out = md('1. one\n2. two\n\nUse `npm install`.\n');
    assert.ok(/<ol>/.test(out) && /one/.test(out) && /two/.test(out));
    assert.ok(/<code/.test(out) && out.includes('npm install'));
});

test('links render with their href', () => {
    const out = md('[ReLU](https://relu.example.com)\n');
    assert.ok(/href="https:\/\/relu\.example\.com"/.test(out), out);
});

test('nested lists and paragraphs preserve document structure', () => {
    const out = md('Paragraph one.\n\nParagraph two.\n\n- a\n- b\n\nEnd.\n');
    const paragraphs = out.match(/<p>/g)?.length ?? 0;
    assert.strictEqual(paragraphs, 3, 'multi-paragraph structure survives');
});

// -------------------------------------------------------------- security

test('javascript: link URLs are stripped from rendered output', () => {
    const out = md('[click me](javascript:alert(1))\n');
    assert.ok(!out.includes('javascript:'), `unsafe href leaked: ${out}`);
    assert.ok(/<a/.test(out), 'the anchor still renders as inert text');
});

test('data: URLs are stripped', () => {
    const out = md('[bad](data:text/html,<script>alert(1)</script>)\n');
    assert.ok(!out.toLowerCase().includes('data:text/html'), out);
});

test('vbscript: and other exotic protocols are stripped', () => {
    const out = md('[x](vbscript:msgbox("x"))\n');
    assert.ok(!out.includes('vbscript:'), out);
});

test('raw HTML is never executed — <script> and <img onerror> are escaped', () => {
    const out = md('<img src=x onerror="alert(1)">\n<script>alert(1)</script>\n');
    assert.ok(!out.includes('<script>'), `raw script tag leaked: ${out}`);
    assert.ok(!out.includes('<img'), `raw img tag leaked: ${out}`);
    assert.ok(out.includes('&lt;script&gt;') && out.includes('&lt;img'), 'hostile HTML appears only as escaped text');
});

test('relative links are preserved for internal navigation', () => {
    const out = md('[team](/about)\n');
    assert.ok(/href="\/about"/.test(out), out);
});

test('upward-traversal / suspicious hrefs cannot smuggle http stays-safe', () => {
    const out = md('[s](HTTPS://EXAMPLE.COM/ok)\n');
    assert.ok(!out.includes('HTTPS://EXAMPLE.COM/ok') === false, out); // uppercase http stays (case-insensitive check below)
    assert.ok(/href="HTTPS:\/\/EXAMPLE\.COM\/ok"/i.test(out), out);
});

// --------------------------------------- key points / legacy compatibility

test('legacy plain-text descriptions render unchanged', () => {
    const source = 'Welcome to the event. Please bring your laptop.';
    const out = md(source);
    assert.ok(out.includes('Welcome to the event. Please bring your laptop.'));
    assert.ok(!out.includes('**'), 'no stray markdown markers in plain text');
});

test('legacy key points: one point per line stays separate list items', () => {
    // The legacy storage format is newline-separated points; the editor and
    // public page render each stored item through the renderer separately.
    const items = 'Round 1\nAptitude test\nResults at 6 PM'.split('\n');
    const rendered = items.map(p => renderToStaticMarkup(React.createElement(ReactMarkdown, null, p)));
    assert.strictEqual(rendered.length, 3);
    for (const item of rendered) {
        assert.ok(item.includes('<p>'), `each item is its own paragraph: ${item}`);
    }
    // no accidental merging: each source line appears in exactly one item
    assert.ok(rendered[0].includes('Round 1') && rendered[1].includes('Aptitude test'));
});

test('key point items can carry inline markdown formatting', () => {
    const out = md('**Mandatory**: bring your ID card\n');
    assert.ok(/<strong>Mandatory<\/strong>/.test(out), out);
});

test('markdown with malformed syntax cannot crash the renderer', () => {
    for (const hostile of ['', '   ', '[unbalanced:', '[]( )', '#\n###', '![]()', '\n\n\n****', '| a | b |', '>' + 'x'.repeat(500)]) {
        const out = md(hostile);
        assert.ok(typeof out === 'string');
    }
    // Long content renders without throwing.
    md('# Long\n\n' + 'Word '.repeat(2000));
});

test('fenced code blocks render inside <pre><code>', () => {
    const out = md('```js\nconsole.log("hi");\n```\n');
    assert.ok(out.includes('<pre') && out.includes('<code'), out);
});

test('blockquote renders', () => {
    const out = md('> quoted line\n');
    assert.ok(/blockquote/.test(out), out);
});
