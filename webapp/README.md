# 合同生成 MVP

一个 Next.js 全栈应用：上传报价单、本地解析（PDF 优先 `pdfplumber`，Excel 走结构化表格提取）、百炼 DashScope 按 zhanweifu 下的模板字段契约匹配报价内容、人工确认后由 Python **docxtpl** 生成 `.docx` 合同。

## 环境变量

复制 `.env.example` 为 `.env.local`，填写：

- **DASHSCOPE_API_KEY**：百炼 API Key（OpenAI-compatible）。
- **ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET**：RAM 用户 AK，用于图片 OCR 或无文本层 PDF 的 OCR 兜底。
- **ALIYUN_OCR_ENDPOINT**：如 `ocr-api.cn-hangzhou.aliyuncs.com`。
- **ALIYUN_OCR_SCENE**：对应 RecognizeAllText 的 `Type`，报价单图片建议使用 `Advanced`。
- **ALIYUN_OCR_OUTPUT_TABLE**：`Advanced` 模式下是否输出表格识别结果，报价单建议 `true`。
- **ALIYUN_OCR_LINELESS_TABLE**：无线表格/只有横线时可设为 `true`，默认 `false`。
- **CONTRACT_APP_LOG_DIR**（可选）：设为可写目录时，应用日志（含 LLM 入参/出参、`render-docx` 渲染摘要等）会按日期追加写入文件，便于对照浙东类报价排查合同映射。

未配置或 OCR/LLM 调用失败时接口会返回 **502** 与明确错误信息，不做静默兜底。带文本层的 PDF 会先本地提取文字并直接送入 LLM，不依赖 OCR。

## 启动

```bash
cp .env.example .env.local
npm install
python3 -m pip install -r requirements.txt
npm run dev
```

合同模板与字段契约位于仓库根目录 `zhanweifu/`（须与 Word 中 Jinja 占位符一致）。生成合同时会调用 Python `docxtpl`；可通过 **DOCXTPL_PYTHON** 指定解释器（需已安装 `requirements.txt` 中的依赖）。

`npm run prepare-templates` 仅用于历史多模板占位符流水线；当前运行时**不依赖**该步骤。

报价单支持 **PDF、Excel、图片、TXT**：

- PDF 会优先用 Python `pdfplumber` 尽量还原有线框/复杂表格结构，再回退到 JS 文本层提取；扫描件 PDF 仍会走 OCR。
- Excel `.xlsx/.xls` 会走本地 Python 结构化解析，输出工作表、HTML 表格和 TSV，不依赖 OCR；可用 **EXCEL_EXTRACT_PYTHON** 指定解释器。
- 图片 `.jpg/.png/.webp/.tif/.tiff` 直接走阿里云 OCR。建议使用 `ALIYUN_OCR_SCENE=Advanced` 并开启 `ALIYUN_OCR_OUTPUT_TABLE=true`；返回的 `TableInfo` 会被整理成 HTML 表格和 TSV 一起送入 LLM。图片转 PDF 不会自动生成文本层，因此不建议绕到 PDF 解析链路。阿里云 body 最大 10MB，过大的图片需要先压缩或裁剪。
- 纯文本 `.txt` 会按 UTF-8 读取。

若需指定 Python 解释器，可设置 `PDFPLUMBER_PYTHON`、`EXCEL_EXTRACT_PYTHON` 或 `DOCXTPL_PYTHON`（例如指向同一 venv 的 `python3`）。
