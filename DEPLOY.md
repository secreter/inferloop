# 部署到 Cloudflare Pages

## 一次性准备

### 1. 域名（可选但强烈建议）

不必先有域名也能上线 —— Cloudflare Pages 会先给你一个 `<project>.pages.dev` 的免费域名。后续在 CF 买/迁域名都行。

如果有自定义域名，先把域名 DNS 托管到 Cloudflare（即在 dash.cloudflare.com → Add a Site），这样后续绑定 Pages 项目最丝滑。

### 2. 推 Git 仓库

CF Pages 接 GitHub / GitLab / 直接上传都行，推荐 GitHub：

```bash
git init
git add .
git commit -m "Initial site"
git remote add origin git@github.com:<you>/inferloop-site.git
git push -u origin main
```

> sync 脚本依赖 `WORKSPACE` 父目录中的 5 个源仓库（llm-infra-book / book-hermes-agent / ...）。CF Pages 上没有这些 sibling 仓库，sync 会跳过——这没关系，**实际内容是本地 sync 之后被 commit 进 `content/` 一起推上去**。每次更新章节的工作流：
>
> ```bash
> npm run sync && git add content && git commit -m "Sync content" && git push
> ```

## 创建 Cloudflare Pages 项目

1. dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 授权并选择仓库
3. 构建设置：

   | 项 | 值 |
   |---|---|
   | Framework preset | **Next.js (Static HTML Export)** |
   | Build command | `npm run build` |
   | Build output directory | `out` |
   | Root directory | `/` |
   | Node version | `20` 或 `22`（Settings → Environment variables 加 `NODE_VERSION=20`）|

4. 点 **Save and Deploy**

第一次 build 大约 2–4 分钟。完成后会得到 `<project>.pages.dev`。

## 启用 Web Analytics

### 方式 A — 代码内集成（推荐，跨平台可移植）

1. dash.cloudflare.com → **Web Analytics** → **Add a site**
2. Hostname 填你的实际域名（如果还没绑定，先填 `<project>.pages.dev`）
3. 创建后会得到一段 `<script>`，里面有 `data-cf-beacon='{"token": "xxxxxxxxx"}'`，**只要 token 那 32 位字符串**
4. 回到 CF Pages → **Settings** → **Environment variables**：
   - 添加 `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` = 你的 token
   - 选 **Production** 环境（也可以同时勾 Preview）
5. **Save** → **Retry deployment**（让新变量生效）
6. 部署完后到 `<project>.pages.dev`，View Page Source 应该能看到 `<script ... cloudflareinsights ... >`

仪表盘大概 5–10 分钟开始有数据，能看 PV / UV / 国家 / 设备 / Referrer / Top Pages。

### 方式 B — 平台一键启用（更简单）

CF Pages 项目 → **Settings** → **Web Analytics** → **Enable**。零代码，CF 自动注入 beacon。但仅限 `*.pages.dev` 默认域名生效，自定义域名仍建议走方式 A。

> 两种可同时开启不冲突，但只看一份数据更清爽，二选一即可。

## 自定义域名

CF Pages 项目 → **Custom domains** → **Set up a custom domain**。如果域名已托管在 CF，自动给你创建 CNAME 记录，HTTPS 证书也自动签发。

之后改两处代码：

```diff
// app/layout.tsx
- const SITE_URL = 'https://inferloop.dev';
+ const SITE_URL = 'https://你的域名';

// app/sitemap.ts / app/robots.ts / app/[[...mdxPath]]/page.tsx
// 同样把 SITE_URL 替换
```

或者更优雅地把 `SITE_URL` 提到 env：`process.env.NEXT_PUBLIC_SITE_URL`。要我抽这个常量告诉我。

## 让搜索引擎收录

部署完后到：

- **Google Search Console**: search.google.com/search-console → Add property → 提交 `https://<domain>/sitemap.xml`
- **百度站长**: ziyuan.baidu.com → 站点管理 → 添加站点 → 提交 sitemap

当前站点已经准备好：

- ✅ 完整 metadata（title / description / OG / Twitter / canonical）
- ✅ JSON-LD 结构化数据（Book / TechArticle / BreadcrumbList）
- ✅ 76 条 URL 的 sitemap.xml
- ✅ robots.txt 指向 sitemap
- ✅ 语言 `zh-CN`、`hreflang`
- ✅ 移动端友好 + Lighthouse 100×4

提交后通常 1–7 天会被 Google 收录，百度更慢些（可能 2–4 周）。

## 日常工作流

```bash
# 1. 在 sibling 书目录里写新章节
cd ../llm-infra-book/chapters && vim ch10-alignment.md

# 2. 回到 site 仓库 sync + 推
cd ../../inferloop && npm run sync
git add content && git commit -m "ch10: 加 RLHF 实战部分"
git push

# 3. CF Pages 自动 build + 部署，约 2 分钟后线上更新
```

新加一本书：

```bash
# scripts/sync-from-books.ts 加配置
# lib/books.ts 加元数据 + cover URL
# content/_meta.ts 顶层加项
npm run sync && git add . && git commit -m "Add book: xxx" && git push
```

## 常见坑

- **build 内存不够**：CF Pages 默认 build 给 8GB，应该够。当前 `package.json` 已限 `--max-old-space-size=3072`。
- **环境变量改了不生效**：必须 retry deployment，不会自动应用到旧 build。
- **sitemap 拿到 404**：检查 build 日志里 `out/sitemap.xml` 是否生成；本地跑 `npm run build && ls out/sitemap.xml` 验证。
- **国内访问偶尔慢**：Cloudflare 大陆走香港/日本节点，正常现象。需要更稳可考虑 Cloudflare China Network（要 ICP 备案 + 商业套餐）。
