import path from "node:path";
import { projectRoot, readJson, validateCatalog, validateFeatureCollection } from "./lib.mjs";

const catalog = await readJson(path.join(projectRoot, "data/catalog.json"));
const errors = validateCatalog(catalog);

for (const dataset of catalog.datasets ?? []) {
  try {
    const collection = await readJson(path.join(projectRoot, "data", dataset.path));
    errors.push(...validateFeatureCollection(collection, dataset.id));
  } catch (error) {
    errors.push(`${dataset.id}: ${error.message}`);
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${catalog.datasets.length} datasets.`);
}
