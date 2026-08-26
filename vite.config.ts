import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function buildRevision(): string {
  const configured = process.env.VITE_REVISION ?? process.env.GITHUB_SHA;
  if (configured?.trim()) return configured.trim();
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "local-development";
  }
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";
  if (!trimmed.startsWith("/")) throw new Error("VITE_BASE_PATH must be an absolute path");
  return `${trimmed.replace(/\/+$/, "")}/`;
}

const revision = buildRevision();
const basePath = normalizeBasePath(process.env.VITE_BASE_PATH ?? "/");

function publicAssetPath(path: string): string {
  return `${basePath}${path.replace(/^\.\//, "")}`;
}

export default defineConfig({
  base: basePath,
  define: { __POCKETDEX_REVISION__: JSON.stringify(revision) },
  build: {
    target: "es2022",
  },
  plugins: [{
    name: "pocketdex-revision-manifest",
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          { tag: "link", attrs: { rel: "canonical", href: basePath }, injectTo: "head-prepend" },
          { tag: "meta", attrs: { name: "pocketdex-revision", content: revision }, injectTo: "head-prepend" },
        ],
      };
    },
    closeBundle() {
      writeFileSync(resolve("dist/revision.json"), `${JSON.stringify({ revision, basePath })}\n`, "utf8");

      const serviceWorkerPath = resolve("dist/sw.js");
      const serviceWorkerTemplate = readFileSync(resolve("public/sw.js"), "utf8");
      const serviceWorker = serviceWorkerTemplate
        .replaceAll('"__POCKETDEX_REVISION__"', JSON.stringify(revision))
        .replaceAll('"__POCKETDEX_BASE_PATH__"', JSON.stringify(basePath));
      if (serviceWorker.includes("__POCKETDEX_")) throw new Error("Service worker release tokens were not replaced");
      writeFileSync(serviceWorkerPath, serviceWorker, "utf8");

      const manifestPath = resolve("dist/manifest.webmanifest");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        start_url?: string;
        scope?: string;
        share_target?: { action?: string };
        icons?: Array<{ src?: string; [key: string]: unknown }>;
        [key: string]: unknown;
      };
      manifest.start_url = basePath;
      manifest.scope = basePath;
      if (manifest.share_target) manifest.share_target.action = basePath;
      if (manifest.icons) {
        manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: publicAssetPath(String(icon.src ?? "icon.svg")) }));
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    },
  }],
});
