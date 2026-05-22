# 获取企业内部应用的access_token

企业内部应用调用本接口获取access_token。调用服务端API获取应用资源时，需要通过access_token来鉴权调用者身份进行授权。  

**重要**

为提升接口使用体验，针对**获取访问凭证** 相关接口规范进行升级，从[旧版升级到新版]([https://open.dingtalk.com/document/orgapp/differences-between-server-apis-and-new-server-apis)。本文旧版规范接口文档已于2023年8月17日迁移至历史文档（不推荐）目录，且本接口仅保持现有功能，不再新增支持其他能力。](https://open.dingtalk.com/document/orgapp/differences-between-server-apis-and-new-server-apis)。本文旧版规范接口文档已于2023年8月17日迁移至历史文档（不推荐）目录，且本接口仅保持现有功能，不再新增支持其他能力。)

* 如果未使用本接口，推荐使用[获取企业内部应用的accessToken]([https://open.dingtalk.com/document/orgapp/obtain-the-access_token-of-an-internal-app)新版规范接口。](https://open.dingtalk.com/document/orgapp/obtain-the-access_token-of-an-internal-app)新版规范接口。)

* 如果已使用本接口，建议您根据自身实际情况评估是否切换至推荐接口。

**说明**

在使用access_token时，请注意：

* access_token的有效期为7200秒（2小时），有效期内重复获取会返回相同结果并自动续期，过期后获取会返回新的access_token。

* 开发者需要缓存access_token，用于后续接口的调用。因为每个应用的access_token是彼此独立的，所以进行缓存时需要区分应用来进行存储。

* 不能频繁调用gettoken接口，否则会受到频率拦截。

## 权限

服务端API是以应用维度授权的，在调用接口前，确保已经为应用添加了接口权限。

|  应用类型   | 是否支持调用 | 权限申请方式 |                                      API Explorer调试                                      |

|---------|--------|--------|------------------------------------------------------------------------------------------|

| 企业内部应用  | 是      | 无需申请   | [调试]([https://open-dev.dingtalk.com/apiExplorer#/?devType=org&api=dingtalk.oapi.gettoken](https://open-dev.dingtalk.com/apiExplorer#/?devType=org&api=dingtalk.oapi.gettoken)) |

| 第三方企业应用 | 否      | ---    | ---                                                                                      |

| 第三方个人应用 | 否      | ---    | ---                                                                                      |

在获取access_token前，需要在开发者后台查看应用的AppKey和AppSecret：

1. 登录[钉钉开发者后台]([https://open-dev.dingtalk.com/)。](https://open-dev.dingtalk.com/)。)

2. 在**应用开发**页面，单击目标应用进入应用详情页面。

3. 在**基础信息**页面，复制应用的AppKey和AppSecret。

   **重要**

   请妥善保管应用的AppKey和AppSecret。

![p164408]([https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/5448017161/p255202.png](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/5448017161/p255202.png))

## 基本信息

**请求方式**：GET

**请求地址**：`https://oapi.dingtalk.com/gettoken\`

## Query参数

|    名称     |   类型   | 是否必填 |        示例值         |                                     描述                                      |

|-----------|--------|------|--------------------|-----------------------------------------------------------------------------|

| appkey    | String | 是    | dingeqqpkv3xxxx    | 应用的唯一标识key。                                                                 |

| appsecret | String | 是    | GT-lsu-taDAsTsxxxx | 应用的密钥。AppKey和AppSecret可在[钉钉开发者后台]([https://open-dev.dingtalk.com/)的应用详情页面获取。](https://open-dev.dingtalk.com/)的应用详情页面获取。) |

## 返回参数

|      名称      |   类型   |           示例值           |           描述           |

|--------------|--------|-------------------------|------------------------|

| access_token | String | fw8ef8we8f76e6f7s8dxxxx | 生成的access_token。       |

| expires_in   | Number | 7200                    | access_token的过期时间，单位秒。 |

| errmsg       | String | ok                      | 返回码描述。                 |

| errcode      | Number | 0                       | 返回码。                   |

## 示例

**请求示例（HTTP）**

```http

GET [https://oapi.dingtalk.com/gettoken?appkey=appkey&appsecret=appsecret](https://oapi.dingtalk.com/gettoken?appkey=appkey&appsecret=appsecret)

```

**请求示例（JAVA SDK）**

```java

DingTalkClient client = new DefaultDingTalkClient("[https://oapi.dingtalk.com/gettoken](https://oapi.dingtalk.com/gettoken)");

OapiGettokenRequest request = new OapiGettokenRequest();

request.setAppkey("appkey");

request.setAppsecret("appsecret");

request.setHttpMethod("GET");

OapiGettokenResponse response = client.execute(request);

System.out.println(response.getBody());

```

**返回示例**

```json

{

    "errcode": 0,

    "access_token": "96fc7a7axxx",

    "errmsg": "ok",

    "expires_in": 7200

}

```

