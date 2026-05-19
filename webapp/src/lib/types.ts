export type TemplateType =
  | "caigouhetong"
  | "nonStandardNoInstall"
  | "nonStandardWithInstall"
  | "annualFramework"
  | "professionalSubcontract"
  | "laborSubcontract";

export type EvidenceValue<T = string> = {
  value: T | null;
  evidence: string | null;
  page: number | null;
  confidence: number;
};

export type PartyFields = {
  name?: EvidenceValue;
  address?: EvidenceValue;
  bank?: EvidenceValue;
  account?: EvidenceValue;
  taxNo?: EvidenceValue;
  phone?: EvidenceValue;
  fax?: EvidenceValue;
  contact?: EvidenceValue;
};

export type LineItem = {
  index?: EvidenceValue<number | string>;
  name?: EvidenceValue;
  spec?: EvidenceValue;
  unit?: EvidenceValue;
  quantity?: EvidenceValue<number | string>;
  unitPrice?: EvidenceValue<number | string>;
  totalPrice?: EvidenceValue<number | string>;
  tagNo?: EvidenceValue;
  remark?: EvidenceValue;
  deliveryDays?: EvidenceValue<number | string>;
  /** 工程量清单 / 分包 */
  projectItem?: EvidenceValue;
  /** 专业分包付款节点表 */
  node?: EvidenceValue;
  progressDescription?: EvidenceValue;
  paymentRate?: EvidenceValue<number | string>;
  /** 劳务清单 */
  laborItem?: EvidenceValue;
  /** 年度协议价等 */
  model?: EvidenceValue;
  params?: EvidenceValue;
};

export type ExtractedContractData = {
  contractNo?: EvidenceValue;
  signPlace?: EvidenceValue;
  signDateText?: EvidenceValue;
  projectName?: EvidenceValue;
  purchaseSubject?: EvidenceValue;
  /** 工程地点（分包/劳务） */
  engineeringLocation?: EvidenceValue;
  /** 工程范围（分包/劳务） */
  engineeringScope?: EvidenceValue;
  /** 劳务分包工程名称片段 */
  workDescription?: EvidenceValue;
  buyer?: PartyFields;
  supplier?: PartyFields;
  quote?: {
    quoteNo?: EvidenceValue;
    quoteDate?: EvidenceValue;
    validUntil?: EvidenceValue;
  };
  commercial?: {
    taxRate?: EvidenceValue;
    deliveryDays?: EvidenceValue<number | string>;
    deliveryDateText?: EvidenceValue;
    paymentTerms?: EvidenceValue;
    shippingFee?: EvidenceValue<number | string>;
    installPeriodDays?: EvidenceValue<number | string>;
  };
  totalAmount?: EvidenceValue<number | string>;
  totalAmountChinese?: EvidenceValue;
  amountWithoutTax?: EvidenceValue<number | string>;
  taxAmount?: EvidenceValue<number | string>;
  items: LineItem[];
  priceItems?: LineItem[];
  warnings?: string[];
};

export type ContractDraft = {
  id: string;
  /** 与 TemplateType 一致；历史值 generalEquipment 等会映射 */
  templateType: string;
  sourceFile: {
    originalName: string;
    storedPath: string;
    mimeType: string;
    size: number;
  };
  ocrText: string;
  /** LLM 返回的占位符填空（已裁剪为仅模板字段） */
  extractedData: Record<string, unknown>;
  renderData: Record<string, unknown>;
  missingFields: string[];
  warnings: string[];
  createdAt: string;
  updatedAt: string;
};
