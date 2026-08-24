import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const blockedPatterns = [
  /firebase-admin/i,
  /serviceAccount/i,
  /private[_-]?key/i,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i,
  /firebase storage/i,
  /cloud functions/i,
  /official pokemon/i,
];
const allowedExtensions = new Set([".ts", ".css", ".html", ".js", ".json", ".md", ".rules", ".webmanifest", ".svg", ".yml"]);

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["node_modules", ".git", "dist", "coverage"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (allowedExtensions.has(entry.name.includes(".") ? `.${entry.name.split(".").pop()}` : "")) files.push(path);
  }
  return files;
}

const violations = [];
for (const file of await filesIn(root)) {
  const content = await readFile(file, "utf8");
  for (const pattern of blockedPatterns) if (pattern.test(content)) violations.push(`${relative(root, file)} matches ${pattern}`);
}

if (violations.length) {
  console.error("Policy check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log("Policy check passed: no credentials, private service surfaces, or official media references found.");
