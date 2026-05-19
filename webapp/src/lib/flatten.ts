import type { ExtractedContractData, LineItem, PartyFields } from "./types";
import type { TemplateConfig } from "./template-config";

function valueOf<T>(field: { value?: T | null } | undefined, fallback = "") {
  const value = field?.value;
  return value === null || value === undefined ? fallback : String(value);
}

function party(party?: PartyFields) {
  return {
    name: valueOf(party?.name),
    address: valueOf(party?.address),
    bank: valueOf(party?.bank),
    account: valueOf(party?.account),
    taxNo: valueOf(party?.taxNo),
    phone: valueOf(party?.phone),
    fax: valueOf(party?.fax),
    contact: valueOf(party?.contact),
  };
}

function item(row: LineItem, index: number) {
  return {
    index: valueOf(row.index, String(index + 1)),
    name: valueOf(row.name),
    spec: valueOf(row.spec),
    unit: valueOf(row.unit),
    quantity: valueOf(row.quantity),
    unitPrice: valueOf(row.unitPrice),
    totalPrice: valueOf(row.totalPrice),
    tagNo: valueOf(row.tagNo),
    remark: valueOf(row.remark),
    deliveryDays: valueOf(row.deliveryDays),
    projectItem: valueOf(row.projectItem),
    node: valueOf(row.node),
    progressDescription: valueOf(row.progressDescription),
    paymentRate: valueOf(row.paymentRate),
    laborItem: valueOf(row.laborItem),
    model: valueOf(row.model),
    params: valueOf(row.params),
  };
}

export function flattenForRender(data: ExtractedContractData, config: TemplateConfig) {
  const defaults = Object.fromEntries(
    Object.entries(config.defaultFields).map(([key, value]) => [key.replace(".", "_"), value]),
  );

  return {
    ...defaults,
    contractNo: valueOf(data.contractNo),
    signPlace: valueOf(data.signPlace, config.defaultFields.signPlace ?? ""),
    signDateText: valueOf(data.signDateText),
    projectName: valueOf(data.projectName),
    purchaseSubject: valueOf(data.purchaseSubject),
    engineeringLocation: valueOf(data.engineeringLocation),
    engineeringScope: valueOf(data.engineeringScope),
    workDescription: valueOf(data.workDescription),
    buyer: party(data.buyer),
    supplier: party(data.supplier),
    quoteNo: valueOf(data.quote?.quoteNo),
    quoteDate: valueOf(data.quote?.quoteDate),
    validUntil: valueOf(data.quote?.validUntil),
    taxRate: valueOf(data.commercial?.taxRate),
    deliveryDays: valueOf(data.commercial?.deliveryDays),
    deliveryDateText: valueOf(data.commercial?.deliveryDateText),
    paymentTerms: valueOf(data.commercial?.paymentTerms),
    shippingFee: valueOf(data.commercial?.shippingFee),
    installPeriodDays: valueOf(data.commercial?.installPeriodDays),
    totalAmount: valueOf(data.totalAmount),
    totalAmountChinese: valueOf(data.totalAmountChinese),
    amountWithoutTax: valueOf(data.amountWithoutTax),
    taxAmount: valueOf(data.taxAmount),
    items: (data.items ?? []).map(item),
    priceItems: (data.priceItems ?? []).map(item),
  };
}
