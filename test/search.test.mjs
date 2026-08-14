import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { searchFeatureCollections } from "../src/search.mjs";

const root = path.resolve(import.meta.dirname, "..");
const catalog = JSON.parse(await readFile(path.join(root, "data/catalog.json"), "utf8"));
const datasets = await Promise.all(catalog.datasets.map(async (dataset) => ({
  dataset,
  collection: JSON.parse(await readFile(path.join(root, "data", dataset.path), "utf8"))
})));

test("searches across multiple GeoJSON datasets and keeps provenance", () => {
  const result = searchFeatureCollections(datasets, { q: "洪水" });
  assert.equal(result.total, 2);
  assert.deepEqual(new Set(result.features.map((feature) => feature.appMapLayer.datasetId)), new Set(["sample-shelters", "sample-risk-zones"]));
  assert.equal(result.features[0].appMapLayer.source.license, "CC0-1.0");
});

test("filters by bbox and feature type", () => {
  const result = searchFeatureCollections(datasets, {
    bbox: [139.75, 35.676, 139.766, 35.687],
    types: "risk-zone"
  });
  assert.equal(result.total, 1);
  assert.equal(result.features[0].id, "sample-risk-001");
});

test("sorts by distance and applies a radius", () => {
  const result = searchFeatureCollections(datasets, {
    near: [139.7588, 35.6824],
    radiusKm: 0.1
  });
  assert.equal(result.total, 1);
  assert.equal(result.features[0].id, "sample-shelter-001");
  assert.equal(result.features[0].appMapLayer.distanceKm, 0);
});

test("paginates deterministically", () => {
  const first = searchFeatureCollections(datasets, { limit: 2 });
  const second = searchFeatureCollections(datasets, { limit: 2, offset: 2 });
  assert.equal(first.returned, 2);
  assert.equal(second.returned, 2);
  assert.notEqual(first.features[0].id, second.features[0].id);
});

test("rejects invalid spatial parameters", () => {
  assert.throws(() => searchFeatureCollections(datasets, { bbox: [1, 2, 3] }), /bbox/);
  assert.throws(() => searchFeatureCollections(datasets, { radiusKm: 1 }), /near/);
});
