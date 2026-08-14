import { readFile } from "node:fs/promises";
import path from "node:path";

export const projectRoot = path.resolve(import.meta.dirname, "..");

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function validateCatalog(catalog) {
  const errors = [];
  if (catalog?.schemaVersion !== 1) errors.push("catalog.schemaVersion must be 1");
  if (!Array.isArray(catalog?.datasets) || catalog.datasets.length === 0) {
    errors.push("catalog.datasets must be a non-empty array");
    return errors;
  }

  const ids = new Set();
  for (const [index, dataset] of catalog.datasets.entries()) {
    const label = `datasets[${index}]`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(dataset.id ?? "")) errors.push(`${label}.id must be kebab-case`);
    if (ids.has(dataset.id)) errors.push(`${label}.id must be unique`);
    ids.add(dataset.id);
    for (const key of ["title", "path", "description"]) {
      if (!dataset[key]) errors.push(`${label}.${key} is required`);
    }
    for (const key of ["provider", "url", "license", "retrievedAt", "notice"]) {
      if (!dataset.source?.[key]) errors.push(`${label}.source.${key} is required`);
    }
  }
  return errors;
}

export function validateFeatureCollection(collection, datasetId) {
  const errors = [];
  if (collection?.type !== "FeatureCollection") errors.push(`${datasetId}: type must be FeatureCollection`);
  if (!Array.isArray(collection?.features)) {
    errors.push(`${datasetId}: features must be an array`);
    return errors;
  }
  const ids = new Set();
  for (const [index, feature] of collection.features.entries()) {
    const label = `${datasetId}.features[${index}]`;
    if (feature?.type !== "Feature") errors.push(`${label}.type must be Feature`);
    if (feature?.geometry == null) errors.push(`${label}.geometry is required`);
    if (!feature?.properties?.type) errors.push(`${label}.properties.type is required`);
    if (feature?.id == null) errors.push(`${label}.id is required`);
    if (ids.has(feature?.id)) errors.push(`${label}.id must be unique within its dataset`);
    ids.add(feature?.id);
  }
  return errors;
}
