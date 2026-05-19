"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { ContractDraft } from "@/lib/types";

type PageProps = {
  params: Promise<{ id: string }>;
};

type ActionState = "idle" | "loading" | "saving" | "rendering";

type StatusMessage = {
  type: "info" | "success" | "error";
  text: string;
};

export default function DraftPage({ params }: PageProps) {
  const { id } = use(params);
  const [draft, setDraft] = useState<ContractDraft | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [action, setAction] = useState<ActionState>("loading");
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    setAction("loading");
    setStatus(null);
    fetch(`/api/contract-drafts/${id}`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "草稿加载失败");
        }
        return response.json();
      })
      .then((data: ContractDraft) => {
        if (ignore) return;
        setDraft(data);
        setJsonText(JSON.stringify(data.extractedData, null, 2));
        setAction("idle");
      })
      .catch((error: unknown) => {
        if (ignore) return;
        setAction("idle");
        setStatus({
          type: "error",
          text: error instanceof Error ? error.message : "草稿加载失败，请刷新后重试",
        });
      });

    return () => {
      ignore = true;
    };
  }, [id]);

  function parseJsonInput() {
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setStatus({ type: "error", text: "JSON 顶层必须是对象，请检查后再继续" });
        return null;
      }
      return parsed;
    } catch (error) {
      setStatus({
        type: "error",
        text: error instanceof Error ? `JSON 格式错误：${error.message}` : "JSON 格式错误，请检查括号、逗号和引号",
      });
      return null;
    }
  }

  async function save() {
    const extractedData = parseJsonInput();
    if (!extractedData) return;
    setAction("saving");
    setStatus({ type: "info", text: "正在保存修正..." });
    setDownloadUrl(null);
    try {
      const response = await fetch(`/api/contract-drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extractedData }),
      });
      const next = await response.json();
      if (!response.ok) {
        setStatus({ type: "error", text: next.error ?? "保存失败，请稍后重试" });
        return;
      }
      setDraft(next);
      setJsonText(JSON.stringify(next.extractedData, null, 2));
      setStatus({ type: "success", text: "已保存修正，校验结果已更新" });
    } catch {
      setStatus({ type: "error", text: "网络异常，保存请求未完成，请稍后重试" });
    } finally {
      setAction("idle");
    }
  }

  async function render() {
    const extractedData = parseJsonInput();
    if (!extractedData) return;
    setAction("rendering");
    setStatus({ type: "info", text: "正在生成合同，请不要重复点击..." });
    setDownloadUrl(null);
    try {
      const response = await fetch("/api/contracts/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id, extractedData }),
      });
      const result = await response.json();
      if (!response.ok || !result.downloadUrl) {
        setStatus({ type: "error", text: result.error ?? "生成失败，请检查字段后重试" });
        return;
      }
      setDownloadUrl(result.downloadUrl);
      setStatus({ type: "success", text: "合同已生成。如果没有自动下载，请点击下方下载链接。" });
      window.location.href = result.downloadUrl;
    } catch {
      setStatus({ type: "error", text: "网络异常，合同生成请求未完成，请稍后重试" });
    } finally {
      setAction("idle");
    }
  }

  if (action === "loading") {
    return (
      <main className="workspace">
        <div className="card empty-state">
          <span className="loading-dot" aria-hidden="true" />
          <p>正在加载合同草稿...</p>
        </div>
      </main>
    );
  }

  if (!draft) {
    return (
      <main className="workspace">
        <div className="card empty-state">
          <h1>草稿加载失败</h1>
          {status ? <p className="alert error" role="alert">{status.text}</p> : null}
          <Link className="text-link" href="/">
            返回工作台
          </Link>
        </div>
      </main>
    );
  }

  const busy = action === "saving" || action === "rendering";
  const statusClass = status ? `alert ${status.type}` : "";

  return (
    <main className="workspace">
      <header className="app-hero">
        <div>
          <Link className="breadcrumb" href="/">
            工作台 / 合同草稿
          </Link>
          <h1>核对字段并生成合同</h1>
          <p className="muted">先确认字段内容，再保存修正或直接生成合同。找不到的字段保留为 null，可在 JSON 中人工补全。</p>
        </div>
        <div className="status-card" aria-live="polite">
          <span>草稿状态</span>
          <strong>{busy ? (action === "saving" ? "正在保存" : "正在生成") : downloadUrl ? "已生成合同" : "待确认"}</strong>
        </div>
      </header>

      <div className="card grid">
        <div className="section-heading">
          <div>
            <span className="section-kicker">草稿摘要</span>
            <h2>基础信息</h2>
            <p className="muted">创建于 {new Date(draft.createdAt).toLocaleString("zh-CN")}，最近更新 {new Date(draft.updatedAt).toLocaleString("zh-CN")}</p>
          </div>
          <span className="pill">{draft.templateType}</span>
        </div>

        <div className="info-panel">
          <div>
            <strong>源文件</strong>
            <p>{draft.sourceFile.originalName}</p>
          </div>
          <div>
            <strong>草稿 ID</strong>
            <p>{draft.id}</p>
          </div>
        </div>

        {draft.missingFields.length ? (
          <div className="notice-block warning-block">
            <h3>缺失字段</h3>
            <p className="warning">{draft.missingFields.join("、")}</p>
          </div>
        ) : null}

        {draft.warnings.length ? (
          <div className="notice-block">
            <h3>校验提示</h3>
            <ul>
              {draft.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <section className="editor-panel">
          <div className="section-heading">
            <div>
              <span className="section-kicker">字段确认</span>
              <h2>占位符 JSON</h2>
              <p className="muted">内容需与合同模板字段一致。保存前会校验 JSON 格式。</p>
            </div>
          </div>
          <label>
            字段内容
            <textarea
              aria-label="合同草稿字段 JSON"
              value={jsonText}
              disabled={busy}
              onChange={(event) => {
                setJsonText(event.target.value);
                if (status?.type === "error") setStatus(null);
              }}
            />
          </label>
        </section>

        {status ? (
          <p className={statusClass} role={status.type === "error" ? "alert" : "status"}>
            {status.text}
          </p>
        ) : null}
        {downloadUrl ? (
          <div className="download-hint">
            <strong>合同已生成</strong>
            <p>
              下载链接：<a href={downloadUrl}>打开合同 .docx</a>
            </p>
          </div>
        ) : null}

        <div className="actions">
          <button className="secondary" disabled={busy} onClick={save}>
            {action === "saving" ? "正在保存..." : "保存修正"}
          </button>
          <button disabled={busy} onClick={render}>
            {action === "rendering" ? "正在生成合同..." : "生成合同 .docx"}
          </button>
          <span className="action-hint">建议先保存人工修正，再生成正式合同。</span>
        </div>
      </div>
    </main>
  );
}
