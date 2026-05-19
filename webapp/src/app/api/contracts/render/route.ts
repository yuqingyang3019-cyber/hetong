import { NextResponse } from "next/server";
import { appLog } from "@/lib/app-log";
import { getDraft, updateDraft } from "@/lib/draft-store";
import { mergeLlmPatchIntoRenderData } from "@/lib/merge-render-data";
import { normalizeRenderDataFromQuote } from "@/lib/normalize-render-from-quote";
import { renderContract } from "@/lib/render-docx";
import { getTemplateConfig } from "@/lib/template-config";
import { validateDraft } from "@/lib/validate-draft";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    draftId?: string;
    extractedData?: Record<string, unknown>;
  };

  if (!body.draftId) {
    appLog.warn("contracts-render", "reject: missing draftId");
    return NextResponse.json({ error: "缺少 draftId" }, { status: 400 });
  }

  appLog.info("contracts-render", "start", { draftId: body.draftId, hasBodyExtracted: Boolean(body.extractedData) });

  let draft = await getDraft(body.draftId);
  const config = getTemplateConfig(draft.templateType);

  if (body.extractedData) {
    let renderData = mergeLlmPatchIntoRenderData(body.extractedData, config);
    const normalized = normalizeRenderDataFromQuote(renderData, draft.ocrText, config);
    renderData = normalized.renderData;
    const validation = validateDraft(renderData, config);
    const warnings = [...normalized.warnings, ...validation.warnings];
    draft = await updateDraft(draft.id, {
      extractedData: body.extractedData,
      renderData,
      missingFields: validation.missingFields,
      warnings,
    });
    appLog.info("contracts-render", "draft refreshed from body.extractedData", {
      draftId: draft.id,
      missingFieldCount: validation.missingFields.length,
      warningCount: warnings.length,
    });
  }

  const result = await renderContract(draft);
  appLog.info("contracts-render", "docx generated", {
    draftId: draft.id,
    contractId: result.id,
    downloadUrl: result.downloadUrl,
  });
  return NextResponse.json(result);
}
