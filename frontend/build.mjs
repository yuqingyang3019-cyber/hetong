import { cp, mkdir, readdir, rm, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");
const agentStatic = join(root, "..", "agent", "static");
const templateSchemaSrc = join(root, "..", "agent", "contract", "templates", "zhanweifu");
const templateSchemaDist = join(dist, "template-schemas");
const petiteVueSrc = join(root, "node_modules", "petite-vue", "dist", "petite-vue.es.js");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(src, dist, { recursive: true });
await copyFile(petiteVueSrc, join(dist, "petite-vue.es.js"));
await mkdir(templateSchemaDist, { recursive: true });

for (const fileName of await readdir(templateSchemaSrc)) {
  if (!fileName.endsWith(".placeholders.json")) continue;
  await cp(join(templateSchemaSrc, fileName), join(templateSchemaDist, fileName));
}

await rm(agentStatic, { recursive: true, force: true });
await mkdir(agentStatic, { recursive: true });
await cp(dist, agentStatic, { recursive: true });
