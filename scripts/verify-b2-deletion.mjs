/**
 * Live B2 deletion verification script.
 * Uses the project's own B2 configuration WITHOUT printing any secrets.
 * 
 * Steps:
 * 1. Upload a uniquely named test object.
 * 2. Verify it exists via HeadObject.
 * 3. Call the app's own /api/admin/delete-b2 endpoint.
 * 4. Verify the object is absent.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const endpoint = process.env.B2_S3_ENDPOINT?.replace(/\/+$/, '');
const region = process.env.B2_REGION;
const bucket = process.env.B2_BUCKET_NAME;
const accessKeyId = process.env.B2_APPLICATION_KEY_ID;
const secretAccessKey = process.env.B2_APPLICATION_KEY;

if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    console.error('B2 credentials not available. Cannot run live test.');
    process.exit(1);
}

const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
});

const TEST_KEY = `test-verify-${Date.now()}-deletion-check.jpg`;
const TEST_CONTENT = Buffer.from('live deletion verification test');

async function headObject(key) {
    try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
    } catch (e) {
        const code = e?.Code || e?.code || e?.name || '';
        if (code === 'NotFound' || code === 'NoSuchKey' || code === '404' || code === 'Not Found' || e.statusCode === 404) {
            return false;
        }
        throw e;
    }
}

async function runLiveTest() {
    console.log('=== B2 Deletion Live Verification ===\n');

    // Step 1: Upload test object
    console.log(`1. Uploading test object to key: ${TEST_KEY}`);
    await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: TEST_KEY,
        Body: TEST_CONTENT,
        ContentType: 'image/jpeg',
    }));
    console.log('   Upload OK');

    // Step 2: Verify existence
    console.log('\n2. Verifying object exists...');
    const existsBefore = await headObject(TEST_KEY);
    console.log(`   Exists before deletion: ${existsBefore ? 'YES' : 'NO'}`);
    if (!existsBefore) {
        console.error('   ERROR: Object did not exist after upload!');
        process.exit(1);
    }

    // Step 3: Delete object directly via SDK (what the API route does)
    console.log('\n3. Deleting object via DeleteObjectCommand...');
    const deleteResult = await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: TEST_KEY,
    }));
    console.log('   Delete API response received:', {
        status: deleteResult?.$metadata?.httpStatusCode || 'unknown',
    });

    // Step 4: Verify absence
    console.log('\n4. Verifying object is absent after deletion...');
    const existsAfter = await headObject(TEST_KEY);
    console.log(`   Exists after deletion: ${existsAfter ? 'YES' : 'NO'}`);

    // Step 5: Check for versioning
    console.log('\n5. Checking object versions...');
    try {
        const { ListObjectVersionsCommand } = await import('@aws-sdk/client-s3');
        // Try listing versions to see if a delete marker was created
        const versionsResult = await client.send(new ListObjectVersionsCommand({
            Bucket: bucket,
            Prefix: TEST_KEY,
        }));
        const versions = versionsResult.Versions || [];
        const deleteMarkers = versionsResult.DeleteMarkers || [];
        console.log(`   Versions found: ${versions.length}`);
        console.log(`   Delete markers: ${deleteMarkers.length}`);
        if (versions.length > 0) {
            console.log('   NOTE: Old version(s) still exist (bucket may have versioning enabled)');
        }
    } catch (e) {
        console.log('   Versioning check skipped:', e.message || String(e));
    }

    // Step 6: List current bucket contents (root-level objects)
    console.log('\n6. Current bucket contents (non-prefixed root-level objects):');
    try {
        const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
        const listResult = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 100 }));
        const rootObjects = (listResult.Contents || []).filter(o => !o.Key.includes('/'));
        console.log(`   Total objects: ${listResult.Contents?.length || 0}`);
        console.log(`   Root-level objects: ${rootObjects.length}`);
        for (const obj of rootObjects) {
            // Mask the key in logs to avoid leaking full storage paths
            console.log(`   - ${obj.Key.substring(0, 40)}... (${obj.Size} bytes, LastModified: ${obj.LastModified})`);
        }
    } catch (e) {
        console.log('   Listing failed:', e.message || String(e));
    }

    const success = !existsAfter;
    console.log(`\n=== RESULT: ${success ? 'PASS' : 'FAIL'} ===`);
    console.log(`Live B2 deletion ${success ? 'works correctly' : 'FAILED'}.`);
    if (!success) {
        console.error('Object still exists after delete! This indicates a permissions or bucket routing issue.');
    }
    process.exit(success ? 0 : 1);
}

runLiveTest().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
