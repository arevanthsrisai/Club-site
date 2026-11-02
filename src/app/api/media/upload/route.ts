import { NextResponse } from 'next/server';
import { getAdminContext, hasPermission, unauthorized, forbidden, logServerActivity } from '@/lib/serverAuthz';
import {
    getStorageConfig, sniffMedia, validateKey, uploadObject, losslesslyOptimize,
    MAX_GALLERY_UPLOAD_BYTES, extFor,
} from '@/lib/objectStorage';
import { generateVideoThumbnail } from '@/lib/videoThumbnail';

export const dynamic = 'force-dynamic';

/** Approved upload namespaces for B2 object keys. */
const ALLOWED_PATHS = [
    'profiles',
    'avatars',
    'team_profiles',
    'gallery',
    'event-covers',
    'event-images',
    'resources',
    'resource-thumbnails',
] as const;

type AllowedPath = typeof ALLOWED_PATHS[number];

function isValidPath(path: string): path is AllowedPath {
    return ALLOWED_PATHS.includes(path as AllowedPath);
}

function sanitizeFilename(name: string): string {
    return name.replace(/[^\w.-]+/g, '-').slice(0, 80).replace(/^[.-]+/, '') || 'file';
}

/**
 * Admin media upload to Backblaze B2. Serves every approved namespace
 * (profiles, avatars, team_profiles, gallery, event-covers, event-images,
 * resources, resource-thumbnails).
 *
 * Auth: Firebase ID token required; caller must be an approved admin holding
 * the "gallery.manage" permission (CTO always qualifies). Enforcement is
 * server-side via serverAuthz — hiding UI is never the security boundary.
 *
 * Content is validated by magic bytes; the browser's MIME type is ignored.
 * Object keys are server-generated `<path>/<uuid>-<safeName><ext>` so an
 * upload can never overwrite another admin's object.
 *
 * Returns a private-bucket-safe delivery URL (/api/gallery/media?key=…).
 */
export async function POST(request: Request) {
    try {
        // Authentication + authorization (server-side; never client-checked).
        const ctx = await getAdminContext(request);
        if (!ctx) return unauthorized();
        // Ex-Core members may upload to profiles/avatars only (for their own public profile).
        const isExCore = ctx.role === 'ExCoreMember';
        if (!hasPermission(ctx, 'gallery.manage') && !isExCore) return forbidden('gallery.manage');

        const config = getStorageConfig();
        if (!config) {
            console.error('B2 environment variables not configured');
            return NextResponse.json({ error: 'Object storage is not configured. Set the B2_* environment variables (B2_S3_ENDPOINT, B2_REGION, B2_BUCKET_NAME, B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY) and restart the server.' }, { status: 503 });
        }

        const data = await request.formData();
        const file = data.get('file');
        const path = typeof data.get('path') === 'string' ? (data.get('path') as string) : '';

        // Ex-Core members may only upload to profiles/avatars (their own profile picture).
        if (ctx.role === 'ExCoreMember' && path !== 'profiles' && path !== 'avatars') {
            return NextResponse.json({ error: 'Ex-Core accounts may only upload to profiles/avatars.' }, { status: 403 });
        }

        if (!(file instanceof File)) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        // Validate namespace
        if (!isValidPath(path)) {
            return NextResponse.json({
                error: `Invalid upload path. Allowed: ${ALLOWED_PATHS.join(', ')}`
            }, { status: 400 });
        }

        // Validate file size (25MB limit)
        const MAX_UPLOAD_BYTES = MAX_GALLERY_UPLOAD_BYTES;
        if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
            return NextResponse.json({ error: `File must be between 1 byte and 25 MB. Maximum size is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` }, { status: 400 });
        }

        // Read and sniff real content — never trust the browser-provided type.
        const bytes = await file.arrayBuffer();
        const buf = Buffer.from(bytes);
        const sniffed = sniffMedia(buf, file.type);
        if (!sniffed) {
            return NextResponse.json({ error: 'Unsupported file content (jpg/png/gif/webp/avif/mp4/webm/pdf only).' }, { status: 400 });
        }

        // Lossless recompression where beneficial (same pipeline as gallery).
        const optimized = await losslesslyOptimize(buf, sniffed.contentType);

        // Server-generated, traversal-proof object key: {path}/{uuid}-{safeName}{ext}
        const safeName = sanitizeFilename(file.name.replace(/\.[^.]+$/, ''));
        const ext = extFor(optimized.contentType) || extFor(sniffed.contentType) || '.bin';
        const key = `${path}/${crypto.randomUUID()}-${safeName}${ext}`;
        if (!validateKey(key)) {
            return NextResponse.json({ error: 'Generated object key failed validation.' }, { status: 500 });
        }

        let videoThumbnailKey: string | undefined;
        if (sniffed.type === 'video') {
            try {
                const thumb = await generateVideoThumbnail(buf, sniffed.contentType);
                if (thumb) {
                    const thumbKey = `${path}/${crypto.randomUUID()}-${safeName}-thumb${thumb.ext}`;
                    if (validateKey(thumbKey)) {
                        await uploadObject(config, thumbKey, thumb.data, thumb.contentType);
                        videoThumbnailKey = thumbKey;
                    }
                }
            } catch (err) {
                // Thumbnail generation is best-effort; the video itself still uploads.
                console.warn('Video thumbnail generation skipped:', err);
            }
        }

        // Upload to B2
        await uploadObject(config, key, optimized.data, optimized.contentType);

        await logServerActivity(ctx.uid, ctx.name, 'Uploaded media', { namespace: path, contentType: optimized.contentType, key });

        // Return protected delivery URL
        const mediaUrl = `/api/gallery/media?key=${encodeURIComponent(key)}`;

        return NextResponse.json({ url: mediaUrl, key, ...(videoThumbnailKey ? { thumbnailKey: videoThumbnailKey } : {}) }, { status: 200 });

    } catch (error: any) {
        console.error('Media upload failed:', error);
        return NextResponse.json({ error: error?.message || 'Upload failed' }, { status: 500 });
    }
}
