# AGENTS.md

Zotero Connectors fork（上游：zotero/zotero-connectors），额外提供保存论文后的
LLM 分类/标签推荐功能：`src/common/aiRecommender.js`（background-only），
inject 侧由 `src/common/itemSaver.js` 经消息触发，UI 在
`src/common/ui/ProgressWindow.jsx`。

## 构建与测试

- 前置：`npm install`；`git submodule update --init`（子模块必须对齐到仓库
  记录的 commit。注意 `--depth 1` 并行克隆时部分子模块会停在分支 HEAD 而非
  记录的 commit，需逐个 `git -C <path> fetch --depth 1 origin <sha>` 再
  `git -C <path> checkout <sha>` 对齐，SHA 以 `git submodule status` 无
  `+`/`-` 前缀为准，否则连 `src/zotero-schema/schema.json` 都会缺失）。
- 构建：`./build.sh` → 产物 `build/manifestv3`（Chrome MV3）、
  `build/firefox`、`build/safari`；`-d` 出带 translator tester 的调试版，
  `-v x.y.z` 指定版本号。
- 单文件改动后不必重跑全量：`npx gulp process-custom-scripts` 会重新处理
  manifest、背景页、HTML、`.jsx`；`npx gulp watch` 可增量同步。
- 测试：`npm test`（mocha + puppeteer E2E，需要先有完整构建产物
  `build/manifestv3`）。

## 扩展页面 CSP 规则（勿再踩坑）

**`frame-ancestors`、`sandbox`、`report-uri` 只能通过 HTTP 响应头生效，
禁止写进 `<meta http-equiv="Content-Security-Policy">`。** 经 meta 下发时
浏览器会直接忽略并报错：

> The Content Security Policy directive 'frame-ancestors' is ignored when
> delivered via a `<meta>` element.

扩展的打包页面无法设置 HTTP 头，manifest 的
`content_security_policy.extension_pages` 也不支持 `frame-ancestors`，所以
对扩展页面没有任何渠道能用该指令。

- 要防止扩展页面被网页嵌入：不要用 CSP，靠 `web_accessible_resources`
  收敛——不在列表里的资源（如 `offscreen/offscreenSandbox.html`）网页本来
  就无法引用/嵌入。
- meta CSP 里只放取值类指令：`default-src`、`script-src`、`form-action`、
  `img-src` 等。
- 案例见 `src/browserExt/offscreen/offscreenSandbox.html`（曾犯此错，修复
  时在文件注释里留了说明）。

## 敏感 pref 命名

任何存密钥的新 pref，命名必须匹配 `SENSITIVE_PREF_NAMES`
（`src/browserExt/prefs.js` 与 `src/common/preferences/config.jsx` 中的
`/(?:api.?key|secret|token|password)/i`）：debug 日志脱敏和 Config Editor
掩码都依赖这个正则。两个文件需同步修改。
