import { searchAtLocation, searchFeatureCollections } from "./search.mjs";

function joinUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/$/u, "")}/${String(path).replace(/^\//u, "")}`;
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.json();
}

export async function createClient({ baseUrl = ".", fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  const catalog = await fetchJson(joinUrl(baseUrl, "api/v1/catalog.json"), fetchImpl);
  const cache = new Map();

  async function loadDataset(dataset) {
    if (!cache.has(dataset.id)) {
      cache.set(dataset.id, fetchJson(joinUrl(baseUrl, dataset.apiPath), fetchImpl));
    }
    return cache.get(dataset.id);
  }

  async function loadSelectedDatasets(options) {
    const selected = options.datasets
      ? new Set((Array.isArray(options.datasets) ? options.datasets : [options.datasets]).map(String))
      : null;
    const metadata = catalog.datasets.filter((dataset) => !selected || selected.has(dataset.id));
    return Promise.all(metadata.map(async (dataset) => ({
      dataset,
      collection: await loadDataset(dataset)
    })));
  }

  return {
    catalog,
    async search(options = {}) {
      const collections = await loadSelectedDatasets(options);
      return searchFeatureCollections(collections, options);
    },
    async searchAtLocation(options = {}) {
      const collections = await loadSelectedDatasets(options);
      return searchAtLocation(collections, options);
    }
  };
}
