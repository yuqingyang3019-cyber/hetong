# 合同生成助手接口设计

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档名称 | 合同生成助手接口设计 |
| 文档版本 | V1.0 |
| 创建日期 | 2026-05-23 |
| 关联文档 | [PRD.md](./PRD.md)、[ARCHITECTURE.md](./ARCHITECTURE.md) |
| 适用范围 | 前端 H5、FC 鉴权与业务接口、钉盘下载交付 |

## 2. 接口分层

V1 接口按职责拆分为三类：

| 类型 | 域名 | 调用方 | 职责 |
| --- | --- | --- | --- |
| 钉钉客户端 JSAPI SDK | 钉钉客户端内置 | 前端 H5 | 获取免登授权码 |
| FC 鉴权接口 | H5 同域 | 前端 H5 | 提供公开配置、使用钉钉官方新版服务端 SDK 完成免登、维护 H5 会话、签发短期业务凭证 |
| FC 业务接口 | H5 同域 | 前端 H5 | 处理报价单上传、解析、字段识别、合同生成和钉盘上传 |

前端与 FC 后端同域，使用 Cookie 维护 H5 登录态；业务接口使用 `Authorization: Bearer <agentAccessToken>` 访问。

## 3. 通用约定

### 3.1 请求头

调用 FC 业务接口时，前端必须携带：

```http
Authorization: Bearer <agentAccessToken>
Content-Type: application/json
```

上传文件可使用 JSON Base64 或 `multipart/form-data`。合同生成使用同步 HTTP JSON 响应。

### 3.2 业务错误响应

所有 FC JSON 错误响应应尽量保持一致：

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
| `AGENT_TOKEN_EXPIRED` | 401 | 业务访问凭证过期 |
| `FORBIDDEN` | 403 | 当前用户无权限访问资源 |
| `INVALID_ARGUMENT` | 400 | 请求参数错误 |
| `UNSUPPORTED_FILE_TYPE` | 400 | 报价单格式不支持 |
| `OCR_FAILED` | 502 | 图片 OCR 识别失败 |
| `LLM_FAILED` | 502 | 字段识别失败 |
| `YONBIP_AUTH_FAILED` | 502 | 用友 YonBIP 访问令牌获取失败 |
| `YONBIP_SUPPLIER_LOOKUP_FAILED` | 502 | 用友供应商抬头查询失败 |
| `CONTRACT_GENERATE_FAILED` | 500 | 合同生成失败 |
| `DINGDRIVE_UPLOAD_FAILED` | 502 | 钉盘上传失败 |
| `DINGDRIVE_DOWNLOAD_FAILED` | 502 | 钉盘下载失败 |
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

### 4.2 下载钉盘合同

合同生成完成后，FC 后端返回钉盘文件信息。前端调用下载接口，FC 后端使用钉盘官方新版 SDK 获取文件下载信息并代理返回合同文件流。

输入：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `spaceId` | `POST /api/contracts/generate` 响应 | 钉盘空间 ID |
| `fileId` | `POST /api/contracts/generate` 响应 | 钉盘文件 ID |
| `fileName` | `POST /api/contracts/generate` 响应 | 合同文件名 |
| `downloadUrl` | 前端内部接口 | FC 下载接口路径 |

前端下载完成后应提示用户文件会保存到浏览器或钉钉客户端默认下载目录；如系统弹窗提示，可选择目标保存位置。

## 5. BFF 鉴权接口

### 5.1 获取前端配置

```http
GET /bff/auth/config
```

用途：返回前端公开配置。纯 FC 同域部署时 `agentBaseUrl` 可为空字符串，前端使用相对路径访问业务接口。

响应：

```json
{
  "ok": true,
  "corpId": "ding-corp-id",
  "clientId": "ding-client-id",
  "agentBaseUrl": "",
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

用途：FC 后端接收前端通过钉钉客户端 JSAPI SDK 获取的免登 `code`，服务端使用钉钉官方新版服务端 SDK 换取用户身份，写入 H5 会话，并返回短期业务访问凭证。

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
  "agentBaseUrl": "",
  "agentAccessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "expiresAt": "2026-05-23T11:00:00Z"
}
```

约束：

- BFF 写入的 H5 会话 Cookie 只作用于前端域名。
- `agentAccessToken` 应短期有效，建议 30 分钟以内。
- `agentAccessToken` 中应包含用户标识、`unionid`、签发方、过期时间和必要权限范围。

### 5.4 刷新业务访问凭证

```http
POST /bff/auth/agent-token
```

用途：在 H5 会话仍有效时刷新短期业务访问凭证。

响应：

```json
{
  "ok": true,
  "agentBaseUrl": "",
  "agentAccessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "expiresAt": "2026-05-23T11:30:00Z"
}
```

## 6. FC 业务接口

### 6.1 上传报价单

```http
POST /api/uploads
Authorization: Bearer <agentAccessToken>
```

用途：前端上传报价单文件。

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
- `.bmp`
- `.gif`
- `.tif`
- `.tiff`
- `.webp`

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
  "extraInfo": "付款比例、交货地点等补充信息",
  "tableMode": "auto"
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
  "attachmentMode": {
    "enabled": true,
    "tableMode": "attachment"
  },
  "tableMode": "attachment",
  "tableRowCounts": {
    "items": 3
  }
}
```

`tableMode` 取值为 `template`、`attachment`，兼容旧值 `auto`：前端默认传 `template`，按合同模板识别并填表；用户显式勾选“将表格作为附件”后传 `attachment`，只识别主字段并将 Excel 原表追加到合同末尾。`auto` 仅作为兼容值按服务端自动规则处理，新交互不默认使用。

### 6.4 生成合同

```http
POST /api/contracts/generate
Authorization: Bearer <agentAccessToken>
```

用途：前端提交用户确认后的字段数据，FC 后端同步生成合同、使用钉盘官方新版 SDK 上传钉盘，并一次性返回钉盘文件信息。

请求：

```json
{
  "uploadId": "upload_xxx",
  "templateType": "caigouhetong",
  "quoteText": "用户确认后的报价单文本",
  "extraInfo": "补充信息",
  "extractedData": {},
  "tableMode": "attachment"
}
```

无报价单时 `uploadId` 可省略，此时 `extractedData` 必填，且 `tableMode` 固定为 `template`。

响应：

```json
{
  "ok": true,
  "contractId": "contract_xxx",
  "fileName": "HT001_供应商A_项目A.docx",
  "dingDrive": {
    "spaceId": "space_xxx",
    "fileId": "file_xxx",
    "fileName": "HT001_供应商A_项目A.docx",
    "filePath": "合同/2026/05/HT001_供应商A_项目A.docx"
  },
  "preview": {
    "type": "dingtalk_drive",
    "previewUrl": "https://...",
    "openUrl": "https://...",
    "downloadProvidedByPreview": true
  },
  "download": {
    "type": "agent_proxy",
    "fileName": "HT001_供应商A_项目A.docx",
    "savePathHint": "文件将保存到浏览器或钉钉客户端的默认下载目录；如系统弹窗提示，请选择目标保存位置。"
  }
}
```

约束：

- `uploadId` 可选；省略时表示无报价单手工填写流程。
- 无 `uploadId` 时，`extractedData` 必填，且不得依赖服务端重新解析或 LLM 识别。
- 有 `uploadId` 时，`extractedData` 必须来自用户确认后的字段预览结果。
- 合同文件名使用 `合同编号_供应商名称_项目名称.docx`；合同编号为空时用生成时间兜底，供应商或项目为空时用 `未知乙方`、`未知项目`。
- FC 后端上传钉盘后返回必要文件元数据和下载提示信息。
- 前端通过 `POST /api/dingdrive/download` 带 Bearer Token 下载合同文件，不直接暴露钉盘下载签名 URL 和 headers。

### 6.5 下载钉盘合同

```http
POST /api/dingdrive/download
Authorization: Bearer <agentAccessToken>
```

请求：

```json
{
  "spaceId": "space_xxx",
  "fileId": "file_xxx",
  "fileName": "20260523_供应商A.docx"
}
```

用途：FC 后端调用钉盘 `GetFileDownloadInfo` 获取下载 URL 和 headers，并代理返回合同文件流。前端收到文件流后触发浏览器或钉钉客户端下载，并提示用户保存路径。

字段识别预览响应可附带用友供应商抬头回填结果：

```json
{
  "supplierPatch": {
    "source": "yonbip",
    "matched": true,
    "supplierName": "某某供应商有限公司",
    "overwrittenFields": ["supplierAddress", "supplierTaxNo"],
    "missingYonbipFields": []
  }
}
```

规则：

- FC 后端根据字段识别结果中的 `supplierName` 实时调用用友 `POST /yonbip/digitalModel/vendor/queryByPage`，请求体使用 `condition.simpleVOs = [{ field: "name", op: "eq", value1: supplierName }]`，并通过 `partParam.vendorbanks.data = "*,openaccountbank.name"` 请求银行子表，通过 `partParam.vendorcontactss.data = "*"` 请求联系人子表。
- 仅命中唯一可用供应商时自动覆盖乙方抬头字段；未命中、多条命中或接口失败时返回 `supplierPatch.matched=false` 和稳定 `reason`，不阻塞字段确认。
- 用友返回的乙方抬头信息作为权威数据，可覆盖 `supplierName`、`supplierTaxNo`、`supplierAddress`、`supplierPhone`、`supplierBank`、`supplierAccount`、`supplierRepresentativeName`、`supplierRepresentativePhone`、`supplierRepresentativeEmail` 等字段。
- 银行账户优先选择 `defaultbank=true` 且 `stopstatus=false` 的记录，否则选择第一条未停用账户。
- 若用友缺少税号、地址、电话、开户行或银行账号等合同需要的抬头字段，`missingYonbipFields` 应列出缺失字段，前端提示用户到用友系统补充供应商抬头信息或先手动填写。
- FC 后端不生成、不下载、不上传 `supplier-cache.xlsx`，不在本地或钉盘长期保存供应商档案。

### 6.5 用友供应商抬头查询

```http
POST /api/suppliers/lookup
Authorization: Bearer <agentAccessToken>
```

请求：

```json
{
  "supplierName": "某某供应商有限公司"
}
```

响应：

```json
{
  "ok": true,
  "supplierPatch": {
    "source": "yonbip",
    "matched": true,
    "patch": {
      "supplierTaxNo": "9133...",
      "supplierAccount": "6222..."
    },
    "missingYonbipFields": ["supplierBank"],
    "reason": null
  }
}
```

规则：

- 字段确认环节用户修改乙方名称后，可调用本接口再次按名称实时查询用友供应商档案。
- 查询逻辑、回填字段、`supplierPatch` 结构与字段识别预览中的用友抬头回填一致。
- 用友接口异常时返回 HTTP 200 和 `supplierPatch.reason = "lookup_error"`，不阻塞前端继续编辑和生成合同。

## 7. SDK 使用约束

- 前端只使用钉钉客户端 JSAPI SDK 获取免登授权码。
- BFF 必须使用钉钉官方新版服务端 SDK 完成免登 code 换取、用户身份查询和必要的通讯录信息查询。
- FC 后端必须使用钉盘官方新版 SDK 上传合同、获取钉盘文件元数据和下载信息。
- 新增实现不得继续引入旧版 OAPI/Storage API 手写 HTTP 调用；确需保留旧实现时，只能作为迁移期兼容路径，并必须在当前实现差距中标注。
- SDK 抛出的异常必须转换为本文档定义的稳定错误码，不允许将 SDK 原始错误直接透传给前端。

## 8. 已移除接口

以下接口不属于 V1 正式目标路径，当前实现不再保留：

| 接口 | 原因 |
| --- | --- |
| `GET /api/contracts/{contractId}/download` | 合同成功上传钉盘后通过钉盘文件信息下载，不暴露本地合同下载 |
| BFF 代理 `/api` | 纯 FC 同域部署，前端带短期凭证直接调用同域业务接口 |
| `POST /api/suppliers/sync` | 供应商抬头改为字段识别阶段实时只读查询用友，不再维护 `supplier-cache.xlsx` |

## 9. 当前实现差距

| 项目 | 目标接口设计 | 当前实现 | 待办 |
| --- | --- | --- | --- |
| 鉴权职责 | FC 后端使用钉钉官方新版服务端 SDK 完成免登并签发短期业务凭证 | 已迁移为同一 FC 内的 `/bff/auth/*` + Bearer 鉴权 | 后续在真实钉钉环境验证新版 SDK 免登字段稳定性 |
| 业务请求路径 | 前端同域调用 FC 业务接口 | 已改为相对路径 + `Authorization: Bearer` | 部署时确认自定义域名指向单个 FC 服务 |
| 合同交付 | FC 后端使用钉盘官方新版 SDK 返回钉盘文件信息，前端通过 FC 下载合同 | 已返回 `dingDrive` 和 `download` 结构，并通过 `/api/dingdrive/download` 下载 | 继续确认钉盘下载信息接口在真实环境的权限配置 |
| 图片 OCR | FC 后端解析图片报价单 | 已接入图片解析入口和 OCR SDK 调用封装 | 需在真实 OCR 环境验证识别质量和错误码 |
| 用友抬头回填 | 字段识别后按乙方名称实时查询用友供应商档案，并以用友返回信息覆盖乙方抬头字段 | 已替换供应商缓存同步链路 | 需在真实 YonBIP 环境验证名称精确查询、银行子表和缺失字段提示 |
