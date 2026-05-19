import type { TemplateType } from "./types";

/** 客户端下拉用（勿引入 fs）；与 template-config 展示名保持一致 */
export const templateSelectOptions: { type: TemplateType; displayName: string }[] = [
  { type: "caigouhetong", displayName: "采购合同（通用设备）" },
  { type: "nonStandardNoInstall", displayName: "设备采购合同（不含安装）" },
  { type: "nonStandardWithInstall", displayName: "设备采购合同（含安装）" },
  { type: "annualFramework", displayName: "年度采购框架合同" },
  { type: "professionalSubcontract", displayName: "专业工程分包合同" },
  { type: "laborSubcontract", displayName: "劳务分包合同（清包工）" },
];
