/**
 * Live B2 permanent deletion verification test.
 * 
 * This test:
 * 1. Uploads a uniquely named test object
 * 2. Verifies it exists
 * 3. Calls the permanent deletion API
 * 4. Verifies all versions are gone
 * 5. Reports the exact outcome
 */

import 'dotenv/config';
import { config } from 'dotenv';
import { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectVersionsCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

config({ path: '.env.local' });

const B2_CONFIG = {
    endpoint: process.env.B2_S3_ENDPOINT?.replace(/\/+$/, ''),
    region: process.env.B2_REGION,
    bucketName: process.env.B2_BUCKET_NAME,
    accessKeyId: process.env.B2_APPLICATION_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY,
};

function getClient() {
    return new S3Client({
        region: B2_CONFIG.region,
        endpoint: B2_CONFIG.endpoint,
        credentials: {
            accessKeyId: B2_CONFIG.accessKeyId,
            secretAccessKey: B2_CONFIG.secretAccessKey,
        },
    });
}

async function uploadTestObject(key) {
    const client = getClient();
    const body = Buffer.from('Test object for permanent deletion verification - ' + new Date().toISOString());
    
    console.log(`📤 Uploading test object: ${key}`);
    await client.send(new PutObjectCommand({
        Bucket: B2_CONFIG.bucketName,
        Key: key,
        Body: body,
        ContentType: 'text/plain',
    }));
    console.log(`✓ Upload complete`);
}

async function verifyObjectExists(key) {
    const client = getClient();
    try {
        await client.send(new HeadObjectCommand({
            Bucket: B2_CONFIG.bucketName,
            Key: key,
        }));
        console.log(`✓ Object exists: ${key}`);
        return true;
    } catch (error) {
        if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
            console.log(`✗ Object not found: ${key}`);
            return false;
        }
        throw error;
    }
}

async function listAllVersions(key) {
    const client = getClient();
    const versions = [];
    let nextKeyMarker;
    let hasMore = true;

    while (hasMore) {
        const res = await client.send(new ListObjectVersionsCommand({
            Bucket: B2_CONFIG.bucketName,
            Prefix: key,
            KeyMarker: nextKeyMarker,
        }));

        for (const v of res.Versions || []) {
            if (v.Key === key && v.VersionId) {
                versions.push({ VersionId: v.VersionId, IsLatest: v.IsLatest });
            }
        }
        for (const m of res.DeleteMarkers || []) {
            if (m.Key === key && m.VersionId) {
                versions.push({ VersionId: m.VersionId, IsLatest: m.IsLatest, IsDeleteMarker: true });
            }
        }

        hasMore = !!(res.IsTruncated && res.NextKeyMarker);
        nextKeyMarker = res.NextKeyMarker;
    }

    return versions;
}

async function permanentDelete(key) {
    const client = getClient();
    console.log(`🗑️  Starting permanent deletion of: ${key}`);

    // List all versions
    const versions = await listAllVersions(key);
    console.log(`  Found ${versions.length} version(s) to delete`);

    if (versions.length === 0) {
        console.log(`  No versions found - object already absent`);
        return { success: true, deletedCount: 0 };
    }

    // Delete each version by VersionId
    for (const v of versions) {
        console.log(`  Deleting version ${v.VersionId}${v.IsDeleteMarker ? ' (delete marker)' : ''}`);
        await client.send(new DeleteObjectCommand({
            Bucket: B2_CONFIG.bucketName,
            Key: key,
            VersionId: v.VersionId,
        }));
    }

    // Verify no versions remain
    const remaining = await listAllVersions(key);
    if (remaining.length > 0) {
        console.log(`✗ Deletion incomplete: ${remaining.length} version(s) still remain`);
        return { success: false, deletedCount: versions.length - remaining.length, remaining: remaining.length };
    }

    console.log(`✓ Permanent deletion complete - no versions remain`);
    return { success: true, deletedCount: versions.length };
}

async function runTest() {
    const testKey = `test-permanent-delete-${randomUUID()}.txt`;
    
    console.log('='.repeat(60));
    console.log('B2 PERMANENT DELETION VERIFICATION TEST');
    console.log('='.repeat(60));
    console.log(`Bucket: ${B2_CONFIG.bucketName}`);
    console.log(`Endpoint: ${B2_CONFIG.endpoint}`);
    console.log(`Region: ${B2_CONFIG.region}`);
    console.log('='.repeat(60));
    console.log('');

    try {
        // Step 1: Upload
        await uploadTestObject(testKey);
        
        // Step 2: Verify exists
        const exists = await verifyObjectExists(testKey);
        if (!exists) {
            console.log('❌ TEST FAILED: Object upload verification failed');
            process.exit(1);
        }

        // Step 3: List versions before deletion
        const versionsBefore = await listAllVersions(testKey);
        console.log(`📋 Versions before deletion: ${versionsBefore.length}`);
        versionsBefore.forEach((v, i) => {
            console.log(`   ${i + 1}. ${v.VersionId}${v.IsLatest ? ' (latest)' : ''}${v.IsDeleteMarker ? ' (delete marker)' : ''}`);
        });

        // Step 4: Permanent delete
        const deleteResult = await permanentDelete(testKey);
        
        if (!deleteResult.success) {
            console.log('❌ TEST FAILED: Permanent deletion did not complete');
            console.log(`   Deleted: ${deleteResult.deletedCount}, Remaining: ${deleteResult.remaining}`);
            process.exit(1);
        }

        // Step 5: Verify deletion
        const existsAfter = await verifyObjectExists(testKey);
        if (existsAfter) {
            console.log('❌ TEST FAILED: Object still exists after permanent deletion');
            process.exit(1);
        }

        // Step 6: Final verification - list versions
        const versionsAfter = await listAllVersions(testKey);
        if (versionsAfter.length > 0) {
            console.log('❌ TEST FAILED: Versions still exist after permanent deletion');
            console.log(`   Remaining versions: ${versionsAfter.length}`);
            versionsAfter.forEach((v, i) => {
                console.log(`   ${i + 1}. ${v.VersionId}`);
            });
            process.exit(1);
        }

        console.log('');
        console.log('='.repeat(60));
        console.log('✅ TEST PASSED: Permanent deletion verified successfully');
        console.log('='.repeat(60));
        console.log(`Test object: ${testKey}`);
        console.log(`Versions deleted: ${deleteResult.deletedCount}`);
        console.log(`Versions remaining: ${versionsAfter.length}`);
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('❌ TEST ERROR:', error.message);
        console.error(error);
        process.exit(1);
    }
}

runTest();