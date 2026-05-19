import type { ExtractedContractData } from "./types";
import type { TemplateConfig } from "./template-config";
import { flattenForRender } from "./flatten";
import { buildLlmOutputShape } from "./template-llm-shape";

function emptyExtracted(): ExtractedContractData {
  return {
    items: [],
    priceItems: [],
  };
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function stringifyScalar(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function shanghaiTodayParts() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
  };
}

function fillDateParts(out: Record<string, unknown>, yearKey: string, monthKey: string, dayKey: string) {
  const today = shanghaiTodayParts();
  if (!out[yearKey]) out[yearKey] = today.year;
  if (!out[monthKey]) out[monthKey] = today.month;
  if (!out[dayKey]) out[dayKey] = today.day;
}

/**
 * 只保留当前模板 shape 中出现的键；表格行只保留模板列。
 */
export function pruneLlmPatch(patch: unknown, config: TemplateConfig): Record<string, unknown> {
  const shape = buildLlmOutputShape(config);
  return pickFromShape(shape, patch) as Record<string, unknown>;
}

function pickFromShape(shapeVal: unknown, patchVal: unknown): unknown {
  if (shapeVal === null) {
    if (patchVal === undefined) return null;
    return patchVal;
  }

  if (Array.isArray(shapeVal) && shapeVal.length > 0 && typeof shapeVal[0] === "object" && shapeVal[0] !== null) {
    const templateRow = shapeVal[0] as Record<string, unknown>;
    const cols = Object.keys(templateRow);
    if (!Array.isArray(patchVal)) {
      return cols.reduce<Record<string, unknown>>((acc, c) => {
        acc[c] = null;
        return acc;
      }, {});
    }
    if ((patchVal as unknown[]).length === 0) {
      return [];
    }
    return (patchVal as unknown[]).map((row) => {
      const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const o: Record<string, unknown> = {};
      for (const c of cols) {
        o[c] = Object.prototype.hasOwnProperty.call(r, c) ? r[c] : null;
      }
      return o;
    });
  }

  if (typeof shapeVal === "object" && !Array.isArray(shapeVal)) {
    const s = shapeVal as Record<string, unknown>;
    const p = patchVal && typeof patchVal === "object" && !Array.isArray(patchVal) ? (patchVal as Record<string, unknown>) : {};
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(s)) {
      o[k] = pickFromShape(s[k], p[k]);
    }
    return o;
  }

  return shapeVal;
}

type PartyRecord = Record<string, string>;

function mergeParty(base: PartyRecord, patch: unknown): PartyRecord {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const p = patch as Record<string, unknown>;
  const out = { ...base };
  for (const key of Object.keys(out)) {
    if (Object.prototype.hasOwnProperty.call(p, key)) {
      out[key] = stringifyScalar(p[key], out[key]);
    }
  }
  return out;
}

/**
 * 将 LLM 返回的占位符 JSON 与 flatten 基底合并，得到 docxtpl 渲染用的 renderData。
 */
export function mergeLlmPatchIntoRenderData(patch: unknown, config: TemplateConfig): Record<string, unknown> {
  const pruned = pruneLlmPatch(patch, config);
  const base = flattenForRender(emptyExtracted(), config) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base };

  for (const key of Object.keys(pruned)) {
    const v = pruned[key];
    if (key === "items" || key === "priceItems") {
      if (Array.isArray(v)) {
        out[key] = v.map((row) => {
          const r = row as Record<string, unknown>;
          const normalized: Record<string, string> = {};
          for (const [ck, cv] of Object.entries(r)) {
            normalized[ck] = stringifyCell(cv);
          }
          return normalized;
        });
      }
      continue;
    }
    if (key === "supplier" || key === "buyer") {
      const baseParty = (base[key] as PartyRecord) ?? {};
      out[key] = mergeParty(baseParty, v);
      continue;
    }
    const previous = base[key];
    out[key] = stringifyScalar(v, typeof previous === "string" ? previous : "");
  }

  fillDateParts(out, "signYear", "signMonth", "signDay");
  fillDateParts(out, "signatureYear", "signatureMonth", "signatureDay");

  return out;
}
