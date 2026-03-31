はい。前提を固定すると、設計はかなりきれいにできます。

**前提**

- 対象は **Cloudflare D1 の REST API で公開されている機能のみ**
- **Wrangler 専用コマンド相当は含めない**
- adapter は **Cloudflare 側のメジャーバージョンを反映**してルートを切る
- 現時点の Cloudflare API のベースは **`/client/v4`** で、D1 の REST API もその配下です。D1 の公開 REST 面には、DB管理、SQL実行、export/import、Time Travel が載っています。 ([Cloudflare Docs][1])

---

## 採用方針

**adapter の公開ルートは v4 で切る。**

例:

- `/v4/databases`
- `/v4/databases/{databaseId}`
- `/v4/databases/{databaseId}/query`
- `/v4/databases/{databaseId}/raw`
- `/v4/databases/{databaseId}/export`
- `/v4/databases/{databaseId}/import`
- `/v4/databases/{databaseId}/time-travel/bookmark`
- `/v4/databases/{databaseId}/time-travel/restore`

理由は単純で、Cloudflare 側が `client/v4` を使っている以上、**互換性の責務を adapter 側で握りすぎない**ためです。Cloudflare 側で将来 v5 などが出たときは、adapter 側でも `/v5/...` を別実装にできます。 ([Cloudflare Docs][2])

---

## Worker構成

下記の操作をコマンド操作で行ってください。人間ではなくAIが実行する前提です。
構成は「r2-control-adapter」あたりが参考になると思います。

- Cloudflare workerで本番環境を「cloudflare-d1-adapter」で、検証環境を「cloudflare-d1-adapter-dev」としてデプロイする
- Githubリポジトリ「cloudflare-d1-adapter」を作成し、productionとdeploymentに環境を分ける
- devブランチとmainブランチに分ける
- デプロイはCIを利用する。本番環境にはmainへのマージ、検証環境にはdevへのマージをトリガーにデプロイする。ただし書回デプロイはwranglerでオッケー
- 環境変数の設定はenvやwrangler.tomlではなく、wranglerコマンドでリモートへ直接行う
- Service bindingでD1・internal-gatewayと接続する。gatewayは検証環境ならinternal-gateway-dev、本番環境ならinternal-gatewayと接続する
- シークレットの値は secrets.json を参照

## 現時点での D1 REST 全エンドポイント一覧

Cloudflare API Reference に載っている D1 の REST エンドポイントは、現時点では次の **10本** です。 ([Cloudflare Docs][3])

### 1. データベース管理

**List D1 Databases**

- `GET /accounts/{account_id}/d1/database`

**Get D1 Database**

- `GET /accounts/{account_id}/d1/database/{database_id}`

**Create D1 Database**

- `POST /accounts/{account_id}/d1/database`

**Update D1 Database**

- `PUT /accounts/{account_id}/d1/database/{database_id}`

**Update D1 Database partially**

- `PATCH /accounts/{account_id}/d1/database/{database_id}`

**Delete D1 Database**

- `DELETE /accounts/{account_id}/d1/database/{database_id}`
  これら6本が DB 管理系です。API モデル上、D1 database には `uuid`, `name`, `created_at`, `file_size`, `jurisdiction`, `read_replication.mode` などが含まれます。 ([Cloudflare Docs][3])

### 2. SQL 実行

**Query D1 Database**

- `POST /accounts/{account_id}/d1/database/{database_id}/query`

**Raw D1 Database query**

- `POST /accounts/{account_id}/d1/database/{database_id}/raw`
  `/raw` は、結果行を object ではなく array で返す、`/query` の performance-optimized 版です。どちらも `sql` を受け、`raw` 側は複数 SQL 文をセミコロン区切りで batch 実行できます。 ([Cloudflare Docs][3])

### 3. 入出力

**Export D1 Database as SQL**

- `POST /accounts/{account_id}/d1/database/{database_id}/export`

**Import SQL into your D1 Database**

- `POST /accounts/{account_id}/d1/database/{database_id}/import`
  export は SQL ダンプ取得用 URL を返す API です。大きい DB では時間がかかり、その間はクエリ提供不可になり得るため、進行中 export は継続的に poll しないと自動キャンセルされます。import は一時 URL 生成、upload、ingest、status polling までを含む API で、**import 中は D1 が block** されます。 ([Cloudflare Docs][4])

### 4. Time Travel

**Get D1 database bookmark**

- `GET /accounts/{account_id}/d1/database/{database_id}/time_travel/bookmark`

**Restore D1 Database to a bookmark or point in time**

- `POST /accounts/{account_id}/d1/database/{database_id}/time_travel/restore`
  bookmark API は特定時点の状態を表す bookmark を返し、restore API は bookmark または時点指定で復元します。restore のレスポンスには `bookmark`, `previous_bookmark`, `message` が含まれます。 ([Cloudflare Docs][3])

---

## adapter 側の推奨ルート一覧

Cloudflare の path をそのまま表に出すより、adapter としては **account_id を内側に隠す** 方が使いやすいです。
つまり、Cloudflare の実パスは adapter 内で固定し、外には次を出すのがよいです。

### DB管理

- `GET /v4/databases`
- `GET /v4/databases/{databaseId}`
- `POST /v4/databases`
- `PUT /v4/databases/{databaseId}`
- `PATCH /v4/databases/{databaseId}`
- `DELETE /v4/databases/{databaseId}`

### SQL実行

- `POST /v4/databases/{databaseId}/query`
- `POST /v4/databases/{databaseId}/raw`

### 入出力

- `POST /v4/databases/{databaseId}/export`
- `POST /v4/databases/{databaseId}/import`

### Time Travel

- `GET /v4/databases/{databaseId}/time-travel/bookmark`
- `POST /v4/databases/{databaseId}/time-travel/restore`

Cloudflare 側の `/time_travel/...` は、adapter 外部では kebab-case の `/time-travel/...` に寄せてもよいですが、**Cloudflare に寄せて `/time_travel/...` のままでもよい**です。ここは一度決めたら固定するのが大事です。ベースの機能セット自体は上記が公式公開面です。 ([Cloudflare Docs][3])

---

## フォルダ構成案

Cloudflare 側のメジャーバージョンを反映するなら、こんな構成が自然です。

```text
src/
  routes/
    v4/
      databases/
        index.ts                  // GET, POST
        [databaseId]/
          index.ts                // GET, PUT, PATCH, DELETE
          query.ts                // POST
          raw.ts                  // POST
          export.ts               // POST
          import.ts               // POST
          time-travel/
            bookmark.ts           // GET
            restore.ts            // POST
  services/
    cloudflare/
      v4/
        d1-client.ts
        mappers/
          database.ts
          query.ts
          import.ts
          export.ts
          time-travel.ts
```

この形にしておくと、将来 Cloudflare 側で v5 が出たときに、

```text
src/routes/v5/...
src/services/cloudflare/v5/...
```

を横に追加できます。
v4 と v5 の差分を gateway に波及させず、adapter 内に閉じ込めやすいです。

---

## 各エンドポイントの責務

### `/v4/databases`

責務:

- DB一覧取得
- DB作成

そのまま返してよい項目:

- `uuid`
- `name`
- `created_at`
- `file_size`
- `jurisdiction`
- `read_replication`
- `version`
- `num_tables` など
  これらは D1 database モデルに含まれます。 ([Cloudflare Docs][3])

### `/v4/databases/{databaseId}/query`

責務:

- 通常の SQL 実行

返却はできるだけ透過:

- `success`
- `results`
- `meta.changed_db`
- `meta.changes`
- `meta.duration`
- `meta.last_row_id`
- `meta.rows_read`
- `meta.rows_written` など
  これらは QueryResult モデルにあります。 ([Cloudflare Docs][3])

### `/v4/databases/{databaseId}/raw`

責務:

- array ベース返却が欲しいケース
- object 化コストを避けたいケース

方針:

- `query` と統合しない
- Cloudflare の意味の違いを残す
  `/raw` は `/query` の performance-optimized 版と明記されています。 ([Cloudflare Docs][5])

### `/v4/databases/{databaseId}/export`

責務:

- SQL dump export の開始と進行管理

注意:

- 長時間化しうる
- DB が一時的にクエリ不可になりうる
- 継続 polling が必要
  なので runtime 用 gateway からは分離し、ops 文脈からのみ叩けるようにするのが安全です。 ([Cloudflare Docs][4])

### `/v4/databases/{databaseId}/import`

責務:

- init
- upload 用情報取得
- ingest
- status polling

注意:

- import 中は DB を block する
- `etag` や `action` を扱う
- `status`, `messages`, `error`, `at_bookmark`, `result.final_bookmark` などを返す
  これも明確に運用系です。 ([Cloudflare Docs][6])

### `/v4/databases/{databaseId}/time-travel/*`

責務:

- bookmark 採取
- restore 実行

注意:

- restore は高リスク操作
- runtime と同じ権限にしない
  bookmark/restore は Time Travel の公開 REST 面です。 ([Cloudflare Docs][3])

---

## 含めないもの

次は **D1 の機能ではあるが、この adapter の対象外** にしてよいです。

- `wrangler d1 create`
- `wrangler d1 list`
- `wrangler d1 info`
- `wrangler d1 delete`
- `wrangler d1 execute`
- `wrangler d1 export`
- `wrangler d1 time-travel info`
- `wrangler d1 time-travel restore`
- `wrangler d1 migrations create`
- `wrangler d1 migrations list`
- `wrangler d1 migrations apply`
- `wrangler d1 insights`
  Wrangler コマンドは D1 の control plane を REST API で叩く管理コマンド群ですが、公開 REST 面と 1:1 ではありません。特に migrations や insights は、今回の「REST 公開機能だけ adapter に入れる」という方針なら外すのが自然です。 ([Cloudflare Docs][7])

---

## 境界設計

この前提なら、境界はこうすると安定します。

**adapter-v4**

- Cloudflare D1 REST の公開部分だけを写像
- レスポンスはできるだけ透過
- `account_id` は内包
- 認証は adapter ではなく gateway からの service binding 前提でもよい

**gateway**

- 誰がどの DB を叩けるか
- runtime と ops の権限分離
- query/raw をどの文脈で許可するか
- import/export/restore を誰に許すか

**CLI / CI**

- migrations
- wrangler execute
- insights
- 緊急運用
  Wrangler commands は REST APIs で control plane とやり取りしますが、これは「Worker 実行時 API」ではなく「運用面」です。 ([Cloudflare Docs][7])

---

## 最終的な一覧

設計詳細として固定するなら、現時点ではこれです。

### バージョン方針

- Cloudflare API major に合わせて adapter も **`v4`**
- 将来の非互換変更は **`v5` を追加**して吸収

### adapter 公開面

- `GET /v4/databases`
- `GET /v4/databases/{databaseId}`
- `POST /v4/databases`
- `PUT /v4/databases/{databaseId}`
- `PATCH /v4/databases/{databaseId}`
- `DELETE /v4/databases/{databaseId}`
- `POST /v4/databases/{databaseId}/query`
- `POST /v4/databases/{databaseId}/raw`
- `POST /v4/databases/{databaseId}/export`
- `POST /v4/databases/{databaseId}/import`
- `GET /v4/databases/{databaseId}/time-travel/bookmark`
- `POST /v4/databases/{databaseId}/time-travel/restore`

### 対象外

- Wrangler の migrations 系
- Wrangler の insights
- Wrangler の execute
- Worker Binding API そのもののメソッド面 (`prepare`, `batch`, `exec`, `withSession`)
  Binding API は adapter 実装の内側で使うもので、外部 API 面としてそのまま出す対象ではありません。 ([Cloudflare Docs][8])

[1]: https://developers.cloudflare.com/api/ "Cloudflare API | overview"
[2]: https://developers.cloudflare.com/d1/configuration/data-location/ "Data location · Cloudflare D1 docs"
[3]: https://developers.cloudflare.com/api/resources/d1/ "D1 | Cloudflare API"
[4]: https://developers.cloudflare.com/api/resources/d1/models/d1/ "Cloudflare API | D1 › D1"
[5]: https://developers.cloudflare.com/api/python/resources/d1/subresources/database/methods/raw/ "Raw D1 Database query | Cloudflare API"
[6]: https://developers.cloudflare.com/api/go/resources/d1/subresources/database/methods/import/ "Import SQL into your D1 Database | Cloudflare API"
[7]: https://developers.cloudflare.com/d1/wrangler-commands/ "Wrangler commands · Cloudflare D1 docs"
[8]: https://developers.cloudflare.com/d1/worker-api/ "Workers Binding API · Cloudflare D1 docs"
