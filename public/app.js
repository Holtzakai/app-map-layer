import { createClient } from "./sdk/client.js";

const form = document.querySelector("#search-form");
const query = document.querySelector("#query");
const count = document.querySelector("#result-count");
const results = document.querySelector("#results");

function renderFeature(feature) {
  const article = document.createElement("article");
  const heading = document.createElement("h3");
  heading.textContent = feature.properties?.name ?? feature.id ?? "名称なし";
  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = `${feature.appMapLayer.datasetTitle} · ${feature.properties?.type ?? "unknown"}`;
  const details = document.createElement("p");
  details.textContent = feature.properties?.notes ?? "説明はありません。";
  const source = document.createElement("p");
  source.className = "source";
  source.textContent = `出典: ${feature.appMapLayer.source.provider} / ${feature.appMapLayer.source.license}`;
  article.append(heading, meta, details, source);
  return article;
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
  render(await client.search());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    render(await client.search({ q: query.value, limit: 100 }));
  });
} catch (error) {
  count.textContent = "読み込み失敗";
  results.textContent = error.message;
}
