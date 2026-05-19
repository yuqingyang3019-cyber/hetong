import { readFile, writeFile } from "fs/promises";
import path from "path";
import { draftsDir } from "./paths";
import { ensureStorage } from "./storage";
import type { ContractDraft } from "./types";

function draftPath(id: string) {
  return path.join(draftsDir, `${id}.json`);
}

export async function saveDraft(draft: ContractDraft) {
  await ensureStorage();
  await writeFile(draftPath(draft.id), JSON.stringify(draft, null, 2), "utf8");
  return draft;
}

export async function getDraft(id: string): Promise<ContractDraft> {
  const raw = await readFile(draftPath(id), "utf8");
  return JSON.parse(raw) as ContractDraft;
}

export async function updateDraft(id: string, patch: Partial<ContractDraft>) {
  const current = await getDraft(id);
  const next: ContractDraft = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  return saveDraft(next);
}
