const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const EARTH_RADIUS_KM = 6371.0088;

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("ja");
}

function flattenValue(value) {
  if (Array.isArray(value)) return value.map(flattenValue).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(flattenValue).join(" ");
  return String(value ?? "");
}

function geometryBounds(geometry) {
  if (!geometry) return null;
  if (geometry.type === "GeometryCollection") {
    return mergeBounds(geometry.geometries.map(geometryBounds).filter(Boolean));
  }

  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  let found = false;
  const visit = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
      found = true;
      bounds[0] = Math.min(bounds[0], coordinates[0]);
      bounds[1] = Math.min(bounds[1], coordinates[1]);
      bounds[2] = Math.max(bounds[2], coordinates[0]);
      bounds[3] = Math.max(bounds[3], coordinates[1]);
      return;
    }
    coordinates.forEach(visit);
  };
  visit(geometry.coordinates);
  return found ? bounds : null;
}

function mergeBounds(items) {
  if (!items.length) return null;
  return items.reduce((result, bounds) => [
    Math.min(result[0], bounds[0]),
    Math.min(result[1], bounds[1]),
    Math.max(result[2], bounds[2]),
    Math.max(result[3], bounds[3])
  ]);
}

function boundsIntersect(left, right) {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function centerOf(bounds) {
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLon = radians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function asStringSet(value) {
  if (!value) return null;
  const items = Array.isArray(value) ? value : [value];
  return new Set(items.map(normalizeText));
}

function assertCoordinates(value, name, length) {
  if (!Array.isArray(value) || value.length !== length || value.some((number) => !Number.isFinite(number))) {
    throw new TypeError(`${name} must contain ${length} finite numbers`);
  }
}

function searchableText(feature, dataset) {
  const properties = feature.properties ?? {};
  const keys = dataset.searchProperties?.length ? dataset.searchProperties : Object.keys(properties);
  return normalizeText([
    feature.id,
    ...keys.map((key) => flattenValue(properties[key]))
  ].join(" "));
}

function relevanceScore(feature, dataset, tokens) {
  if (!tokens.length) return 0;
  const properties = feature.properties ?? {};
  const name = normalizeText(properties.name ?? properties.title);
  const text = searchableText(feature, dataset);
  if (!tokens.every((token) => text.includes(token))) return null;
  return tokens.reduce((score, token) => score + (name.includes(token) ? 10 : 1), 0);
}

export function searchFeatureCollections(datasets, options = {}) {
  if (!Array.isArray(datasets)) throw new TypeError("datasets must be an array");

  const tokens = normalizeText(options.q).split(/\s+/u).filter(Boolean);
  const datasetFilter = asStringSet(options.datasets);
  const typeFilter = asStringSet(options.types);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(options.limit ?? DEFAULT_LIMIT, 10) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number.parseInt(options.offset ?? 0, 10) || 0);
  const bbox = options.bbox ?? null;
  const near = options.near ?? null;
  if (bbox) assertCoordinates(bbox, "bbox", 4);
  if (bbox && (bbox[0] > bbox[2] || bbox[1] > bbox[3])) throw new RangeError("bbox min values must not exceed max values");
  if (near) assertCoordinates(near, "near", 2);
  const radiusKm = options.radiusKm == null ? null : Number(options.radiusKm);
  if (radiusKm != null && (!Number.isFinite(radiusKm) || radiusKm < 0)) {
    throw new RangeError("radiusKm must be a non-negative number");
  }
  if (radiusKm != null && !near) throw new TypeError("near is required when radiusKm is set");

  const matches = [];
  for (const item of datasets) {
    const { dataset, collection } = item;
    if (!dataset?.id || collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
      throw new TypeError("each dataset requires metadata and a GeoJSON FeatureCollection");
    }
    if (datasetFilter && !datasetFilter.has(normalizeText(dataset.id))) continue;

    for (const feature of collection.features) {
      if (feature?.type !== "Feature") continue;
      const type = feature.properties?.type;
      if (typeFilter && !typeFilter.has(normalizeText(type))) continue;
      const score = relevanceScore(feature, dataset, tokens);
      if (score == null) continue;
      const featureBounds = geometryBounds(feature.geometry);
      if (bbox && (!featureBounds || !boundsIntersect(featureBounds, bbox))) continue;
      const distanceKm = near && featureBounds ? haversineKm(near, centerOf(featureBounds)) : null;
      if (radiusKm != null && (distanceKm == null || distanceKm > radiusKm)) continue;

      matches.push({
        ...structuredClone(feature),
        appMapLayer: {
          datasetId: dataset.id,
          datasetTitle: dataset.title,
          source: structuredClone(dataset.source),
          score,
          ...(distanceKm == null ? {} : { distanceKm: Number(distanceKm.toFixed(3)) })
        }
      });
    }
  }

  matches.sort((left, right) => {
    if (near) return left.appMapLayer.distanceKm - right.appMapLayer.distanceKm;
    if (tokens.length) return right.appMapLayer.score - left.appMapLayer.score;
    return `${left.appMapLayer.datasetId}:${left.id ?? ""}`.localeCompare(`${right.appMapLayer.datasetId}:${right.id ?? ""}`);
  });

  return {
    type: "FeatureCollection",
    query: {
      q: options.q ?? "",
      datasets: datasetFilter ? [...datasetFilter] : null,
      types: typeFilter ? [...typeFilter] : null,
      bbox,
      near,
      radiusKm,
      limit,
      offset
    },
    total: matches.length,
    returned: Math.min(limit, Math.max(0, matches.length - offset)),
    features: matches.slice(offset, offset + limit)
  };
}

export { geometryBounds, haversineKm };
