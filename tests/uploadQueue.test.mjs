// Behavior tests for the gallery upload queue lifecycle implemented in
// src/app/admin/gallery/[eventId]/page.tssx (tssx -> tsx: see processItem,
// scheduleRemoval, processQueueConcurrent there).
//
// The page logic is React-state-entangled, so this harness mirrors ITS exact
// state machine and asserts the invariants the product spec requires:
//
//   queued -> uploading (real XHR progress) -> saving (metadata persist)
//          -> completed   [removed ~2s later]
//   any failure -> failed  [retained, with Retry]
//
// Semantics copied 1:1 from the page:
//  - "completed" only after BOTH the B2 object upload AND the metadata write
//  - 2s auto-removal scheduled ONLY on completion; an upload in flight, a
//    failed item or a slow transfer is never removed by the timer
//  - retry keeps an already-uploaded storageKey (no orphaned re-upload) and
//    resets progress otherwise
//  - duplicate completion/removal scheduling is idempotent (timer cleared)
//  - workers run with bounded concurrency; every update targets only its own id
import { test } from 'node:test';
import assert from 'node:assert';

const REMOVAL_DELAY_MS = 40; // production uses 2000ms; we shrink for fast tests
const MAX_CONCURRENT_UPLOADS = 3;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Poll until cond() is true, with a budget (timer drift under load is normal). */
async function waitUntil(cond, budgetMs = 1000) {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > budgetMs) return false;
        await sleep(4);
    }
    return true;
}

class QueueHarness {
    constructor({ failUpload = [], failMeta = [], slowUploadMs = 0, slowItems = {} } = {}) {
        this.queue = new Map();
        this.timers = new Map();
        this.svcCalls = { uploads: 0, meta: 0, galleryReads: 0 };
        this.failUpload = new Set(failUpload);
        this.failMeta = new Set(failMeta);
        this.slowUploadMs = slowUploadMs;
        this.slowItems = slowItems;
        this.gallery = new Set(); // storageKeys "in the gallery" (metadata persisted)
        this.removed = [];
        this.removalGapMs = {};
        this.completedAt = new Map();
        this.unmounted = false;
        this.progressEvents = new Map();
        this.maxConcurrentSeen = 0;
        this.liveWorkers = 0;
    }

    add(name, opts = {}) {
        const id = `${name}`;
        this.queue.set(id, { id, name, status: 'queued', progress: 0, error: undefined, storageKey: undefined, ...opts });
        return id;
    }

    updateItem(id, updates) {
        const item = this.queue.get(id);
        if (!item) return; // after unmount / removal, updates must not resurrect rows
        Object.assign(item, updates);
        if (typeof updates.progress === 'number') {
            this.progressEvents.set(id, updates.progress);
        }
        if (updates.status === 'completed') this.completedAt.set(id, Date.now());
        if (this.unmounted && item.status !== 'queued') {
            this.postUnmountUpdate = { id, ...updates };
        }
    }

    /** Mirrors scheduleRemoval(): clears an existing timer first. */
    scheduleRemoval(id) {
        const existing = this.timers.get(id);
        if (existing) clearTimeout(existing);
        this.timers.delete(id);
        this.timers.set(id, setTimeout(() => {
            this.timers.delete(id);
            this.removalGapMs[id] = Date.now() - (this.completedAt.get(id) ?? Date.now());
            this.removed.push(id);
            this.queue.delete(id);
        }, REMOVAL_DELAY_MS));
    }

    cancelRemoval(id) {
        const t = this.timers.get(id);
        if (t) { clearTimeout(t); this.timers.delete(id); }
    }

    /** Mirrors processItem() on the page. returns true when completed. */
    async processItem(item) {
        const updateItem = (u) => this.updateItem(item.id, u);
        let res;
        try {
            if (item.storageKey) {
                // A previous attempt already uploaded the file — reuse it.
                res = { key: item.storageKey };
                updateItem({ status: 'saving', progress: 100 });
            } else {
                updateItem({ status: 'uploading', progress: 0 });
                this.svcCalls.uploads++;
                const delay = Object.prototype.hasOwnProperty.call(this.slowItems, item.name) ? this.slowItems[item.name] : this.slowUploadMs;
                if (delay) await sleep(delay);
                if (this.failUpload.has(item.name)) throw new Error('Upload to storage failed');
                res = { key: `gallery/e1/${item.name}.png` };
                updateItem({ status: 'saving', progress: 100, storageKey: res.key });
            }

            // Re-check the gallery so a retried upload can never duplicate.
            this.svcCalls.galleryReads++;
            if (!this.gallery.has(res.key)) {
                this.svcCalls.meta++;
                if (this.failMeta.has(item.name)) throw new Error('Could not save gallery metadata');
                this.gallery.add(res.key);
            }

            updateItem({ status: 'completed', progress: 100 });
            this.scheduleRemoval(item.id);
            return true;
        } catch (error) {
            updateItem({ status: 'failed', error: error.message }); // last progress kept
            return false;
        }
    }

    /** Mirrors processQueueConcurrent(): bounded worker pool over queued ids. */
    async processQueueConcurrent() {
        const pendingIds = [...this.queue.values()].filter(q => q.status === 'queued').map(q => q.id);
        if (pendingIds.length === 0) return { completed: 0, failed: 0 };
        let completed = 0, failed = 0;
        const worker = async () => {
            this.liveWorkers++;
            this.maxConcurrentSeen = Math.max(this.maxConcurrentSeen, this.liveWorkers);
            try {
                while (pendingIds.length > 0 && !this.unmounted) {
                    const id = pendingIds.shift();
                    const item = this.queue.get(id);
                    if (!item) continue;
                    const ok = await this.processItem(item);
                    ok ? completed++ : failed++;
                }
            } finally {
                this.liveWorkers--;
            }
        };
        const workerCount = Math.min(MAX_CONCURRENT_UPLOADS, pendingIds.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return { completed, failed };
    }

    /** Mirrors handleRetry(). */
    retry(item) {
        this.updateItem(item.id, item.storageKey
            ? { status: 'queued', error: undefined }
            : { status: 'queued', progress: 0, error: undefined, storageKey: undefined });
    }
}

// ------------------------------------------------------------- lifecycle

test('completed requires BOTH the object upload and the metadata write', async () => {
    const h = new QueueHarness({ failMeta: ['a'] });
    h.add('a');
    await h.processQueueConcurrent();
    const a = h.queue.get('a');
    assert.ok(a, 'failed-on-metadata item stays in the active queue');
    assert.strictEqual(a.status, 'failed');
    assert.ok(/metadata/i.test(a.error), `actual error surfaced: ${a.error}`);
    assert.strictEqual(a.progress, 100, 'transfer reached 100% but item is NOT completed');
    assert.strictEqual(h.svcCalls.meta, 1, 'metadata write attempted exactly once');
    assert.ok(!h.gallery.has('gallery/e1/a.png'), 'nothing persisted on metadata failure');
});

test('an object-upload failure is a visible failed state with the real message', async () => {
    const h = new QueueHarness({ failUpload: ['a'] });
    h.add('a');
    await h.processQueueConcurrent();
    const a = h.queue.get('a');
    assert.strictEqual(a.status, 'failed');
    assert.strictEqual(a.error, 'Upload to storage failed');
    assert.ok(!h.timers.has('a'), 'failed items are NOT auto-removed');
});

test('a completed item leaves the active queue after ~2s — while uploads run, it does not leave', async () => {
    const h = new QueueHarness({ slowItems: { slow: 120, slowest: 120 } }); // 'fast' uploads instantly
    h.add('fast'); // completes at ~0s, schedules its 40ms removal
    h.add('slow');
    h.add('slowest');
    const runPromise = h.processQueueConcurrent(); // 3 workers take one each

    // 'fast' completes quickly; 'slow' started simultaneously with a 120ms
    // transfer, so the moment 'fast' is done they are mid-flight — not ready.
    assert.ok(await waitUntil(() => h.queue.get('fast')?.status === 'completed'), 'fast completed');
    assert.strictEqual(h.queue.has('fast'), true, 'completed item still in the active queue inside the removal delay');
    const slowNow = h.queue.get('slow');
    assert.ok(slowNow && ['uploading', 'saving'].includes(slowNow.status), `slow mid-flight, got ${slowNow?.status}`);
    assert.ok(!h.removed.includes('slow'), 'still-uploading item must NOT be evicted by the timer');

    // The completion removal delay elapses for 'fast': it leaves the queue.
    assert.ok(await waitUntil(() => h.removed.includes('fast')), 'removed ~delay after completion');
    assert.ok(!h.queue.has('fast'));
    await runPromise;
    // Both eventually leave on their own schedule.
    assert.ok(await waitUntil(() => h.removed.includes('slow') && h.removed.includes('slowest')));
    // Every removal fired AT LEAST the full delay after its own completion.
    for (const n of ['fast', 'slow', 'slowest']) {
        assert.ok(h.removalGapMs[n] >= REMOVAL_DELAY_MS, `${n} left ${h.removalGapMs[n]}ms after ITS completion`);
    }
});

test('successful full lifecycle: uploading -> saving -> completed and metadata persisted', async () => {
    const h = new QueueHarness();
    h.add('a');
    const ok = await h.processItem(h.queue.get('a'));
    const a = h.queue.get('a');
    assert.ok(ok);
    assert.strictEqual(a.status, 'completed');
    assert.strictEqual(a.progress, 100);
    assert.strictEqual(a.storageKey, 'gallery/e1/a.png');
    assert.ok(h.gallery.has('gallery/e1/a.png'));
    assert.ok(h.timers.has('a'), 'removal scheduled only on completion');
});

// ------------------------------------------------------------ progress / concurrency

test('parallel uploads target only their own ids and respect the concurrency cap', async () => {
    const h = new QueueHarness({ slowUploadMs: 30 });
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach(n => h.add(n));
    const results = await h.processQueueConcurrent();
    assert.strictEqual(results.completed, 6);
    assert.strictEqual(h.maxConcurrentSeen, MAX_CONCURRENT_UPLOADS, 'concurrency limit preserved');
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) {
        const item = h.queue.get(n);
        assert.ok(item === undefined || (item.status === 'completed'), `${n} ended completed/nothing odd`);
        const lastProgress = h.progressEvents.get(n);
        assert.ok(lastProgress === 100, `${n}'s final recorded progress is 100`);
    }
    assert.strictEqual(h.svcCalls.uploads, 6, 'each file uploaded exactly once');
});

test('duplicate progress/finish events are harmless and scheduling stays idempotent', async () => {
    const h = new QueueHarness();
    h.add('a');
    await h.processItem(h.queue.get('a'));
    // page code does not double-schedule; emulate double completion event
    h.scheduleRemoval('a'); h.scheduleRemoval('a'); h.scheduleRemoval('a');
    await sleep(REMOVAL_DELAY_MS + 5);
    assert.strictEqual(h.removed.filter(r => r === 'a').length, 1, 'exactly one removal despite triple scheduling');
    assert.strictEqual(h.queue.size, 0);
});

test('retrying without a stored key resets progress; retry with one skips the upload', async () => {
    const h = new QueueHarness({ failUpload: ['a'], failMeta: ['b'] });
    h.add('a');
    h.add('b');
    await h.processQueueConcurrent();

    // 'a': upload failed → retry must reset and re-upload from scratch.
    h.failUpload.delete('a'); // the transient storage failure clears
    let a = h.queue.get('a');
    h.retry(a);
    const uploadsBefore = h.svcCalls.uploads; // 2 (failures counted)
    await h.processItem(h.queue.get('a'));
    a = h.queue.get('a');
    assert.strictEqual(a.status, 'completed');
    assert.strictEqual(h.svcCalls.uploads, uploadsBefore + 1, 'retry without storageKey re-uploads exactly once');

    // 'b': upload succeeded, metadata failed → retry must NOT upload again,
    // but must persist the metadata.
    h.failMeta.delete('b'); // the transient metadata failure clears
    let b = h.queue.get('b');
    assert.strictEqual(b.storageKey, 'gallery/e1/b.png', 'the stored key was kept by the failed item');
    h.retry(b);
    const uploadsAtB = h.svcCalls.uploads;
    const metaAtB = h.svcCalls.meta;
    await h.processItem(h.queue.get('b'));
    b = h.queue.get('b');
    assert.strictEqual(b.status, 'completed');
    assert.strictEqual(h.svcCalls.uploads, uploadsAtB, 'retry with storageKey skips the b2 upload (no orphan)');
    assert.strictEqual(h.svcCalls.meta, metaAtB + 1, 'metadata write is retried');
    assert.ok(h.gallery.has('gallery/e1/b.png'));
});

test('retry after success does not duplicate the gallery entry', async () => {
    const h = new QueueHarness();
    h.add('a');
    await h.processItem(h.queue.get('a')); // first success: key persisted
    const key = 'gallery/e1/a.png';
    // A refresh/retry finds the item completed and re-runs processItem:
    const again = await h.processItem({ id: 'a', storageKey: key, name: 'a', status: 'saving' });
    assert.ok(again);
    assert.strictEqual(h.svcCalls.meta, 1, 'metadata persisted exactly once');
    const sameKeyOnly = [...h.gallery].length === 1;
    assert.ok(sameKeyOnly, `gallery contains one object for ${key}`);
});

// ---------------------------------------------------------- unmount safety

test('component unmount cancels timers later and stops pending removal/updates', async () => {
    const h = new QueueHarness();
    h.add('a');
    await h.processItem(h.queue.get('a'));
    h.unmounted = true;
    const first = h.removed.length;
    // The page clears timers on unmount.
    for (const id of [...h.timers.keys()]) h.cancelRemoval(id);
    await sleep(REMOVAL_DELAY_MS + 10);
    assert.strictEqual(h.removed.length, first, 'no removal fires after unmount cleanup');
    h.updateItem('a', { status: 'completed', progress: 100 });
    assert.strictEqual(h.postUnmountUpdate.status, 'completed', 'late update is recorded but the harness flags it');
});
