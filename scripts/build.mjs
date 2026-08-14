import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot, readJson, validateCatalog, validateFeatureCollection } from "./lib.mjs";

const dist = path.join(projectRoot, "dist");
const apiRoot = path.join(dist, "api/v1");
const datasetRoot = path.join(apiRoot, "datasets");
const catalog = await readJson(path.join(projectRoot, "data/catalog.json"));
const errors = validateCatalog(catalog);
const loaded = [];

for (const dataset of catalog.datasets ?? []) {
  const collection = await readJson(path.join(projectRoot, "data", dataset.path));
  errors.push(...validateFeatureCollection(collection, dataset.id));
  loaded.push({ dataset, collection });
}
if (errors.length) throw new Error(`Invalid data:\n${errors.map((error) => `- ${error}`).join("\n")}`);

await rm(dist, { recursive: true, force: true });
await mkdir(datasetRoot, { recursive: true });
await cp(path.join(projectRoot, "public"), dist, { recursive: true });
await mkdir(path.join(dist, "sdk"), { recursive: true });
await cp(path.join(projectRoot, "src/search.mjs"), path.join(dist, "sdk/search.mjs"));
await cp(path.join(projectRoot, "src/client.mjs"), path.join(dist, "sdk/client.js"));

const publicCatalog = {
  ...catalog,
  generatedAt: new Date().toISOString(),
  datasets: catalog.datasets.map(({ path: sourcePath, ...dataset }) => ({
    ...dataset,
    apiPath: `api/v1/datasets/${dataset.id}.geojson`
  }))
};
await writeFile(path.join(apiRoot, "catalog.json"), `${JSON.stringify(publicCatalog, null, 2)}\n`);

const allFeatures = [];
for (const { dataset, collection } of loaded) {
  await writeFile(path.join(datasetRoot, `${dataset.id}.geojson`), `${JSON.stringify(collection)}\n`);
  for (const feature of collection.features) {
    allFeatures.push({
      ...feature,
      appMapLayer: {
        datasetId: dataset.id,
        datasetTitle: dataset.title,
        source: dataset.source
      }
    });
  }
}
await writeFile(path.join(apiRoot, "all.geojson"), `${JSON.stringify({ type: "FeatureCollection", features: allFeatures })}\n`);
await writeFile(path.join(dist, ".nojekyll"), "");

console.log(`Built ${loaded.length} datasets and ${allFeatures.length} features into dist/.`);
