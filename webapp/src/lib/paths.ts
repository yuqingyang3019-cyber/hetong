import path from "path";
import type { TemplateType } from "./types";

export const appRoot = process.cwd();
export const workspaceRoot = path.resolve(appRoot, "..");
export const templatesRoot = path.join(appRoot, "templates");
export const originalTemplatesDir = path.join(templatesRoot, "original");
export const docxTemplatesDir = path.join(templatesRoot, "docx");
export const placeholderTemplatesDir = path.join(templatesRoot, "placeholder");
export const storageRoot = path.join(appRoot, "storage");
export const uploadsDir = path.join(storageRoot, "uploads");
export const draftsDir = path.join(storageRoot, "drafts");
export const generatedContractsDir = path.join(storageRoot, "generated-contracts");

/** 部署包内合同模板目录。 */
export const zhanweifuDir = path.join(templatesRoot, "zhanweifu");

const TEMPLATE_BASENAME: Record<TemplateType, string> = {
  caigouhetong: "caigouhetong",
  nonStandardNoInstall: "non-standard-no-install",
  nonStandardWithInstall: "non-standard-with-install",
  annualFramework: "annual-framework",
  professionalSubcontract: "professional-subcontract",
  laborSubcontract: "labor-subcontract",
};

export function getContractTemplateBasename(templateType: TemplateType): string {
  return TEMPLATE_BASENAME[templateType];
}

export function getContractTemplateDocxPath(templateType: TemplateType): string {
  const base = TEMPLATE_BASENAME[templateType];
  return path.join(zhanweifuDir, `${base}.docx`);
}

export function getContractPlaceholderSchemaPath(templateType: TemplateType): string {
  const base = TEMPLATE_BASENAME[templateType];
  return path.join(zhanweifuDir, `${base}.placeholders.json`);
}
