import { describe, expect, it } from "vitest";
import { POST } from "@/app/ag-ui/agent/route";

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
});
