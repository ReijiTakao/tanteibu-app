# デプロイ手順書 (Supabase + Vercel)

このドキュメントでは、端艇部管理アプリを **Vercel** にデプロイし、**Supabase** を連携させる手順を説明します。
（認証方式をメールアドレス・パスワードに変更したため、Google Cloud Platformの設定は不要です）

---

## 1. Supabase の設定

1. [Supabaseダッシュボード](https://supabase.com/dashboard) で対象のプロジェクトを開きます。
2. **Authentication > Providers** を開きます。
3. **Email** が **Enable** になっていることを確認します（デフォルトで有効）。
4. （任意）**Authentication > Email Templates** で、確認メールの文面をカスタマイズできます。

---

## 2. Vercel へのデプロイ

Vercel CLIを使うか、GitHub連携をしてデプロイします。

### A. GitHub リポジトリ経由の場合（推奨）

1. このプロジェクトを GitHub にプッシュします。
2. [Vercel](https://vercel.com) にログインし、「Add New...」>「Project」を選択します。
3. GitHub リポジトリを選択し、「Import」をクリックします。
4. **Build & Development Settings** はそのままでOKです（`vercel.json` が設定済みのため）。
5. **Environment Variables (環境変数)** を設定します。
   Supabaseの `Settings` > `API` から以下の情報を取得して入力します。

   | Key | Value |
   |-----|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / public key |
   
   ※ このアプリは現状 `supabase-config.js` にハードコードされている部分がありますが、本来は環境変数を使うべきです。

6. 「Deploy」をクリックします。
7. デプロイが完了すると、公開URL（例: `https://tanteibu-app.vercel.app`）が発行されます。

---

## 3. デプロイ後の追加設定

デプロイされたURL（例: `https://tanteibu-app.vercel.app`）を使って、以下の設定を追加・更新します。

### Supabase
1. **Authentication > URL Configuration** を開きます。
2. **Site URL** を VercelのURL (`https://tanteibu-app.vercel.app`) に変更します。
3. **Redirect URLs** にも同様に VercelのURL を追加します。
4. 保存します。

---

## 4. 動作確認

1. VercelのURL (`https://tanteibu-app.vercel.app`) にアクセスします。
2. 「新規登録」リンクから、メールアドレスとパスワードを入力してアカウントを作成します。
3. 登録確認メールが届くので、リンクをクリックして認証を完了させます。
4. ログイン画面に戻り、登録した情報でログインできることを確認します。

> **注意**: 初回ログイン時は「未承認」状態のため、データベース（`users` テーブル）を直接編集して `approval_status` を `承認済み` にするか、管理者ユーザーで承認フローを通す必要があります。

