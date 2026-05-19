import OpenAI from "openai";
import type { TemplateConfig } from "./template-config";
import { buildLlmOutputShape } from "./template-llm-shape";
import { appLog } from "./app-log";
import { getDashScopeConfig } from "./aliyun-env";
import { pruneLlmPatch } from "./merge-render-data";
import { loadContractPlaceholderSchema } from "./contract-schema";

const systemPrompt = `你是合同占位符字段匹配助手。你的任务是根据用户提供的报价单解析文本，理解采购内容与表格结构，再按「合同模板字段契约」输出 JSON。
规则：
1. 只输出严格 JSON，不要 Markdown、解释或其它文本。
2. 输出中的字段名必须与字段契约中的英文 key 完全一致；禁止输出契约中未声明的字段名。
3. 标量字段在报价单中找不到依据时填 null；不要凭常识编造公司税号、银行账号等商务标识信息。
4. 可以根据同义词、列名、上下文做合理匹配（例如「供方」「乙方」对应 supplierName；含税总价、大写金额对应 totalAmountChinese 等）。
5. items 为数组：报价单中凡单独计价的一行（主设备、配件、运费等）各占一行；每行对象只包含契约声明的列，无法确定的列填 null。
6. 不要合并多笔计价到一行；不要把页脚总价误填到某一明细行的 totalPrice。
7. 表格示例行在输入里仅为结构示意，你必须按报价单实际行数输出多行。`;

export async function extractTemplateRenderData(text: string, config: TemplateConfig): Promise<Record<string, unknown>> {
  const { apiKey, baseURL, model, enableThinking } = getDashScopeConfig();
  const client = new OpenAI({ apiKey, baseURL });

  const schema = loadContractPlaceholderSchema(config.type);
  const outputShape = buildLlmOutputShape(config);
  const userPayload: Record<string, unknown> = {
    quoteText: text,
    templateFieldDefinitions: {
      scalars: schema.scalars,
      tables: schema.tables,
    },
    outputShapeExample: outputShape,
  };
  const userContent = JSON.stringify(userPayload);

  appLog.info("llm-extract", "LLM input", {
    model,
    baseURL,
    enableThinking,
    templateType: config.type,
    systemPrompt,
    userPayload,
  });

  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: userContent,
      },
    ],
    ...(enableThinking ? { extra_body: { enable_thinking: true } } : {}),
  } as never);

  const content = completion.choices[0]?.message.content;
  appLog.info("llm-extract", "LLM raw output", {
    templateType: config.type,
    finishReason: completion.choices[0]?.finish_reason ?? null,
    content,
  });
  if (!content || !content.trim()) {
    throw new Error("百炼模型返回内容为空");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("百炼模型返回的不是合法 JSON");
  }

  delete parsed.quoteText;
  delete parsed.templateFieldDefinitions;
  delete parsed.outputShapeExample;
  const pruned = pruneLlmPatch(parsed, config);
  appLog.info("llm-extract", "LLM pruned output", {
    templateType: config.type,
    pruned,
  });
  return pruned;
}
