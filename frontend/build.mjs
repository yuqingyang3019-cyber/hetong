import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");
const packageJson = join(root, "package.json");
const packageLock = join(root, "package-lock.json");
const templateSchemaSrc = join(root, "..", "agent", "contract", "templates", "zhanweifu");
const templateSchemaDist = join(dist, "template-schemas");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(src, dist, { recursive: true });
await cp(packageJson, join(dist, "package.json"));
await cp(packageLock, join(dist, "package-lock.json"));
await mkdir(templateSchemaDist, { recursive: true });

for (const fileName of await readdir(templateSchemaSrc)) {
  if (!fileName.endsWith(".placeholders.json")) continue;
  await cp(join(templateSchemaSrc, fileName), join(templateSchemaDist, fileName));
}
