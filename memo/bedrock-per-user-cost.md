# Bedrock の利用コストをユーザー別に按分する

Bedrock の `InvokeModel` などのコストを、利用者(IAM プリンシパル)単位で配分するための手順メモ。

ログには**トークン数しか無く金額は無い**ので、按分はこうなる:

```
ユーザーのコスト = 集計期間の Bedrock 実請求額 × そのユーザーのトークン比率
```

- **トークン比率** … model invocation logging から取る(下のコマンド)。
- **実請求額** … 請求書 / Cost Explorer 画面で見える「集計期間の Bedrock 合計額」という 1 つの数字を、コマンドに直接書くだけ。

前提: model invocation logging は有効化済みで、CloudWatch Logs にレコードが蓄積されている。レコードには `identity.arn`(呼び出し元) と `input.inputTokenCount` / `output.outputTokenCount`(トークン数) が含まれる。

---

## 取得コマンド(モデル 1 つに絞る)

モデルごとに単価が大きく違うため、按分は**対象モデルを 1 つに絞って**行う(別モデルを混ぜない)。`filter modelId like /.../` で対象モデルを指定し、`awk` の `total` にはそのモデルの実請求額(USD)を入れる。複数モデルを使っているなら、`filter` と `total` を変えてモデルごとに実行する。集計期間は `--start-time` / `--end-time`(例: `2026-06-01`〜`2026-07-01`)、ロググループは `--log-group-name` を環境に合わせる。

```sh
START_TIME=2026-06-01    # 集計開始(この日を含む)
END_TIME=2026-07-01      # 集計終了(この日を含まない)
MODEL_ID=claude-sonnet-4 # 対象モデル(filter modelId like で部分一致)
TOTAL_USD=300.00         # 上の期間における対象モデルの実請求額(USD)

QID=$(aws logs start-query \
  --log-group-name /bedrock/model-invocations \
  --start-time $(date -u -d "$START_TIME" +%s) --end-time $(date -u -d "$END_TIME" +%s) \
  --limit 10000 \
  --query-string "fields identity.arn as principal, input.inputTokenCount as inTok, output.outputTokenCount as outTok
    | filter modelId like /$MODEL_ID/
    | stats sum(inTok) as input_tokens, sum(outTok) as output_tokens by principal
    | sort input_tokens desc" \
  --query 'queryId' --output text)

until [ "$(aws logs get-query-results --query-id "$QID" --query 'status' --output text)" = "Complete" ]; do sleep 2; done

aws logs get-query-results --query-id "$QID" --output json \
  | jq -r '.results[] | [(.[]|.value)] | @tsv' \
  | awk -v total="$TOTAL_USD" '
      { u[NR]=$1; t[NR]=$2+$3; sum+=$2+$3 }
      END { for (i=1;i<=NR;i++) printf "%-48s %7.2f%%  $%.2f\n", u[i], 100*t[i]/sum, total*t[i]/sum }'
```

実行例(出力 — 列は `principal / 比率 / 按分コスト`):

```
arn:aws:iam::123456789012:user/alice     63.00%  $189.00
arn:aws:iam::123456789012:user/bob       27.60%  $82.80
arn:aws:iam::123456789012:user/carol      9.40%  $28.20
```

按分コストの合計は実請求額(`awk` に渡した `total`)にぴったり一致する。

> 対象モデルの実請求額を CLI で確認するには、usage type 別に取得して対象モデルの行を合計する(任意):
> ```sh
> aws ce get-cost-and-usage --time-period Start=2026-06-01,End=2026-07-01 \
>   --granularity MONTHLY --metrics UnblendedCost \
>   --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon Bedrock"]}}' \
>   --group-by Type=DIMENSION,Key=USAGE_TYPE \
>   --query 'ResultsByTime[0].Groups[].[Keys[0],Metrics.UnblendedCost.Amount]' --output text
> ```
> usage type 名にモデル名が入る(例: `...Claude-Sonnet-4-input-tokens` / `-output-tokens`)。対象モデルの input/output 行の合計を `total` に入れる。

---

## 注意点

### identity.arn の中身

- IAM ユーザー直呼び … `arn:aws:iam::...:user/alice` → そのままユーザー別になる。
- AssumeRole / SSO 経由 … `arn:aws:sts::...:assumed-role/RoleName/session-name`。「誰か」は末尾の session-name に依存し、共通ロールだと個人に割れない → 下の requestMetadata を使う。

### requestMetadata でグルーピング(呼び出し側を変えられる場合)

`Converse` / `InvokeModel` に `requestMetadata={"user":"alice"}` を渡すとログに残る。クエリを `by requestMetadata.user` に変えれば、ARN をパースせず確実に個人別になる。

### 按分の限界

入力・出力をまとめたトークン比でならしているため、出力単価の高さやユーザーごとのキャッシュ/バッチ利用率の差は反映されない。合計は実請求額に一致するので、チャージバック用途では実用上十分。より正確にするなら、入力コストと出力コストを分け、それぞれ `input_tokens` 比 / `output_tokens` 比で按分する。

---

## 参考

- Monitor model invocation using CloudWatch Logs and Amazon S3
  https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html
