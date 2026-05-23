# 合同生成助手接口设计

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档名称 | 合同生成助手接口设计 |
| 文档版本 | V1.0 |
| 创建日期 | 2026-05-23 |
| 关联文档 | [PRD.md](./PRD.md)、[ARCHITECTURE.md](./ARCHITECTURE.md) |
| 适用范围 | 前端 H5、BFF 鉴权协同、AgentRun 业务接口、钉盘预览交付 |

## 2. 接口分层

V1 接口按职责拆分为三类：

| 类型 | 域名 | 调用方 | 职责 |
| --- | --- | --- | --- |
| 钉钉客户端 JSAPI SDK | 钉钉客户端内置 | 前端 H5 | 获取免登授权码、打开钉盘合同预览 |
| BFF 鉴权接口 | 前端 H5 域名 | 前端 H5 | 提供公开配置、使用钉钉官方新版服务端 SDK 完成免登、维护 H5 会话、签发 AgentRun 短期访问凭证 |
| AgentRun 业务接口 | AgentRun 域名 | 前端 H5 | 处理报价单上传、解析、字段识别、合同生成和钉盘上传 |

前端与 BFF 同域，使用 Cookie 维护 H5 登录态；前端与 AgentRun 跨域，使用 `Authorization: Bearer <agentAccessToken>` 访问业务接口。

## 3. 通用约定

### 3.1 请求头

调用 AgentRun 业务接口时，前端必须携带：

```http
Authorization: Bearer <agentAccessToken>
Content-Type: application/json
```

上传文件可使用 JSON Base64 或 `multipart/form-data`。AG-UI 流式接口使用 `text/event-stream` 响应。

### 3.2 业务错误响应

所有 BFF 和 AgentRun JSON 错误响应应尽量保持一致：

```json
{
  "ok": false,
  "code": "AUTH_REQUIRED",
  "message": "登录已失效，请重新进入钉钉应用",
  "detail": "optional debug message"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean | 是 | 是否成功 |
| `code` | string | 是 | 稳定错误码 |
| `message` | string | 是 | 前端可展示文案 |
| `detail` | string | 否 | 排障信息，不应包含密钥或敏感文件内容 |

### 3.3 常用错误码

| 错误码 | HTTP 状态 | 说明 |
| --- | --- | --- |
| `AUTH_REQUIRED` | 401 | 未登录或 H5 会话失效 |
| `AGENT_TOKEN_EXPIRED` | 401 | AgentRun 访问凭证过期 |
| `FORBIDDEN` | 403 | 当前用户无权限访问资源 |
| `INVALID_ARGUMENT` | 400 | 请求参数错误 |
| `UNSUPPORTED_FILE_TYPE` | 400 | 报价单格式不支持 |
| `OCR_FAILED` | 502 | 图片 OCR 识别失败 |
| `LLM_FAILED` | 502 | 字段识别失败 |
| `CONTRACT_GENERATE_FAILED` | 500 | 合同生成失败 |
| `DINGDRIVE_UPLOAD_FAILED` | 502 | 钉盘上传失败 |
| `INTERNAL_ERROR` | 500 | 未分类服务端错误 |

## 4. 钉钉客户端 JSAPI SDK 能力

### 4.1 获取免登授权码

前端在钉钉客户端内调用钉钉客户端 JSAPI SDK 获取免登授权码。

输入：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `corpId` | `GET /bff/auth/config` | 企业 ID |
| `clientId` | `GET /bff/auth/config` | 钉钉应用 Client ID |

输出：

| 字段 | 说明 |
| --- | --- |
| `code` | 免登授权码，提交给 BFF 换取用户身份 |

前端不应把 `clientSecret`、服务端 access token 或任何第三方密钥放入页面。

### 4.2 预览钉盘合同

合同生成完成后，AgentRun 返回钉盘预览信息。前端优先使用钉钉客户端 JSAPI SDK 的文件预览能力打开合同；若当前客户端能力不可用，可降级打开 `openUrl`。

输入：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `spaceId` | AgentRun `contract_generated` 事件 | 钉盘空间 ID |
| `fileId` | AgentRun `contract_generated` 事件 | 钉盘文件 ID |
| `fileName` | AgentRun `contract_generated` 事件 | 合同文件名 |
| `previewUrl` | AgentRun `contract_generated` 事件 | 优先预览链接 |
| `openUrl` | AgentRun `contract_generated` 事件 | 兜底打开链接 |

预览页自带下载能力，前端不再默认代理下载文件流。

## 5. BFF 鉴权接口

### 5.1 获取前端配置

```http
GET /bff/auth/config
```

用途：返回前端公开配置和 AgentRun 业务入口。

响应：

```json
{
  "ok": true,
  "corpId": "ding-corp-id",
  "clientId": "ding-client-id",
  "agentBaseUrl": "https://agent.example.com",
  "agentTokenTtlSeconds": 1800
}
```

### 5.2 查询当前登录用户

```http
GET /bff/auth/me
```

用途：根据 H5 域名 Cookie 查询当前用户。

响应：

```json
{
  "ok": true,
  "loggedIn": true,
  "user": {
    "userid": "user001",
    "name": "张三",
    "unionid": "unionid001",
    "deptNames": ["销售部"]
  },
  "agentTokenExpiresAt": "2026-05-23T11:00:00Z"
}
```

### 5.3 钉钉免登登录

```http
POST /bff/auth/dingtalk-login
```

用途：BFF 接收前端通过钉钉客户端 JSAPI SDK 获取的免登 `code`，服务端使用钉钉官方新版服务端 SDK 换取用户身份，写入 H5 会话，并返回 AgentRun 短期访问凭证。

请求：

```json
{
  "code": "ding-auth-code",
  "corpId": "ding-corp-id"
}
```

响应：

```json
{
  "ok": true,
  "user": {
    "userid": "user001",
    "name": "张三",
    "unionid": "unionid001",
    "deptNames": ["销售部"]
  },
  "agentBaseUrl": "https://agent.example.com",
  "agentAccessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "expiresAt": "2026-05-23T11:00:00Z"
}
```

约束：

- BFF 写入的 H5 会话 Cookie 只作用于前端域名。
- `agentAccessToken` 应短期有效，建议 30 分钟以内。
- `agentAccessToken` 中应包含用户标识、`unionid`、签发方、过期时间和必要权限范围。

### 5.4 刷新 AgentRun 访问凭证

```http
POST /bff/auth/agent-token
```

用途：在 H5 会话仍有效时刷新 AgentRun 短期访问凭证。

响应：

```json
{
  "ok": true,
  "agentBaseUrl": "https://agent.example.com",
  "agentAccessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "expiresAt": "2026-05-23T11:30:00Z"
}
```

## 6. AgentRun 业务接口

### 6.1 上传报价单

```http
POST /api/uploads
Authorization: Bearer <agentAccessToken>
```

用途：前端直连 AgentRun 上传报价单文件。

JSON Base64 请求：

```json
{
  "originalName": "报价单.xlsx",
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "size": 123456,
  "data": "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,..."
}
```

响应：

```json
{
  "ok": true,
  "id": "upload_xxx",
  "originalName": "报价单.xlsx",
  "fileName": "upload_xxx_报价单.xlsx",
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "size": 123456
}
```

支持格式：

- `.xlsx`
- `.xls`
- `.pdf`
- `.jpg`
- `.jpeg`
- `.png`

### 6.2 解析报价单文本

```http
POST /api/uploads/{uploadId}/quote-text
Authorization: Bearer <agentAccessToken>
```

请求：

```json
{
  "templateType": "caigouhetong"
}
```

响应：

```json
{
  "ok": true,
  "uploadId": "upload_xxx",
  "templateType": "caigouhetong",
  "quoteText": "--- 工作表：Sheet1 ---\n...",
  "parser": {
    "type": "excel",
    "ocrUsed": false
  }
}
```

图片报价单响应中的 `parser.ocrUsed` 应为 `true`，并可附带 OCR 服务、页数、表格数量等排障字段。

### 6.3 字段识别预览

```http
POST /api/uploads/{uploadId}/field-preview
Authorization: Bearer <agentAccessToken>
```

请求：

```json
{
  "templateType": "caigouhetong",
  "quoteText": "用户确认后的报价单文本",
  "extraInfo": "付款比例、交货地点等补充信息"
}
```

响应：

```json
{
  "ok": true,
  "uploadId": "upload_xxx",
  "templateType": "caigouhetong",
  "extractedData": {
    "partyB": "供应商A",
    "items": []
  },
  "recognizedFields": [],
  "missingFields": [],
  "tableRowCounts": {
    "items": 3
  }
}
```

### 6.4 生成合同

```http
POST /ag-ui/agent
Authorization: Bearer <agentAccessToken>
Accept: text/event-stream
```

用途：前端提交用户确认后的字段数据，AgentRun 生成合同、使用钉盘官方新版 SDK 上传钉盘，并通过 SSE 返回过程事件。

请求关键字段：

```json
{
  "threadId": "task_xxx",
  "runId": "run_xxx",
  "messages": [
    {
      "id": "msg_xxx",
      "role": "user",
      "content": "生成合同"
    }
  ],
  "forwardedProps": {
    "uploadId": "upload_xxx",
    "templateType": "caigouhetong",
    "quoteText": "用户确认后的报价单文本",
    "extraInfo": "补充信息",
    "extractedData": {}
  }
}
```

关键事件：

```text
event: message
data: {"type":"TEXT_MESSAGE_CONTENT","delta":"正在生成合同..."}

event: message
data: {"type":"CUSTOM","name":"contract_generated","value":{...}}

event: message
data: {"type":"RUN_FINISHED"}
```

`contract_generated.value`：

```json
{
  "contractId": "contract_xxx",
  "fileName": "20260523_供应商A.docx",
  "dingDrive": {
    "spaceId": "space_xxx",
    "fileId": "file_xxx",
    "fileName": "20260523_供应商A.docx",
    "filePath": "合同/2026/05/20260523_供应商A.docx"
  },
  "preview": {
    "type": "dingtalk_drive",
    "previewUrl": "https://...",
    "openUrl": "https://...",
    "downloadProvidedByPreview": true
  }
}
```

约束：

- `extractedData` 必须来自用户确认后的字段预览结果。
- AgentRun 上传钉盘后只返回预览入口和必要文件元数据。
- 前端使用钉钉客户端 JSAPI SDK 打开预览，不默认调用代理下载接口。

## 7. SDK 使用约束

- 前端只使用钉钉客户端 JSAPI SDK 获取免登授权码和打开钉盘文件预览。
- BFF 必须使用钉钉官方新版服务端 SDK 完成免登 code 换取、用户身份查询和必要的通讯录信息查询。
- AgentRun 必须使用钉盘官方新版 SDK 上传合同、获取钉盘文件元数据和预览入口。
- 新增实现不得继续引入旧版 OAPI/Storage API 手写 HTTP 调用；确需保留旧实现时，只能作为迁移期兼容路径，并必须在当前实现差距中标注。
- SDK 抛出的异常必须转换为本文档定义的稳定错误码，不允许将 SDK 原始错误直接透传给前端。

## 8. 废弃或降级接口

以下接口不作为目标主路径：

| 接口 | 状态 | 原因 |
| --- | --- | --- |
| `POST /api/dingdrive/download` | 降级备用 | 合同交付改为钉盘预览，预览页自带下载能力 |
| `GET /api/contracts/{contractId}/download` | 调试/备用 | 合同成功上传钉盘后应返回预览链接，不暴露本地文件下载为主路径 |
| `POST /api/contracts/generate` | 调试/备用 | H5 主路径使用 AG-UI SSE 生成合同 |
| BFF 代理 `/api`、`/ag-ui` | 过渡兼容 | 目标设计为前端带短期凭证直连 AgentRun 业务接口 |

## 9. 当前实现差距

| 项目 | 目标接口设计 | 当前实现 | 待办 |
| --- | --- | --- | --- |
| 鉴权职责 | BFF 使用钉钉官方新版服务端 SDK 完成免登并签发 AgentRun 短期凭证 | 已迁移为 `/bff/auth/*` + AgentRun Bearer 鉴权 | 继续替换 BFF 内部钉钉调用为官方新版 SDK 封装 |
| 业务请求路径 | 前端直连 AgentRun | 已改为 `agentBaseUrl` + `Authorization: Bearer` | 部署时确保 AgentRun CORS 允许 H5 域名 |
| 合同交付 | AgentRun 使用钉盘官方新版 SDK 返回钉盘预览链接，前端 JSAPI SDK 打开预览 | 已返回 `preview` 结构并由前端打开预览入口 | 继续确认钉盘新版 SDK 的稳定预览 URL 字段 |
| 图片 OCR | AgentRun 解析图片报价单 | 已接入图片解析入口和 OCR SDK 调用封装 | 需在真实 OCR 环境验证识别质量和错误码 |
