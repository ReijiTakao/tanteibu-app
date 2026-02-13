# 端艇部管理 Webアプリ

慶應義塾端艇部ボート部門の出欠・練習管理アプリケーション

## 機能

- 📅 **今週画面**: 7日分の出欠状況を一覧表示
- ✅ **出欠入力**: 参加/不参加/保留をワンタップで登録
- 📝 **練習編集**: 幹部・コーチが練習内容・開始時刻を設定
- 👥 **権限管理**: 役割に応じたタブ表示切替

## ローカルでの起動方法

### 方法1: 直接ブラウザで開く

```bash
# ファイルをブラウザで開く
open index.html
```

### 方法2: ローカルサーバーを使用

```bash
# Python 3 の場合
python3 -m http.server 8000

# Node.js の場合
npx serve .
```

ブラウザで `http://localhost:8000` を開く

### 方法3: VS Code Live Server

VS Code の Live Server 拡張機能を使用

## デモユーザー

初回起動時に以下のデモユーザーが作成されます：

| 氏名 | 権限 | 学年 |
|------|------|------|
| 管理太郎 | 管理者 | 4年 |
| 幹部花子 | 幹部 | 3年 |
| 部員次郎 | 部員 | 2年 |

## ディレクトリ構成

```
慶應義塾端艇部ボート部門管理/
├── index.html          # メインHTML
├── styles.css          # スタイルシート
├── app.js              # アプリケーションロジック
├── manifest.json       # PWAマニフェスト
├── icons/
│   ├── icon-192.svg    # アイコン192px
│   └── icon-512.svg    # アイコン512px
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # DBスキーマ
├── .env.local.example  # 環境変数サンプル
└── README.md           # このファイル
```

## データベース設定（Supabase）

### 1. Supabaseプロジェクト作成

1. [Supabase](https://supabase.com) にログイン
2. 「New Project」でプロジェクト作成
3. プロジェクトURLとAPIキーを取得

### 2. テーブル作成

SQLエディタで `supabase/migrations/001_initial_schema.sql` を実行

### 3. Google OAuth設定
（メールアドレス認証に変更したため不要です）

### 4. 環境変数設定

`.env.local.example` を `.env.local` にコピーして編集

## 環境変数一覧

| 変数名 | 説明 |
|--------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseプロジェクトURL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase匿名キー |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabaseサービスロールキー（サーバーサイドのみ） |

## 権限（役割）について

| 権限 | 今週 | 練習編集 | クルー | 艇・オール | 設定 |
|------|:----:|:--------:|:------:|:----------:|:----:|
| 管理者 | ○ | ○ | ○ | ○ | ○ |
| 幹部 | ○ | ○ | ○ | ○ | ○ |
| コーチ | ○ | ○ | ○ | ○ | ○ |
| Cox | ○ | ✗ | ○ | ✗ | ○ |
| 部員 | ○ | ✗ | ○ | ✗ | ○ |

## 今後の実装予定

- [ ] Prompt 03-04: クルー編成機能
- [ ] Prompt 05-07: 艇・オール詳細管理
- [x] Supabase連携（現在はローカルストレージ）
- [デプロイ手順書 (DEPLOY.md)](DEPLOY.md)

## 技術スタック

- HTML5 / CSS3 / JavaScript (ES6+)
- PWA対応
- Supabase (PostgreSQL) ※本番環境

## 注意事項

- 現在のデモ版はローカルストレージを使用しています
- 本番環境ではSupabase連携が必要です
- 画面・ラベルはすべて日本語表記です
