import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { geometrySpatialRelation, searchAtLocation, searchFeatureCollections } from "../src/search.mjs";

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

test("searches a location across polygons and nearby points", () => {
  const result = searchAtLocation(datasets, {
    longitude: 139.7588,
    latitude: 35.6824,
    radiusMeters: 100
  });
  assert.equal(result.total, 2);
  assert.equal(result.features[0].appMapLayer.spatialRelation, "contains");
  assert.equal(result.features.find((feature) => feature.id === "sample-shelter-001").appMapLayer.distanceMeters, 0);
});

test("uses polygon containment instead of distance to its center", () => {
  const relation = geometrySpatialRelation({
    type: "Polygon",
    coordinates: [[[130, 30], [140, 30], [140, 40], [130, 40], [130, 30]]]
  }, [139.99, 39.99]);
  assert.deepEqual(relation, { spatialRelation: "contains", distanceMeters: 0 });
});

test("respects polygon holes", () => {
  const relation = geometrySpatialRelation({
    type: "Polygon",
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
    ]
  }, [5, 5]);
  assert.equal(relation.spatialRelation, "nearby");
  assert.ok(relation.distanceMeters > 100000);
});

test("calculates distance to a line geometry", () => {
  const relation = geometrySpatialRelation({
    type: "LineString",
    coordinates: [[139.75, 35.68], [139.77, 35.68]]
  }, [139.76, 35.681]);
  assert.equal(relation.spatialRelation, "nearby");
  assert.ok(relation.distanceMeters > 100 && relation.distanceMeters < 120);
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
  assert.throws(() => searchAtLocation(datasets, { longitude: 200, latitude: 35 }), /range/);
});
