export const TEMPLATE_OPTIONS = Object.freeze([
  { value: "simpleContract", label: "简易合同（产品购销）" },
  { value: "caigouhetong", label: "采购合同（通用设备）" },
  { value: "nonStandardNoInstall", label: "设备采购合同（不含安装）" },
  { value: "nonStandardWithInstall", label: "设备采购合同（含安装）" },
  { value: "annualFramework", label: "年度采购框架合同" },
  { value: "professionalSubcontract", label: "专业工程分包合同" },
  { value: "laborSubcontract", label: "劳务分包合同（清包工）" },
  { value: "supplementaryAgreement", label: "合同补充协议书" },
]);

export function templateLabel(value) {
  return TEMPLATE_OPTIONS.find((item) => item.value === value)?.label || value;
}
