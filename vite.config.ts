import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
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

const revision = buildRevision();

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  define: { __POCKETDEX_REVISION__: JSON.stringify(revision) },
  build: {
    target: "es2022",
  },
  plugins: [{
    name: "pocketdex-revision-manifest",
    closeBundle() {
      writeFileSync(resolve("dist/revision.json"), `${JSON.stringify({ revision })}\n`, "utf8");
    },
  }],
});
