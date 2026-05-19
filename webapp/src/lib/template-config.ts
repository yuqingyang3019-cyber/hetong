import path from "path";
import { readFileSync } from "fs";
import type { TemplateType } from "./types";
import type { ContractPlaceholderSchema } from "./contract-schema";
import { getContractPlaceholderSchemaPath, getContractTemplateDocxPath } from "./paths";

export type TemplateConfig = {
  type: TemplateType;
  displayName: string;
  /** 保留字段：历史兼容，不再用于运行时路径 */
  sourceFileName: string;
  placeholderFileName: string;
  requiredFields: string[];
  optionalFields: string[];
  llmScalarPaths: string[];
  defaultFields: Record<string, string>;
  tableBindings: Record<string, string[]>;
};

function readSchemaFile(templateType: TemplateType): ContractPlaceholderSchema {
  const p = getContractPlaceholderSchemaPath(templateType);
  return JSON.parse(readFileSync(p, "utf8")) as ContractPlaceholderSchema;
}

function buildConfig(type: TemplateType, displayName: string): TemplateConfig {
  const schema = readSchemaFile(type);
  const scalarKeys = schema.scalars.map((s) => s.key);
  const tableBindings: Record<string, string[]> = {};
  for (const [name, def] of Object.entries(schema.tables)) {
    tableBindings[name] = def.columns.map((c) => c.key);
  }
  return {
    type,
    displayName,
    sourceFileName: schema.template.docx,
    placeholderFileName: path.basename(getContractTemplateDocxPath(type)),
    requiredFields: Object.keys(tableBindings),
    optionalFields: scalarKeys,
    llmScalarPaths: scalarKeys,
    defaultFields: {},
    tableBindings,
  };
}

export const templateConfigs: Record<TemplateType, TemplateConfig> = {
  caigouhetong: buildConfig("caigouhetong", "采购合同（通用设备）"),
  nonStandardNoInstall: buildConfig("nonStandardNoInstall", "设备采购合同（不含安装）"),
  nonStandardWithInstall: buildConfig("nonStandardWithInstall", "设备采购合同（含安装）"),
  annualFramework: buildConfig("annualFramework", "年度采购框架合同"),
  professionalSubcontract: buildConfig("professionalSubcontract", "专业工程分包合同"),
  laborSubcontract: buildConfig("laborSubcontract", "劳务分包合同（清包工）"),
};

export const templateOptions = Object.values(templateConfigs).map((config) => ({
  type: config.type,
  displayName: config.displayName,
}));

const LEGACY_TO_TEMPLATE: Record<string, TemplateType> = {
  generalEquipment: "caigouhetong",
  caigouhetong: "caigouhetong",
  nonStandardNoInstall: "nonStandardNoInstall",
  nonStandardWithInstall: "nonStandardWithInstall",
  annualFramework: "annualFramework",
  professionalSubcontract: "professionalSubcontract",
  laborSubcontract: "laborSubcontract",
};

export function getTemplateConfig(type: string): TemplateConfig {
  const mapped = LEGACY_TO_TEMPLATE[type];
  if (mapped && templateConfigs[mapped]) {
    return templateConfigs[mapped];
  }
  if (type && type in templateConfigs) {
    return templateConfigs[type as TemplateType];
  }
  return templateConfigs.caigouhetong;
}
