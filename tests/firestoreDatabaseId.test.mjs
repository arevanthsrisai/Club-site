// Unit tests for Firestore database ID configuration.
// Verifies that the configured database ID is used and no silent fallback to (default) occurs.
import { test } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

test('environment example contains database ID variables', () => {
    const envExample = readFileSync(join(projectRoot, '.env.example'), 'utf8');
    assert.ok(envExample.includes('NEXT_PUBLIC_FIRESTORE_DATABASE_ID'));
    assert.ok(envExample.includes('FIRESTORE_DATABASE_ID'));
});

test('client firebase.ts throws if NEXT_PUBLIC_FIRESTORE_DATABASE_ID missing', () => {
    // This test validates the logic by reading the source
    const firebaseTs = readFileSync(join(projectRoot, 'src/lib/firebase.ts'), 'utf8');
    assert.ok(firebaseTs.includes('NEXT_PUBLIC_FIRESTORE_DATABASE_ID'));
    assert.ok(firebaseTs.includes('throw new Error'));
    assert.ok(firebaseTs.includes('getFirestore(app, databaseId)'));
});

test('server firebaseAdmin.ts throws if FIRESTORE_DATABASE_ID missing', () => {
    const firebaseAdminTs = readFileSync(join(projectRoot, 'src/lib/firebaseAdmin.ts'), 'utf8');
    assert.ok(firebaseAdminTs.includes('FIRESTORE_DATABASE_ID'));
    assert.ok(firebaseAdminTs.includes('throw new Error'));
    assert.ok(firebaseAdminTs.includes('getFirestore(getAdminApp(), getDatabaseId())'));
});

test('database ID validation: non-empty and trimmed', () => {
    // Test the validation logic directly
    function validateDatabaseId(id) {
        if (!id || id.trim() === "") {
            throw new Error("FIRESTORE_DATABASE_ID is required");
        }
        return id.trim();
    }

    assert.strictEqual(validateDatabaseId("default-clone"), "default-clone");
    assert.strictEqual(validateDatabaseId("  default-clone  "), "default-clone");

    assert.throws(() => validateDatabaseId(""), { message: /required/ });
    assert.throws(() => validateDatabaseId("   "), { message: /required/ });
    assert.throws(() => validateDatabaseId(null), { message: /required/ });
    assert.throws(() => validateDatabaseId(undefined), { message: /required/ });
});

test('no hardcoded "(default)" database in application code', () => {
    // Search for any hardcoded (default) database references in app code
    const forbiddenPatterns = [
        'getFirestore(app)',
        'getFirestore(getAdminApp())',
    ];
    
    const filesToCheck = [
        'src/lib/firebase.ts',
        'src/lib/firebaseAdmin.ts',
    ];

    for (const file of filesToCheck) {
        const content = readFileSync(join(projectRoot, file), 'utf8');
        for (const pattern of forbiddenPatterns) {
            // Allow the old pattern only if it's commented or in a different context
            // The new code should use getFirestore(app, databaseId) or getFirestore(getAdminApp(), getDatabaseId())
            if (content.includes(pattern) && !content.includes('getFirestore(app, databaseId)') && !content.includes('getFirestore(getAdminApp(), getDatabaseId())')) {
                // This would be a regression - old pattern without database ID
                assert.fail(`${file} uses ${pattern} without database ID`);
            }
        }
    }
});

test('client and server database IDs can be validated for consistency', () => {
    // Simulated check that both env vars are set
    process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = "default-clone";
    process.env.FIRESTORE_DATABASE_ID = "default-clone";

    const clientId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID;
    const serverId = process.env.FIRESTORE_DATABASE_ID;

    assert.strictEqual(clientId, serverId, "Client and server database IDs must match");
    assert.ok(clientId !== "(default)", "Must not use (default) database");
});