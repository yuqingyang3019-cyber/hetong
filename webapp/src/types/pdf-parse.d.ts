declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }

  interface PdfParseOptions {
    pagerender?: (pageData: unknown) => string | Promise<string>;
  }

  function pdfParse(dataBuffer: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;

  export default pdfParse;
}
