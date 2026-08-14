import { createClient } from "./sdk/client.js";

const form = document.querySelector("#search-form");
const query = document.querySelector("#query");
const longitude = document.querySelector("#longitude");
const latitude = document.querySelector("#latitude");
const radius = document.querySelector("#radius");
const currentLocation = document.querySelector("#use-current-location");
const locationStatus = document.querySelector("#location-status");
const count = document.querySelector("#result-count");
const results = document.querySelector("#results");

function renderFeature(feature) {
  const article = document.createElement("article");
  const heading = document.createElement("h3");
  heading.textContent = feature.properties?.name ?? feature.id ?? "名称なし";
  const meta = document.createElement("p");
  meta.className = "meta";
  const relation = feature.appMapLayer.spatialRelation === "contains"
    ? "この地点を含む"
    : `地点から約${feature.appMapLayer.distanceMeters.toLocaleString("ja-JP")}m`;
  meta.textContent = `${feature.appMapLayer.datasetTitle} · ${feature.properties?.type ?? "unknown"} · ${relation}`;
  const details = document.createElement("p");
  details.textContent = feature.properties?.notes ?? "説明はありません。";
  const source = document.createElement("p");
  source.className = "source";
  source.textContent = `出典: ${feature.appMapLayer.source.provider} / ${feature.appMapLayer.source.license}`;
  article.append(heading, meta, details, source);
  return article;
}

function locationOptions() {
  return {
    longitude: Number(longitude.value),
    latitude: Number(latitude.value),
    radiusMeters: Number(radius.value),
    q: query.value,
    limit: 100
  };
}

function render(result) {
  count.textContent = `${result.total} 件`;
  results.replaceChildren(...result.features.map(renderFeature));
  if (!result.features.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "一致するデータがありません。";
    results.append(empty);
  }
}

try {
  const client = await createClient({ baseUrl: "." });
  render(await client.searchAtLocation(locationOptions()));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      render(await client.searchAtLocation(locationOptions()));
    } catch (error) {
      count.textContent = "検索失敗";
      results.textContent = error.message;
    }
  });
  currentLocation.addEventListener("click", () => {
    if (!navigator.geolocation) {
      locationStatus.textContent = "このブラウザは現在地取得に対応していません。";
      return;
    }
    locationStatus.textContent = "現在地を取得しています…";
    navigator.geolocation.getCurrentPosition(async (position) => {
      longitude.value = position.coords.longitude.toFixed(6);
      latitude.value = position.coords.latitude.toFixed(6);
      locationStatus.textContent = `現在地を設定しました（精度 約${Math.round(position.coords.accuracy)}m）。`;
      render(await client.searchAtLocation(locationOptions()));
    }, (error) => {
      locationStatus.textContent = `現在地を取得できませんでした: ${error.message}`;
    }, { enableHighAccuracy: true, timeout: 10000 });
  });
} catch (error) {
  count.textContent = "読み込み失敗";
  results.textContent = error.message;
}
