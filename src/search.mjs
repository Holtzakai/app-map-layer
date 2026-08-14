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

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLon = radians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function pointOnSegment(point, start, end, tolerance = 1e-10) {
  const squaredLength = (end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2;
  if (squaredLength === 0) {
    return Math.abs(point[0] - start[0]) <= tolerance && Math.abs(point[1] - start[1]) <= tolerance;
  }
  const cross = (point[1] - start[1]) * (end[0] - start[0])
    - (point[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > tolerance) return false;
  const dot = (point[0] - start[0]) * (end[0] - start[0])
    + (point[1] - start[1]) * (end[1] - start[1]);
  if (dot < 0) return false;
  return dot <= squaredLength;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const start = ring[previous];
    const end = ring[index];
    if (pointOnSegment(point, start, end)) return true;
    const crosses = (end[1] > point[1]) !== (start[1] > point[1])
      && point[0] < ((start[0] - end[0]) * (point[1] - end[1])) / (start[1] - end[1]) + end[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, rings) {
  if (!rings?.length || !pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(point, hole));
}

function segmentDistanceMeters(point, start, end) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeScale = EARTH_RADIUS_KM * 1000;
  const longitudeScale = latitudeScale * Math.cos(radians(point[1]));
  const project = ([longitude, latitude]) => [
    radians(longitude - point[0]) * longitudeScale,
    radians(latitude - point[1]) * latitudeScale
  ];
  const [startX, startY] = project(start);
  const [endX, endY] = project(end);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const squaredLength = deltaX ** 2 + deltaY ** 2;
  if (squaredLength === 0) return Math.hypot(startX, startY);
  const ratio = Math.max(0, Math.min(1, -(startX * deltaX + startY * deltaY) / squaredLength));
  return Math.hypot(startX + ratio * deltaX, startY + ratio * deltaY);
}

function lineDistanceMeters(point, coordinates) {
  if (!coordinates?.length) return Infinity;
  if (coordinates.length === 1) return haversineKm(point, coordinates[0]) * 1000;
  let distance = Infinity;
  for (let index = 1; index < coordinates.length; index += 1) {
    distance = Math.min(distance, segmentDistanceMeters(point, coordinates[index - 1], coordinates[index]));
  }
  return distance;
}

function polygonDistanceMeters(point, rings) {
  if (pointInPolygon(point, rings)) return { spatialRelation: "contains", distanceMeters: 0 };
  const distanceMeters = Math.min(...(rings ?? []).map((ring) => lineDistanceMeters(point, ring)));
  return { spatialRelation: "nearby", distanceMeters };
}

function closestSpatialResult(results) {
  const valid = results.filter((result) => Number.isFinite(result?.distanceMeters));
  if (!valid.length) return null;
  return valid.reduce((closest, result) => {
    if (result.spatialRelation === "contains" && closest.spatialRelation !== "contains") return result;
    if (result.spatialRelation !== "contains" && closest.spatialRelation === "contains") return closest;
    return result.distanceMeters < closest.distanceMeters ? result : closest;
  });
}

function geometrySpatialRelation(geometry, point) {
  if (!geometry) return null;
  switch (geometry.type) {
    case "Point":
      return { spatialRelation: "nearby", distanceMeters: haversineKm(point, geometry.coordinates) * 1000 };
    case "MultiPoint":
      return closestSpatialResult(geometry.coordinates.map((coordinate) => ({
        spatialRelation: "nearby",
        distanceMeters: haversineKm(point, coordinate) * 1000
      })));
    case "LineString":
      return { spatialRelation: "nearby", distanceMeters: lineDistanceMeters(point, geometry.coordinates) };
    case "MultiLineString":
      return closestSpatialResult(geometry.coordinates.map((line) => ({
        spatialRelation: "nearby",
        distanceMeters: lineDistanceMeters(point, line)
      })));
    case "Polygon":
      return polygonDistanceMeters(point, geometry.coordinates);
    case "MultiPolygon":
      return closestSpatialResult(geometry.coordinates.map((polygon) => polygonDistanceMeters(point, polygon)));
    case "GeometryCollection":
      return closestSpatialResult(geometry.geometries.map((item) => geometrySpatialRelation(item, point)));
    default:
      return null;
  }
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
      const spatial = near ? geometrySpatialRelation(feature.geometry, near) : null;
      const distanceKm = spatial ? spatial.distanceMeters / 1000 : null;
      if (radiusKm != null && (distanceKm == null || distanceKm > radiusKm)) continue;

      matches.push({
        ...structuredClone(feature),
        appMapLayer: {
          datasetId: dataset.id,
          datasetTitle: dataset.title,
          source: structuredClone(dataset.source),
          score,
          ...(distanceKm == null ? {} : {
            spatialRelation: spatial.spatialRelation,
            distanceMeters: Math.round(spatial.distanceMeters),
            distanceKm: Number(distanceKm.toFixed(3))
          })
        }
      });
    }
  }

  matches.sort((left, right) => {
    if (near) {
      const leftContains = left.appMapLayer.spatialRelation === "contains";
      const rightContains = right.appMapLayer.spatialRelation === "contains";
      if (leftContains !== rightContains) return leftContains ? -1 : 1;
      return left.appMapLayer.distanceKm - right.appMapLayer.distanceKm;
    }
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

export function searchAtLocation(datasets, options = {}) {
  const longitude = Number(options.longitude ?? options.location?.[0]);
  const latitude = Number(options.latitude ?? options.location?.[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new TypeError("longitude and latitude are required");
  }
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new RangeError("longitude or latitude is outside the valid range");
  }
  const radiusMeters = Number(options.radiusMeters ?? 0);
  if (!Number.isFinite(radiusMeters) || radiusMeters < 0) {
    throw new RangeError("radiusMeters must be a non-negative number");
  }

  const result = searchFeatureCollections(datasets, {
    ...options,
    near: [longitude, latitude],
    radiusKm: radiusMeters / 1000
  });
  result.query = {
    longitude,
    latitude,
    radiusMeters,
    q: options.q ?? "",
    datasets: result.query.datasets,
    types: result.query.types,
    limit: result.query.limit,
    offset: result.query.offset
  };
  return result;
}

export { geometryBounds, geometrySpatialRelation, haversineKm };
