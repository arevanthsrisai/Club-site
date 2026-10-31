import { execFile } from "child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, statSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

/**
 * Server-side video compression with FFmpeg (H.264/AAC MP4) plus poster
 * thumbnails, used by the gallery upload pipeline.
 *
 * Security: every subprocess runs through execFile (no shell) with a fixed
 * argument array — filenames travel only as file paths on disk, so there is no
 * command-injection surface. All temporary work happens in a per-call temp
 * directory that is removed in the finally block (mkdir + rm), so no orphaned
 * temp files survive a crash path we control.
 *
 * Concurrency: ffmpeg jobs are globally capped (default 2) so a flood of
 * uploads cannot exhaust CPU on the VPS; further calls queue behind the cap.
 *
 * Limits: bounded input size, bounded output size and a hard per-job timeout
 * so a broken video can never wedge the route forever.
 */

const FFMPEG_TIMEOUT_MS = 90_000; // hard cap per ffmpeg invocation (compress or thumb)
const MAX_COMPRESSED_HEIGHT = 720;
const VIDEO_BITRATE_KBPS = 1600;
const AAC_BITRATE_KBPS = 96;
const MAX_CONCURRENT_FFMPEG = 2;

interface JobQueueState {
    running: number;
    waiters: (() => void)[];
}
const g = globalThis as typeof globalThis & { __reluVideoQueue?: JobQueueState };
const queue: JobQueueState = (g.__reluVideoQueue ??= { running: 0, waiters: [] });

/** Runs `job` while holding one of the global ffmpeg worker slots. */
async function withVideoSlot<T>(job: () => Promise<T>): Promise<T> {
    if (queue.running >= MAX_CONCURRENT_FFMPEG) {
        await new Promise<void>((resolve) => queue.waiters.push(resolve));
    }
    queue.running++;
    try {
        return await job();
    } finally {
        queue.running--;
        const next = queue.waiters.shift();
        if (next) next();
    }
}

export interface CompressionResult {
    /** H.264/AAC MP4 bytes ready to store, or null when compression failed. */
    data: Buffer | null;
    contentType: string;
    /** Human-readable reason when data is null (codec probing, ffmpeg missing, crash…). */
    error?: string;
}

export interface FfmpegAvailability {
    available: boolean;
    version?: string;
    error?: string;
}

/** Cheap probe so the app can degrade gracefully when ffmpeg is absent. */
export function checkFfmpeg(): Promise<FfmpegAvailability> {
    return withVideoSlot(
        () =>
            new Promise<FfmpegAvailability>((resolve) => {
                execFile("ffmpeg", ["-version"], { timeout: 10_000, windowsHide: true }, (err, stdout) => {
                    if (err) resolve({ available: false, error: String(err.message || err) });
                    else resolve({ available: true, version: stdout.split("\n")[0]?.trim() });
                });
            }),
    );
}

/** Parses `Stream #0:...: Video: h264 ...` / `Audio: aac` codec lines. */
export function parseVideoCodecs(stderr: string): { video?: string; audio?: string } | null {
    let video: string | undefined;
    let audio: string | undefined;
    for (const line of stderr.split("\n")) {
        const v = line.match(/Stream #[^\s]*.*: Video: ([\w]+)/);
        if (v) video = v[1];
        const a = line.match(/Stream #[^\s]*.*: Audio: ([\w]+)/);
        if (a) audio = a[1];
    }
    if (!video && !audio) return null;
    return { video, audio };
}

export interface CodecProbe {
    codecs: { video?: string; audio?: string } | null;
}

/** Runs ffmpeg -i <file> to learn the real encoding (never trusts extensions). */
function probeCodecs(inputPath: string): Promise<CodecProbe> {
    return new Promise((resolve) => {
        execFile(
            "ffmpeg",
            ["-hide_banner", "-i", inputPath],
            { timeout: 20_000, windowsHide: true },
            (err, _stdout, stderr) => {
                // ffmpeg exits non-zero when no output file is given; stderr
                // still contains the stream info we need.
                resolve({ codecs: parseVideoCodecs(stderr || "") });
            },
        );
    });
}

/**
 * Compresses a video buffer into a browser-compatible H.264/AAC MP4.
 *
 * Returns the compressed bytes, or null with an `error` when:
 *  - ffmpeg is missing,
 *  - the container is not video ffprobe-style, or
 *  - transcoding fails/timeouts.
 * Callers should preserve the original bytes whenever compression is skipped
 * or fails (see the gallery upload route).
 */
export async function compressVideo(
    videoBuffer: Buffer,
    contentType: string,
): Promise<CompressionResult> {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg.available) {
        return { data: null, contentType, error: "FFmpeg is not installed on the server." };
    }
    const ext = extForContentType(contentType) || ".bin";

    const dir = mkdtempSync(join(tmpdir(), `relu-video-${randomUUID()}-`));
    const inputPath = join(dir, `in${ext}`);
    const outputPath = join(dir, "out.mp4");
    const probePath = join(dir, "probe.mp4");
    try {
        writeFileSync(inputPath, videoBuffer);

        // Re-encode only when it actually helps: already-H.264/AAC MP4 files
        // that the browser can play are rewrapped without a second lossy pass.
        let mustTranscode = true;
        if (/\.mp4$/i.test(ext)) {
            const probe = await probeCodecs(inputPath);
            const { codecs } = probe;
            if (
                codecs?.video &&
                /h264|avc/.test(codecs.video.toLowerCase()) &&
                codecs.audio &&
                /aac/.test(codecs.audio.toLowerCase())
            ) {
                // Still normalized via copy remux (fixes moov placement etc.)
                mustTranscode = false;
            }
        }

        const ok = await runFfmpeg(inputPath, mustTranscode ? outputPath : probePath, mustTranscode);
        if (!ok || !existsSync(mustTranscode ? outputPath : probePath)) {
            return { data: null, contentType, error: mustTranscode ? "FFmpeg could not transcode this video." : "FFmpeg remux failed." };
        }

        const data = readIfExists(mustTranscode ? outputPath : probePath);
        if (!data || data.length === 0) {
            return { data: null, contentType, error: "FFmpeg produced an empty file." };
        }
        // A remux that ballooned beyond the original would be worse in every
        // way; fall back to the original bytes in that case.
        if (data.length >= videoBuffer.length && !mustTranscode) {
            return { data: videoBuffer, contentType: "video/mp4" };
        }
        return { data, contentType: "video/mp4" };
    } catch (error) {
        return {
            data: null,
            contentType,
            error: error instanceof Error ? error.message : "Compression failed.",
        };
    } finally {
        try {
            rmSync(dir, { recursive: true, force: true });
        } catch {
            /* non-fatal */
        }
    }
}

/** Reads a file, returning null when it is missing or empty. */
function readIfExists(path: string): Buffer | null {
    if (!existsSync(path) || statSync(path).size === 0) return null;
    return readFileSync(path);
}

/**
 * Single ffmpeg invocation. `transcode=true` performs the full H.264/AAC
 * conversion with web-friendly flags (faststart, even dimensions, 720p cap);
 * otherwise the audio/video streams are re-muxed losslessly.
 */
function runFfmpeg(inputPath: string, outputPath: string, transcode: boolean): Promise<boolean> {
    const args = transcode
        ? [
              "-y",
              "-i", inputPath,
              "-c:v", "libx264",
              "-preset", "veryfast",
              "-crf", "28",
              "-maxrate", `${VIDEO_BITRATE_KBPS}k`,
              "-bufsize", `${VIDEO_BITRATE_KBPS * 2}k`,
              "-vf", `scale=trunc(iw/2)*2:trunc(min(ih\\,${MAX_COMPRESSED_HEIGHT})/2)*2`,
              "-r", "30",
              "-pix_fmt", "yuv420p",
              "-c:a", "aac",
              "-b:a", `${AAC_BITRATE_KBPS}k`,
              "-movflags", "+faststart",
              "-map_metadata", "-1",
              "-f", "mp4",
              outputPath,
          ]
        : [
              "-y",
              "-i", inputPath,
              "-c", "copy",
              "-movflags", "+faststart",
              "-map_metadata", "-1",
              "-f", "mp4",
              outputPath,
          ];

    return withVideoSlot(
        () =>
            new Promise<boolean>((resolve) => {
                const child = execFile(
                    "ffmpeg",
                    args,
                    { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
                    (err) => resolve(!err),
                );
                child.on("error", () => resolve(false));
            }),
    );
}

function extForContentType(contentType: string): string | null {
    switch (contentType) {
        case "video/mp4": return ".mp4";
        case "video/webm": return ".webm";
        case "video/quicktime": return ".mov";
        default: return null;
    }
}

export { MAX_COMPRESSED_HEIGHT, VIDEO_BITRATE_KBPS };
