// ESM resolve hook mapping the app's "@/path" TypeScript alias onto /src/path.
// Used by node --test files that import app modules directly (no bundler).
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));

export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
        const rel = specifier.slice(2);
        // Try the exact path, then TypeScript/JS extensions, then /index file.
        const candidates = [rel, `${rel}.ts`, `${rel}.tsx`, `${rel}.js`, `${rel}/index.ts`];
        for (const candidate of candidates) {
            const abs = srcRoot + candidate;
            if (existsSync(abs) && statSync(abs).isFile()) {
                return nextResolve(pathToFileURL(abs).href, {
                    ...context,
                    parentURL: context?.parentURL,
                });
            }
        }
    }
    return nextResolve(specifier, context);
}
