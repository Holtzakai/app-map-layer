import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "../src/client.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sourceCatalog = JSON.parse(await readFile(path.join(root, "data/catalog.json"), "utf8"));
const catalog = {
  ...sourceCatalog,
  datasets: sourceCatalog.datasets.map((dataset) => ({
    ...dataset,
    apiPath: `api/v1/datasets/${dataset.id}.geojson`
  }))
};

test("client loads the catalog and searches selected datasets", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.endsWith("catalog.json")) return Response.json(catalog);
    const dataset = catalog.datasets.find((item) => url.endsWith(item.apiPath));
    if (!dataset) return new Response("Not found", { status: 404 });
    const collection = JSON.parse(await readFile(path.join(root, "data", dataset.path), "utf8"));
    return Response.json(collection);
  };

  const client = await createClient({ baseUrl: "https://example.test/app-map-layer/", fetchImpl });
  const result = await client.searchAtLocation({
    longitude: 139.7588,
    latitude: 35.6824,
    radiusMeters: 0,
    q: "洪水",
    datasets: "sample-risk-zones"
  });

  assert.equal(result.total, 1);
  assert.equal(result.features[0].id, "sample-risk-001");
  assert.equal(result.features[0].appMapLayer.spatialRelation, "contains");
  assert.equal(requested.length, 2);
  assert.match(requested[0], /app-map-layer\/api\/v1\/catalog\.json$/u);
});
