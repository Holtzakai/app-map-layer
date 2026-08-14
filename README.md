# app-map-layer

緯度・経度で指定した地点に関係する情報を、複数の GeoJSON データセットから出典情報を保ったまま横断検索するための小さな静的 API です。GitHub Pages のようなサーバー処理のない環境で動作します。

> [!IMPORTANT]
> リポジトリ内のデータは動作確認用の架空サンプルです。実際の避難・防災判断には使用できません。

## コア機能

- 指定地点を含む Polygon / MultiPolygon の横断検索
- 指定地点から一定距離内にある Point / Line 系 geometry の横断検索
- キーワード、データセット、feature 種別による追加の絞り込み
- 検索結果にデータセット単位の出典・ライセンス・取得日を付与
- GitHub Pages から配信できる静的 JSON API と JavaScript SDK の生成

地図への重ね合わせはストレッチゴールです。検索結果は標準の `FeatureCollection` なので、MapLibre GL JS 等へそのまま渡せます。

## API

ビルド後、次の静的エンドポイントを利用できます。

| パス | 内容 |
| --- | --- |
| `api/v1/catalog.json` | データセット一覧と provenance |
| `api/v1/all.geojson` | 全データセットを結合した FeatureCollection |
| `api/v1/datasets/{id}.geojson` | データセットごとの GeoJSON |

GitHub Pages は動的な HTTP API を実行できないため、検索処理は SDK がブラウザ内で行います。

```js
import { createClient } from "./sdk/client.js";

const client = await createClient({ baseUrl: "." });
const result = await client.searchAtLocation({
  longitude: 139.7588,
  latitude: 35.6824,
  radiusMeters: 1000,
  q: "洪水", // 任意の追加フィルター
  limit: 20
});
```

返却値は GeoJSON `FeatureCollection` です。各 feature の `appMapLayer` に `datasetId`、出典、ライセンス、地点との関係が入ります。

| `appMapLayer` | 意味 |
| --- | --- |
| `spatialRelation: "contains"` | 指定地点が Polygon / MultiPolygon 内にある |
| `spatialRelation: "nearby"` | geometry が指定半径内にある |
| `distanceMeters` | 地点からgeometryまでの最短距離。内包時は `0` |

従来の `client.search()` は地点を使わないキーワード・bbox検索用の補助機能として残しています。

## データセットの追加

1. `data/datasets/` に GeoJSON `FeatureCollection` を置く
2. `data/catalog.json` にデータセットと出典情報を追加する
3. `npm run verify` を実行する

カタログの `source` では最低限、提供者、原典 URL、ライセンス、取得日を管理します。自治体由来データなどで原作成者が別の場合は `originalAuthority` も記録します。

## 開発

Node.js 22 以上を使用します。外部パッケージは不要です。

```sh
npm run verify
```

生成物は `dist/` に出力されます。ローカル確認時は任意の静的ファイルサーバーで `dist/` を配信してください。

## 公開時の注意

- データセットごとの利用規約と再配布条件を必ず確認する
- 加工データには加工主体と加工内容を明示する
- 更新日時、欠落可能性、災害種別など原典の注意事項を検索結果でも失わない
- 公的機関による推奨・保証と誤認させない
- 最新の避難指示や開設状況を表すものとして静的データを提示しない

ソースコードは MIT License です。収録データのライセンスは各データセットの `source.license` に従います。
