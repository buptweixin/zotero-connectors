# Zotero Connectors（Zotero 浏览器连接器）

[**English**](README.md) | **简体中文**

[![Build Status](https://travis-ci.org/zotero/zotero-connectors.svg?branch=master)](https://travis-ci.org/zotero/zotero-connectors)

> **Fork 说明**：本 fork 在上游 Zotero Connectors 的基础上新增了 **AI 智能推荐分组与标签**
> 功能。以下文档均已翻译为中文，英文原版见 [README.md](README.md)。

## AI 智能推荐（AI Recommendations）

保存论文时，连接器可以调用你配置的大语言模型（LLM），根据论文的**标题和摘要**自动推荐
**分组（collection）**和**标签（tags）**：

- 建议会显示在保存进度窗口的「AI」行中——点击 **Apply** 即可把条目移入推荐的分组并添加
  推荐的标签（走标准的 updateSession 通道）；也可以在偏好设置中开启「自动应用」直接生效
- **强烈优先复用已有的分组和标签**；确实没有合适分组时，模型会给出「建议新建分组」的名称。
  由于 Zotero 连接器 API 不支持直接新建分组，需在 Zotero 中手动创建一次——之后保存就会
  自动命中它
- 覆盖两类保存场景：网页翻译器保存（arXiv、Google Scholar 等）和直接打开 PDF 后由 Zotero
  识别出元数据的保存
- 模型输出会先经过白名单校验（分组 ID 必须真实存在、标签清洗去重）才会应用；标题/摘要按
  不可信数据处理，防止提示注入

### 安装使用

1. 从 [Releases](https://github.com/buptweixin/zotero-connectors/releases) 下载
   `zotero-connectors-*-chrome.zip` 并解压
1. 打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择解压出
   的目录
1. 打开扩展设置 → General → **AI Recommendations**，启用并填写 LLM 接口，点
   **Test Connection** 验证连通性

### 配置 LLM 接口

支持两种协议：

- **OpenAI 兼容**（OpenAI、DeepSeek、GLM、Kimi、Qwen、OpenRouter、本地 Ollama 等）：
  填 Base URL（如 `https://api.openai.com/v1`、`https://api.deepseek.com/v1`，本地
  Ollama 填 `http://localhost:11434/v1`）+ 模型名；本地服务可不填 API Key
- **Anthropic（Claude）**：填 Base URL（如 `https://api.anthropic.com`）+ API Key + 模型名

说明：请求由浏览器直连你所配置的接口，API Key 存储在扩展本地存储中。多条目批量保存、
以及 Zotero 客户端离线（保存到 zotero.org）时会跳过 AI 推荐。

## 构建

1. `git clone https://github.com/buptweixin/zotero-connectors.git`
1. `cd zotero-connectors`
1. `git submodule update --init`
1. `npm install`
1. `./build.sh -d`

构建产物输出在 `build/` 目录。

构建只需要顶层 submodule，所以 `git submodule update --init`（不带 `--recursive`）即可。

## 从构建目录运行

### Chrome

1. 打开 `chrome://extensions/`
1. 启用「开发者模式」
1. 点击「加载已解压的扩展程序…」，选择 `build/manifestv3` 目录

### Firefox

1. 打开 `about:debugging`
1. 点击「临时载入附加组件」，选择 `build/firefox/manifest.json` 文件

### Safari

参见 https://github.com/zotero/safari-app-extension

## 自动重新构建

1. `cd` 到项目根目录
1. `npm install`
1. `build.sh -d`
1. `gulp watch`

文件变更时连接器会自动重新构建。你需要在对应浏览器中手动重新加载扩展。

## 命令行打包扩展的要求

* 复制 `config.sh-sample` 为 `config.sh` 并按需修改

# 开发文档

Zotero Connector 架构概述。

## 技术栈

##### Chrome/Firefox 浏览器扩展框架

扩展使用跨浏览器的 WebExtension API 技术。参见
[Chrome 扩展文档](https://developer.chrome.com/extensions) 和
[Firefox 扩展文档](https://developer.mozilla.org/en-US/Add-ons/WebExtensions)。

##### Safari 扩展框架

Safari 相关内容参见 https://github.com/zotero/safari-app-extension

##### Zotero 翻译器（Translator）框架

连接器使用 [Zotero translate 架构](https://github.com/zotero/translate) 来支持网页翻译。
理解翻译机制对理解本代码库非常有帮助。

## 组件

把资源保存到 Zotero 库由两大组件协作完成：运行在浏览器中的 Zotero Connector，以及
Zotero 客户端或 zotero.org 网页 API。Zotero Connector 自身又分为两部分：运行在网页上的
代码和后台进程。

<img src="http://i.imgur.com/4r2qRqe.png" width="600"/>


##### a) 注入到各网页的脚本

每个网页都会被注入（[Chrome](https://developer.chrome.com/extensions/content_scripts)/[Firefox](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Content_scripts)/[Safari](https://developer.apple.com/documentation/safariservices/injecting-a-script-into-a-webpage)）
一套完整的 Zotero [翻译框架](https://github.com/zotero/zotero-connectors/blob/e1a16c8ad2e17c6893554c3f376384e18182202d/gulpfile.js#L45-L79)。
一个 [*Zotero.Translate.Web*](https://github.com/zotero/zotero-connectors/blob/e1a16c8ad2e17c6893554c3f376384e18182202d/src/common/inject/inject.jsx#L314-L314)
实例负责调度各个翻译器完成检测和翻译。

翻译框架提供了自定义的
[翻译器获取](https://github.com/zotero/zotero-connectors/blob/e1a16c8ad2e17c6893554c3f376384e18182202d/src/common/translators.js)
和 [条目保存](https://github.com/zotero/zotero-connectors/blob/e1a16c8ad2e17c6893554c3f376384e18182202d/src/common/translate_item.js)
类。这些类与 Zotero Connector 的后台进程 (b) 通信，处理翻译框架之外的功能，例如获取翻译器
代码、把翻译出的条目发送到 Zotero (c) 或 zotero.org (d)。

##### b) 后台进程

连接器运行一个[后台进程](https://github.com/zotero/zotero-connectors/blob/e1a16c8ad2e17c6893554c3f376384e18182202d/gulpfile.js#L95-L125)
（[Chrome](https://developer.chrome.com/extensions/event_pages)/[Firefox](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Anatomy_of_a_WebExtension#Background_scripts)/[Safari](https://developer.apple.com/documentation/safariservices/building-a-safari-app-extension)），
作为注入脚本 (a) 中的翻译框架与 Zotero (c) 或 zotero.org (d) 之间的中间层。

后台进程维护翻译器缓存，并通过 [URL 匹配做初步的翻译器检测](https://github.com/zotero/zotero-connectors/blob/e1a16c8ad2e17c6893554c3f376384e18182202d/src/common/translators.js#L140-L196)。
目标正则匹配到当前网页 URL 的翻译器，会进一步在注入脚本中运行 `detectWeb()` 测试。翻译器
列表及其代码从 [Zotero (c) 或 zotero.org (d)](https://github.com/zotero/zotero-connectors/blob/e1a16c8ad2e17c6893554c3f376384e18182202d/src/common/repo.js#L140-L155)
获取。

后台进程还负责更新扩展 UI、发起翻译、存取连接器偏好，以及把翻译出的条目发送到 Zotero 或
zotero.org。各浏览器的专属脚本见
[BrowserExt](https://github.com/zotero/zotero-connectors/blob/master/src/browserExt/background.js)
和 [Safari](https://github.com/zotero/zotero-connectors/blob/master/src/safari/global.html)。

##### c) Zotero 中的连接器服务

Zotero 打开时会在 23119 端口运行一个
[连接器 HTTP 服务](https://www.zotero.org/support/dev/client_coding/connector_http_server)。
该 HTTP API 承接连接器与 Zotero 客户端之间的交互。代码中对
[*Zotero.Connector.callMethod(endpoint)*](https://github.com/zotero/zotero-connectors/blob/e1a16c8ad2e17c6893554c3f376384e18182202d/src/common/connector.js#L150)
的调用会被转换为发往该连接器服务的 HTTP 请求。

注意 Zotero 无法主动与连接器交互，所有通信都由连接器发起。

##### d) zotero.org API

Zotero 不可用时，条目保存会回退到
[zotero.org API](https://www.zotero.org/support/dev/web_api/v3/start)。
与 zotero.org API 的交互定义在 [api.js](https://github.com/zotero/zotero-connectors/blob/e1a16c8ad2e17c6893554c3f376384e18182202d/src/common/api.js) 中。

## 消息传递

扩展后台进程与注入脚本之间唯一的通信方式是浏览器提供的消息传递协议
（[Chrome](https://developer.chrome.com/extensions/messaging)/[Firefox](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Content_scripts#Communicating_with_background_scripts)/[Safari](https://developer.apple.com/documentation/safariservices/passing-messages-between-safari-app-extensions-and-injected-scripts)）。
注入脚本经常需要与后台脚本通信。为简化这类交互，后台脚本中的函数会在注入脚本中被
monkey-patch：调用是异步的，如需返回值，通过调用最后一个参数的回调函数或返回的 Promise
提供。

[*messages.js*](https://github.com/zotero/zotero-connectors/blob/e1a16c8ad2e17c6893554c3f376384e18182202d/src/common/messages.js)
维护着这些被 monkey-patch 的方法列表。方法的值为 false 表示不需要响应，否则调用会返回
响应。还可以选择在后台端做发送前预处理、在注入端做接收后处理，用于处理无法直接通过消息
协议传值的数据。

后台进程在 [*messaging.js*](https://github.com/zotero/zotero-connectors/blob/e1a16c8ad2e17c6893554c3f376384e18182202d/src/common/messaging.js)
中注册消息监听器。`Zotero.Messaging` 类也提供了向注入脚本发消息和添加自定义消息监听器
的方式。

注入脚本在 *messaging_injected.js*（[BrowserExt](https://github.com/zotero/zotero-connectors/blob/e1a16c8ad2e17c6893554c3f376384e18182202d/src/browserExt/messaging_inject.js)/[Safari](https://github.com/zotero/zotero-connectors/blob/e1a16c8ad2e17c6893554c3f376384e18182202d/src/safari/messaging_inject.js)）
中 monkey-patch 这些方法。`Zotero.Messaging` 类同样提供了向后台进程发消息和添加消息
监听器的方式。

## 联系方式

如果你对开发 Zotero Connectors 有任何疑问，可以加入
[zotero-dev 邮件列表](https://groups.google.com/forum/#!forum/zotero-dev) 参与讨论。

## 社区

本项目分享自 [LINUX DO](https://linux.do) 社区，感谢社区佬友的支持与反馈。
