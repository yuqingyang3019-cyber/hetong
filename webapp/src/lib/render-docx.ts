import { spawn } from "child_process";
import { mkdtemp, writeFile, unlink, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { appLog } from "./app-log";
import { assertDocxSchemaAlignment } from "./contract-schema";
import { buildDocxtplContext } from "./docxtpl-context";
import { generatedContractsDir, getContractTemplateDocxPath } from "./paths";
import { getTemplateConfig } from "./template-config";
import { ensureStorage, newId } from "./storage";
import type { ContractDraft } from "./types";
import type { TemplateType } from "./types";

const alignmentOk = new Set<TemplateType>();

function summarizeRenderData(rd: Record<string, unknown>) {
  const items = rd.items;
  const rowCount = Array.isArray(items) ? items.length : 0;
  const priceItems = rd.priceItems;
  const priceRowCount = Array.isArray(priceItems) ? priceItems.length : 0;
  const scalarKeys = Object.keys(rd).filter(
    (k) => k !== "items" && k !== "priceItems" && k !== "buyer" && k !== "supplier",
  );
  return { rowCount, priceRowCount, scalarKeySample: scalarKeys.slice(0, 40), scalarKeyCount: scalarKeys.length };
}

function runPythonRender(pythonBin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(pythonBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.length ? Buffer.concat(stderr).toString("utf8") : `docxtpl 退出码 ${code}`));
    });
  });
}

export async function renderContract(draft: ContractDraft) {
  const config = getTemplateConfig(draft.templateType);
  if (!alignmentOk.has(config.type)) {
    assertDocxSchemaAlignment(config.type);
    alignmentOk.add(config.type);
  }

  await ensureStorage();
  const templatePath = getContractTemplateDocxPath(config.type);
  const rd = draft.renderData as Record<string, unknown>;
  appLog.info("render-docx", "render start (docxtpl)", {
    templateType: draft.templateType,
    resolvedTemplateType: config.type,
    templatePath,
    ...summarizeRenderData(rd),
    missingFieldCount: draft.missingFields?.length ?? 0,
    warningCount: draft.warnings?.length ?? 0,
  });

  const context = buildDocxtplContext(rd, config);
  const tmpDir = await mkdtemp(path.join(tmpdir(), "docxtpl-ctx-"));
  const contextPath = path.join(tmpDir, "context.json");
  await writeFile(contextPath, JSON.stringify(context), "utf8");

  const scriptPath = path.join(process.cwd(), "scripts", "render-contract-docxtpl.py");
  const pythonBin = process.env.DOCXTPL_PYTHON?.trim() || process.env.PYTHON?.trim() || "python3";

  const id = newId("contract");
  const fileName = `${id}.docx`;
  const outputPath = path.join(generatedContractsDir, fileName);

  try {
    await runPythonRender(pythonBin, [scriptPath, templatePath, contextPath, outputPath]);
  } finally {
    await unlink(contextPath).catch(() => {});
    await rm(tmpDir, { recursive: true }).catch(() => {});
  }

  await readFile(outputPath);

  return {
    id,
    outputPath,
    downloadUrl: `/api/contracts/${id}/download`,
  };
}
