import { describe, expect, it } from "vitest";
import { POST } from "@/app/ag-ui/agent/route";
import { GET as downloadUpload } from "@/app/api/uploads/[id]/download/route";

describe("/ag-ui/agent", () => {
  it("streams AGUI lifecycle events for health checks", async () => {
    const request = new Request("http://localhost/ag-ui/agent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        threadId: "thread_test",
        runId: "run_test",
        state: {},
        messages: [{ id: "msg_test", role: "user", content: "健康检查" }],
        tools: [],
        context: [],
        forwardedProps: { healthCheck: true },
      }),
    });

    const response = await POST(request);
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain('"type":"RUN_STARTED"');
    expect(body).toContain('"type":"TEXT_MESSAGE_CONTENT"');
    expect(body).toContain('"type":"RUN_FINISHED"');
  });

  it("saves AGUI document input and returns a download link", async () => {
    const fileContent = "hello attachment";
    const request = new Request("http://localhost/ag-ui/agent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        threadId: "thread_test",
        runId: "run_test",
        state: {},
        messages: [
          {
            id: "msg_test",
            role: "user",
            content: [
              { type: "text", text: "测试附件" },
              {
                type: "document",
                source: {
                  type: "data",
                  value: Buffer.from(fileContent, "utf8").toString("base64"),
                  mimeType: "text/plain",
                },
                metadata: { fileName: "quote.txt" },
              },
            ],
          },
        ],
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    });

    const response = await POST(request);
    const body = await response.text();
    const match = body.match(/\/api\/uploads\/([^"]+)\/download/);

    expect(body).toContain('"name":"attachment_received"');
    expect(body).toContain("附件已收到并保存");
    expect(match?.[1]).toBeTruthy();

    const downloadResponse = await downloadUpload(new Request("http://localhost/download"), {
      params: Promise.resolve({ id: decodeURIComponent(match?.[1] ?? "") }),
    });
    await expect(downloadResponse.text()).resolves.toBe(fileContent);
  });

  it("does not treat short greetings as attachments", async () => {
    const request = new Request("http://localhost/ag-ui/agent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        threadId: "thread_test",
        runId: "run_test",
        state: {},
        messages: [{ id: "msg_test", role: "user", content: "hi" }],
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    });

    const response = await POST(request);
    const body = await response.text();

    expect(body).toContain("未收到 AGUI 附件");
    expect(body).toContain('"needsAttachment":true');
    expect(body).not.toContain("开始生成合同");
  });
});
