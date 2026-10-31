import { execFile } from "child_process";
import { writeFileSync, unlinkSync, readFileSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

/**
 * Server-side video thumbnail generation using FFmpeg.
 *
 * Extracts a representative frame from a video buffer at ~1.5 seconds in
 * (or the first decodable frame if the video is shorter). Returns a JPEG
 * buffer suitable for uploading to B2.
 *
 * Security: uses execFile (no shell) with an array of arguments to prevent
 * command injection. Temp files are cleaned up in a finally block.
 */

const FFMPEG_TIMEOUT_MS = 30_000; // 30s max per thumbnail
const THUMBNAIL_WIDTH = 640; // reasonable width for gallery cards

/**
 * Generates a JPEG thumbnail from a video buffer.
 * Returns the JPEG bytes, or null if generation fails.
 */
export async function generateVideoThumbnail(
    videoBuffer: Buffer,
    contentType: string,
): Promise<{ data: Buffer; contentType: string; ext: string } | null> {
    const id = randomUUID();
    const tmpDir = tmpdir();
    const inputPath = join(tmpDir, `thumb-in-${id}${extForVideo(contentType)}`);
    const outputPath = join(tmpDir, `thumb-out-${id}.jpg`);

    try {
        // Write video to temp file
        writeFileSync(inputPath, videoBuffer);

        // Try at 1.5s first, fall back to 0.5s, then to first frame
        const timestamps = ["00:00:01.5", "00:00:00.5", "00:00:00"];
        for (const ts of timestamps) {
            const success = await runFfmpeg(inputPath, outputPath, ts);
            if (success && existsSync(outputPath)) {
                const data = readFileSync(outputPath);
                if (data.length > 0) {
                    return { data, contentType: "image/jpeg", ext: ".jpg" };
                }
            }
        }

        return null;
    } catch (error) {
        console.warn("Video thumbnail generation failed:", error);
        return null;
    } finally {
        // Clean up temp files
        try { if (existsSync(inputPath)) unlinkSync(inputPath); } catch {}
        try { if (existsSync(outputPath)) unlinkSync(outputPath); } catch {}
    }
}

/**
 * Runs FFmpeg to extract a single frame at the given timestamp.
 * Uses execFile (no shell) with explicit argument array — no injection risk.
 */
function runFfmpeg(inputPath: string, outputPath: string, timestamp: string): Promise<boolean> {
    return new Promise((resolve) => {
        const args = [
            "-y",                   // overwrite output
            "-ss", timestamp,       // seek to timestamp
            "-i", inputPath,        // input file
            "-vframes", "1",        // extract exactly 1 frame
            "-vf", `scale=${THUMBNAIL_WIDTH}:-2`, // scale width, preserve aspect ratio (-2 = even)
            "-q:v", "3",            // JPEG quality (2-5 is good)
            "-f", "image2",         // output format
            outputPath,
        ];

        const child = execFile("ffmpeg", args, {
            timeout: FFMPEG_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024, // 10MB stderr buffer
            windowsHide: true,
        }, (error, _stdout, stderr) => {
            if (error) {
                // FFmpeg returns non-zero for many non-fatal warnings;
                // only treat as failure if output file doesn't exist.
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

function extForVideo(contentType: string): string {
    switch (contentType) {
        case "video/mp4": return ".mp4";
        case "video/webm": return ".webm";
        case "video/quicktime": return ".mov";
        default: return ".mp4";
    }
}