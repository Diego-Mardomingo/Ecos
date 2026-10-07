import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createSerwistRoute } from "@serwist/turbopack";

const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ?? crypto.randomUUID();

const CHUNK_RE = /static\/chunks\/[\w.-]+\.(?:js|css)/g;

/**
 * Chunks que no vale la pena precachear: los que solo usa el panel de admin (ningún jugador los
 * pide) y los polyfills `nomodule` (ningún navegador moderno los ejecuta). Eran ~350 KB de los
 * 2,2 MB que se bajaban al instalar el SW y tras cada despliegue (PDATA-12).
 *
 * Se calcula con los manifiestos del build: los de referencias de cliente de cada página dicen qué
 * chunks usa cada ruta. Si algo falla al leerlos, no se excluye nada (el precache queda como
 * antes, que es seguro).
 */
function chunksToSkip(): Set<string> {
  const skip = new Set<string>();
  try {
    const distDir = path.join(process.cwd(), ".next");
    const buildManifest = JSON.parse(
      fs.readFileSync(path.join(distDir, "build-manifest.json"), "utf-8")
    ) as { polyfillFiles?: string[] };
    for (const file of buildManifest.polyfillFiles ?? []) skip.add(path.posix.basename(file));

    const appDir = path.join(distDir, "server", "app");
    const usedByPlayers = new Set<string>();
    const usedByAdmin = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name === "page_client-reference-manifest.js") {
          const route = path.relative(appDir, dir).split(path.sep);
          const target = route.includes("admin") ? usedByAdmin : usedByPlayers;
          const text = fs.readFileSync(full, "utf-8");
          for (const match of text.matchAll(CHUNK_RE)) target.add(path.posix.basename(match[0]));
        }
      }
    };
    walk(appDir);
    for (const chunk of usedByAdmin) if (!usedByPlayers.has(chunk)) skip.add(chunk);
  } catch {
    return new Set();
  }
  return skip;
}

export const {
  dynamic,
  dynamicParams,
  revalidate,
  generateStaticParams,
  GET,
} = createSerwistRoute({
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
  manifestTransforms: [
    async (entries) => {
      const skip = chunksToSkip();
      return {
        manifest: entries.filter(
          (entry) =>
            !(entry.url.includes("static/chunks/") && skip.has(path.posix.basename(entry.url)))
        ),
        warnings: [],
      };
    },
  ],
});
