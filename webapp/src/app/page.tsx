"use client";

import { FormEvent, useState } from "react";
import type { TemplateType } from "../lib/types";
import { templateSelectOptions } from "../lib/template-ui-options";

type SourceFile = {
  originalName: string;
  storedPath: string;
  mimeType: string;
  size: number;
};

type QuotePreview = {
  sourceFile: SourceFile;
  quoteText: string;
  textLength: number;
};

function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function getStepClass(active: boolean, done: boolean) {
  if (done) return "step is-done";
  if (active) return "step is-active";
  return "step";
}

export default function Home() {
  const [templateType, setTemplateType] = useState<TemplateType>("caigouhetong");
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<QuotePreview | null>(null);
  const [quoteText, setQuoteText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function parseQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("请先选择报价单文件");
      return;
    }
    setParsing(true);
    setPreview(null);
    setQuoteText("");
    setError(null);
    try {
      const formData = new FormData();
      formData.set("quote", file);
      const response = await fetch("/api/quote-text", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "解析报价单失败");
        return;
      }
      const nextPreview = (await response.json()) as QuotePreview;
      setPreview(nextPreview);
      setQuoteText(nextPreview.quoteText);
    } catch {
      setError("网络异常，解析请求未完成，请稍后重试");
    } finally {
      setParsing(false);
    }
  }

  async function generateDraft() {
    if (!preview) {
      setError("请先完成本地解析");
      return;
    }
    if (!quoteText.trim()) {
      setError("解析文本为空，无法继续 LLM 抽取");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/contract-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceFile: preview.sourceFile,
          quoteText,
          templateType,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "创建草稿失败");
        return;
      }
      const draft = await response.json();
      window.location.href = `/contracts/drafts/${draft.id}`;
    } catch {
      setError("网络异常，草稿创建未完成，请稍后重试");
    } finally {
      setGenerating(false);
    }
  }

  function resetFile(nextFile: File | null) {
    setFile(nextFile);
    setPreview(null);
    setQuoteText("");
    setError(null);
  }

  const selectedTemplate = templateSelectOptions.find((opt) => opt.type === templateType);
  const hasParsedText = Boolean(preview && quoteText.trim());
  const canParse = Boolean(file) && !parsing && !generating;
  const canGenerate = hasParsedText && !parsing && !generating;
  const currentStatus = generating
    ? "正在抽取合同字段"
    : parsing
      ? "正在解析报价单"
      : preview
        ? "请确认解析文本"
        : file
          ? "报价单已就绪"
          : "等待上传报价单";

  return (
    <main className="workspace">
      <header className="app-hero">
        <div>
          <span className="eyebrow">合同生成工作台</span>
          <h1>上传报价单，确认后生成合同草稿</h1>
          <p className="muted">按步骤完成文件解析、文本确认和字段抽取，适合在钉钉内作为轻量合同协作入口使用。</p>
        </div>
        <div className="status-card" aria-live="polite">
          <span>当前状态</span>
          <strong>{currentStatus}</strong>
        </div>
      </header>

      <section className="steps" aria-label="合同生成进度">
        <div className={getStepClass(!preview, Boolean(file && preview))}>
          <span className="step-number">1</span>
          <div>
            <strong>上传报价单</strong>
            <p>选择合同模板和报价单文件</p>
          </div>
        </div>
        <div className={getStepClass(Boolean(preview), hasParsedText)}>
          <span className="step-number">2</span>
          <div>
            <strong>确认解析文本</strong>
            <p>检查内容，必要时手动修正</p>
          </div>
        </div>
        <div className={getStepClass(generating, false)}>
          <span className="step-number">3</span>
          <div>
            <strong>生成合同草稿</strong>
            <p>抽取字段后进入草稿确认页</p>
          </div>
        </div>
      </section>

      <section className="card grid">
        <div className="section-heading">
          <div>
            <span className="section-kicker">步骤 1</span>
            <h2>选择模板和报价单</h2>
            <p className="muted">支持 PDF、Excel、图片和 TXT。文件越清晰，后续字段抽取越稳定。</p>
          </div>
        </div>

        <form className="grid" onSubmit={parseQuote} aria-busy={parsing}>
          <div className="form-grid">
            <label>
              合同模板
              <select value={templateType} onChange={(e) => setTemplateType(e.target.value as TemplateType)} disabled={parsing || generating}>
                {templateSelectOptions.map((opt) => (
                  <option key={opt.type} value={opt.type}>
                    {opt.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label>
              报价单文件
              <input
                type="file"
                accept=".pdf,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.tif,.tiff,.txt"
                disabled={parsing || generating}
                onChange={(event) => resetFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="info-panel">
            <div>
              <strong>当前模板</strong>
              <p>{selectedTemplate?.displayName ?? templateType}</p>
            </div>
            <div>
              <strong>已选文件</strong>
              <p>{file ? `${file.name}（${formatFileSize(file.size)}）` : "尚未选择报价单文件"}</p>
            </div>
          </div>

          {error ? <p className="alert error" role="alert">{error}</p> : null}
          {parsing ? <p className="alert info">正在读取文件内容，请保持页面打开。</p> : null}
          <div className="actions">
            <button disabled={!canParse}>{parsing ? "解析中..." : "开始解析报价单"}</button>
            <span className="action-hint">{file ? "解析后可在下一步人工确认文本" : "请先选择报价单文件"}</span>
          </div>
        </form>
      </section>

      {preview ? (
        <section className="card grid">
          <div className="section-heading">
            <div>
              <span className="section-kicker">步骤 2</span>
              <h2>确认解析文本</h2>
              <p className="muted">
                文件：{preview.sourceFile.originalName}，已提取 {quoteText.length} 个字符。你可以先检查或修改文本，再继续 LLM 抽取。
              </p>
            </div>
            <span className="pill">{preview.textLength} 字符</span>
          </div>
          <textarea aria-label="报价单解析文本" value={quoteText} onChange={(event) => setQuoteText(event.target.value)} />
          <div className="actions">
            <button type="button" disabled={!canGenerate} onClick={generateDraft}>
              {generating ? "正在生成草稿..." : "确认文本并生成合同草稿"}
            </button>
            <button type="button" className="secondary" disabled={generating || parsing} onClick={() => setQuoteText(preview.quoteText)}>
              恢复原始解析文本
            </button>
            <span className="action-hint">生成后将进入草稿确认页。</span>
          </div>
        </section>
      ) : null}
    </main>
  );
}
