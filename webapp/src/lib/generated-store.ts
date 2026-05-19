import { readdir } from "fs/promises";
import path from "path";
import { generatedContractsDir } from "./paths";

export async function findGeneratedContract(id: string) {
  const files = await readdir(generatedContractsDir);
  const file = files.find((name) => name === `${id}.docx`);
  return file ? path.join(generatedContractsDir, file) : null;
}
