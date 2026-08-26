import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

function normalizeBasePath(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed === "/") return "/";
  if (!trimmed.startsWith("/")) throw new Error("VITE_BASE_PATH must be an absolute path");
  return `${trimmed.replace(/\/+$/, "")}/`;
}

const dist = resolve(process.env.PAGES_DIST ?? "dist");
const basePath = normalizeBasePath(process.env.VITE_BASE_PATH ?? "/");
const expectedRevision = String(process.env.VITE_REVISION ?? process.env.GITHUB_SHA ?? "").trim();
const failures = [];

function fail(message) {
  failures.push(message);
}

function hasRootReferenceOutsideBase(content) {
  return [...content.matchAll(/(?:src|href)\s*=\s*["'](\/[^"']*)["']/g)]
    .some((match) => !match[1]?.startsWith(basePath));
}

async function mustRead(path, label) {
  try {
    return await readFile(path, "utf8");
  } catch {
    fail(`missing ${label}: ${path}`);
    return "";
  }
}

async function mustExist(path, label) {
  if (!path) return;
  try {
    await access(path);
  } catch {
    fail(`missing ${label}: ${path}`);
  }
}

function artifactPath(reference, sourcePath = basePath) {
  if (reference.startsWith("data:") || reference.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(reference)) return null;
  if (reference.startsWith("//")) return null;
  const url = new URL(reference, `https://artifact.invalid${sourcePath}`);
  if (url.origin !== "https://artifact.invalid") return null;
  if (!url.pathname.startsWith(basePath)) {
    fail(`root-path leakage or out-of-scope reference: ${reference}`);
    return null;
  }
  const relativePath = url.pathname.slice(basePath.length) || "index.html";
  return join(dist, relativePath);
}

await mustExist(join(dist, "index.html"), "index document");
await mustExist(join(dist, "manifest.webmanifest"), "manifest");
await mustExist(join(dist, "sw.js"), "service worker");
await mustExist(join(dist, "revision.json"), "revision metadata");

const index = await mustRead(join(dist, "index.html"), "index document");
const manifestText = await mustRead(join(dist, "manifest.webmanifest"), "manifest");
const serviceWorker = await mustRead(join(dist, "sw.js"), "service worker");
const revisionText = await mustRead(join(dist, "revision.json"), "revision metadata");

if (!index.includes(`rel="canonical" href="${basePath}"`)) fail(`canonical metadata is not rooted at ${basePath}`);
if (!index.includes(`name="pocketdex-revision" content="${expectedRevision}"`) && expectedRevision) fail("index revision metadata does not match the release revision");
if (basePath !== "/" && hasRootReferenceOutsideBase(index)) fail("index contains a root-path asset reference outside the Pages subpath");

for (const match of index.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
  const reference = match[1];
  if (!reference) continue;
  const path = artifactPath(reference);
  if (path) await mustExist(path, `referenced asset ${reference}`);
}

let manifest;
try {
  manifest = JSON.parse(manifestText);
} catch {
  fail("manifest is not valid JSON");
  manifest = {};
}
if (manifest.start_url !== basePath) fail(`manifest start_url must be ${basePath}`);
if (manifest.scope !== basePath) fail(`manifest scope must be ${basePath}`);
if (manifest.share_target?.action !== basePath) fail(`manifest share_target.action must be ${basePath}`);
for (const icon of manifest.icons ?? []) {
  if (typeof icon.src !== "string" || !icon.src.startsWith(basePath)) fail(`manifest icon is outside ${basePath}`);
  else await mustExist(artifactPath(icon.src), `manifest icon ${icon.src}`);
}

let revision;
try {
  revision = JSON.parse(revisionText);
} catch {
  fail("revision metadata is not valid JSON");
  revision = {};
}
if (!revision.revision) fail("revision metadata is empty");
if (expectedRevision && revision.revision !== expectedRevision) fail("revision metadata does not match the deployed commit");
if (revision.basePath !== basePath) fail(`revision metadata basePath must be ${basePath}`);
if (!serviceWorker.includes(`const RELEASE_REVISION = ${JSON.stringify(revision.revision)};`)) fail("service worker revision is not coherent with revision.json");
if (!serviceWorker.includes(`const BASE_PATH = ${JSON.stringify(basePath)};`)) fail("service worker base path is not coherent with the Pages subpath");
if (!serviceWorker.includes("pocketdex-shell-v3-")) fail("service worker cache version was not upgraded");

const allFiles = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else allFiles.push(path);
  }
}
await collect(dist);
for (const path of allFiles.filter((candidate) => /\.(?:html|js|css|webmanifest)$/.test(candidate))) {
  const content = await readFile(path, "utf8");
  if (basePath !== "/" && hasRootReferenceOutsideBase(content)) {
    fail(`root-path reference found in ${path}`);
  }
}

if (failures.length) {
  console.error("Pages artifact check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Pages artifact check passed for ${basePath} at revision ${revision.revision}.`);
