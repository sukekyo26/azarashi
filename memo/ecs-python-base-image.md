# ECS で Python スクリプトを動かすときのベースイメージ選定

`python:3.14-slim-trixie` を使っていて「イメージサイズが速度に響かないか」「Inspector の CRITICAL が上流待ちで対応できない」が気になったときの整理メモ。

結論: **サイズの懸念はほぼ杞憂。本題は CVE パッチ供給の速いベース OS(Amazon Linux 2023)への移行と、定期リビルドの仕組み化。**

---

## イメージサイズと「実行速度」の関係

- サイズが影響するのは**タスク起動時の pull 時間だけ**。起動後のスクリプト実行速度には無関係。
- slim は圧縮 ~50MB。同リージョン ECR からの pull は数秒で、Fargate のタスク起動には別途 ENI アタッチ等で 10〜30 秒かかる。**slim サイズなら pull は支配項ではない**。
- pull がボトルネックになるのは数百 MB 超から。そこで初めて SOCI(lazy loading)が効く(目安 250MB 超)。

### pull は毎回発生するのか

| 起動タイプ | 挙動 |
|---|---|
| Fargate | タスクごとに専用 microVM のため**毎回 pull**。イメージキャッシュは [roadmap #696](https://github.com/aws/containers-roadmap/issues/696) で 2020 年から要望されているが未提供(Work in Progress) |
| EC2 | インスタンスにキャッシュされる。`ECS_IMAGE_PULL_BEHAVIOR=prefer-cached` で 2 回目以降の pull をスキップ可 |

タスク起動そのものは、バッチ型(RunTask / EventBridge Scheduler / Step Functions)なら実行のたび、サービス型(常駐)ならデプロイ・スケールアウト・置き換え時のみ。

---

## ベースイメージ比較

サイズは圧縮後(ECR pull で転送される量) / 展開後の目安。Python 込みかどうかで基準が違う点に注意(下表の注記参照)。

| ベース | サイズ(圧縮/展開) | CVE 対応 | 備考 |
|---|---|---|---|
| `python:3.14-slim` (Debian) | ~50MB / ~130MB | △ Debian の修正待ち。no-DSA(修正見送り)の CVE は永久に残る | Python 込み。手軽さは最良 |
| **AL2023 minimal** | ~40MB / ~110MB | ◎ AWS が迅速にパッチ供給、Inspector と整合 | 素の OS のみ。`microdnf install python3.14` で +30〜40MB。`dnf`/`microdnf` で python3.11〜3.14 が名前空間付きで入る |
| Chainguard `python` | ~25MB / ~70MB | ◎ ほぼゼロ CVE | Python 込み。無料枠は `:latest` のみでバージョン固定不可。固定は有料 |
| Alpine | ~20MB / ~50MB | △ | 素の OS のみ + Python 別途。musl 起因の wheel 互換問題・CPython 性能低下があり Python では非推奨 |
| Distroless | ~20MB / ~50MB | ○ | Python 込み。バージョンが古く、デバッグ困難 |

※ 数値は amd64 / タグ更新時期で変動する概算。「素の OS のみ」の行は Python + 依存を足すと最終イメージはこの表より大きくなる。実行速度への影響は前節の通り pull 時間に限られ、slim 前後(圧縮数十 MB)なら支配項にならない。

AL2023 を推す理由: AWS 自身がパッチを速いサイクルで供給し Inspector のデータソースと整合するため、「CRITICAL が出た → upgrade してリビルド → 消える」のループが実際に回る。Debian slim ではこのループが上流待ちで断絶する。

Distroless（Google）を推さない理由: 中身は Debian パッケージからのビルドなので CVE 修正は結局 Debian 待ちで、slim の no-DSA 問題をそのまま引き継ぐ（本メモの課題を解決しない）。加えて `python3` イメージは公式に experimental 扱いで Python バージョンも Debian stable のものに固定、シェル・パッケージマネージャが無いため共有ライブラリ不足時の対処やデバッグも難しい。distroless の強み（攻撃面積の最小化）を CVE 対応の速さと両立させたいなら Chainguard が同思想の選択肢。

---

## ベースイメージ差で Python 処理にエラーは出るか

**純粋な Python コードなら出ない。C 拡張を含むパッケージでは条件次第で出る。** 境界は「その処理が OS の C ライブラリに依存するか」。

- **出ない範囲** … CPython のバージョンが同じなら言語としての挙動は OS 非依存。標準ライブラリ・pure Python パッケージだけの処理は Debian でも AL2023 でも Alpine でも同じ結果になる。
- **出うる範囲** … C 拡張を含むライブラリ(numpy, pandas, pydantic-core, cryptography, psycopg, pillow など)が OS 側の C ライブラリ/共有ライブラリに依存する部分。

主な失敗パターン:

1. **glibc vs musl(Alpine が別格に危険)** — PyPI の wheel は大半が glibc 前提(`manylinux`)。Alpine は musl libc なので manylinux wheel が使えず pip がソースビルドにフォールバックし、ビルドツールが無ければ**インストール時エラー**、通っても挙動差や性能低下が出うる。**Alpine を Python 非推奨とする主因はこれ**。Debian slim も AL2023 も glibc なのでこの問題は起きない。
2. **システム共有ライブラリの欠如** — 一部パッケージは実行時に OS 側の `.so`(libpq, libjpeg, libxml2 等)をロードする。無いベースだとインストールは通っても**実行時 `ImportError: libXXX.so: cannot open shared object file`** で落ちる。minimal 系で起きやすく、`microdnf install` で該当 OS パッケージを足して解決。
3. **ロケール / タイムゾーン / CA 証明書** — minimal イメージはこれらが削られていることがあり、`locale` / `zoneinfo`(tzdata) / TLS 検証(ca-certificates)まわりで実行時エラーになりうる。不足パッケージを足せば解決。

実務上の結論:

- Debian slim → **AL2023(どちらも glibc)** の移行ならこの手のエラーはまず起きない。出るとしても「minimal ゆえに削られたシステムパッケージを足す」型で原因も対処も明快。
- 本当に注意が要るのは **Alpine(musl)** への移行。C 拡張の多いプロジェクトほど地雷。
- どのベースでも保険として、**ビルドした最終イメージで一度アプリを起動し import + 主要処理を通すスモークテスト**を行う。wheel 由来の問題は「ビルドは通るが実行時に落ちる」形で出るため、ビルド成功だけでは検出できない。

---

## uv を使うなら `python:` 公式イメージは不要

uv は standalone CPython を自前で入れられるので、Python 入りイメージから始める必然性はない。3 パターン:

1. **`python:3.14-slim` + uv** — CPython と OS のパッチは Debian 任せ(no-DSA 問題が残る)。
2. **AL2023 minimal + dnf の python + uv** — CPython が rpm として入るので `upgrade` でパッチが当たり、**Inspector のスキャン対象になる**。← 推奨
3. **任意ベース + `uv python install`(uv 管理 Python)** — 最小・最速だが、CPython のパッチ追随が自分の責任になる上、rpm/dpkg DB に載らないため **Inspector が CPython 本体の CVE を検出できない**(検出が減るのは盲点が増えただけ)。

「uv を使うのに Python 入りイメージを使う意味」があるとすれば、CPython のパッチ管理と脆弱性スキャンをディストリビューション(と Inspector)に任せられること、この 1 点。

---

## パターン 2 の Dockerfile 実装例

前提の構成(uv 標準の src レイアウト、`[project] name = "app"`):

```
.
├── pyproject.toml
├── uv.lock
└── src/
    └── app/
        ├── __init__.py
        └── main.py   # python3 -m app.main で実行
```

```dockerfile
# syntax=docker/dockerfile:1

########## builder ##########
FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal AS builder

RUN microdnf -y install python3.14 && microdnf clean all
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv

ENV UV_PYTHON=/usr/bin/python3.14 \
    UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# 依存だけ先にインストールしてレイヤーキャッシュを効かせる
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# プロジェクト本体を venv の site-packages にコピーで組み込む
COPY src/ src/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

########## runtime ##########
FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal

# upgrade でビルド時点の最新セキュリティパッチを取り込む(定期リビルドとセットで機能する)
RUN microdnf -y upgrade \
 && microdnf -y install python3.14 shadow-utils \
 && microdnf clean all \
 && useradd --system --no-create-home appuser

COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv

USER appuser
ENTRYPOINT ["/app/.venv/bin/python3", "-m", "app.main"]
```

要点:

- AL2023 の minimal コンテナイメージは `dnf` ではなく **`microdnf`**。
- **`UV_PYTHON_DOWNLOADS=never` がパターン 2 の要**。無いと uv が standalone Python を勝手に落として使うことがあり、「dnf 管理の CPython(=Inspector に見える)」の前提が静かに崩れる。
- `uv sync` を 2 回に分けるのはレイヤーキャッシュのため。ソース変更だけなら依存レイヤーはキャッシュヒット。
- `--no-editable` でプロジェクト本体が venv 内に実体コピーされるので、runtime へは **`.venv` だけコピーすれば完結**。venv の `bin/python3` は `/usr/bin/python3.14` へのシンボリックリンクなので、builder / runtime が同じベース + 同じパッケージなら動く。
- ENTRYPOINT は venv の絶対パス。AL2023 の素の `python3` はシステムデフォルト(3.9)を指し得るため。
- `ghcr.io/astral-sh/uv` はマイナーバージョンまでピン留めする(`:latest` は lock の解釈が変わり得る)。
- パッケージ化しない素のスクリプト置き場なら、2 回目の `uv sync` を省き `COPY src/ /app/src/` + `ENV PYTHONPATH=/app/src` でも動く。

---

## どのベースでも必須の運用

1. **週次の自動リビルド・再デプロイ**(EventBridge Scheduler → CodeBuild)。Dockerfile 内の `microdnf -y upgrade`(Debian なら `apt-get upgrade`)が、公式イメージのリビルドを待たずにパッチを取り込む。リビルドの仕組みが無いと upgrade 行は初回ビルド時点で凍結される。
2. **Inspector の「Fix available」で二分する運用** — fix あり → リビルドで解消。fix なし(no-DSA 等)→ **抑制ルール(suppression rule)** で明示的に受容。「対応できない CRITICAL が残り続ける」状態を判断済みの状態に変える。

段階付け: Debian slim のまま 1 + 2 だけでもかなり改善 → no-DSA の受容が監査上つらいなら AL2023 移行 → CVE ゼロを厳密に求められるなら Chainguard(有料)。

---

## Sources

- [Python in AL2023 - Amazon Linux 2023 User Guide](https://docs.aws.amazon.com/linux/al2023/ug/python.html)
- [aws/containers-roadmap #696 - Fargate image caching](https://github.com/aws/containers-roadmap/issues/696)
- [Amazon ECS: Fargate の Linux コンテナイメージ pull 挙動](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-pull-behavior.html)
- [AWS Blog: Lazy Loading Container Images with Seekable OCI and AWS Fargate](https://aws.amazon.com/blogs/containers/under-the-hood-lazy-loading-container-images-with-seekable-oci-and-aws-fargate)
- [Chainguard: Free Image Tier Changes](https://support.chainguard.dev/hc/en-us/articles/40405733238299-Customer-Notice-Free-Image-Tier-Changes)
