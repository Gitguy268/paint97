// App-side binding for the committed models/manifest.json (written by
// scripts/prepare-model.mjs). Loaded with Vite's `?raw` so the unit tests —
// which run under plain Node type-stripping — never have to import JSON;
// the string is parsed once here, at module scope, in the browser.
import raw from "../../../models/manifest.json?raw";
import { validateManifest, type ModelManifest, type PartCache } from "./model";

export const MODEL_MANIFEST = JSON.parse(raw) as ModelManifest;

const invalid = validateManifest(MODEL_MANIFEST);
if (invalid) throw new Error(`models/manifest.json is invalid: ${invalid}`);

// One Cache Storage bucket per model revision, keyed by the whole-file hash:
// publishing a new quantization gets its own bucket instead of colliding,
// and the installer prunes buckets it no longer owns.
export const MODEL_CACHE_NAME = `paint97-model-${MODEL_MANIFEST.sha256.slice(0, 8)}`;

export const openModelCache = (): Promise<PartCache> => caches.open(MODEL_CACHE_NAME);

/** Drop model caches from older revisions (each holds ~253 MB). */
export async function pruneModelCaches(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((n) => n.startsWith("paint97-model-") && n !== MODEL_CACHE_NAME)
      .map((n) => caches.delete(n)),
  );
}
