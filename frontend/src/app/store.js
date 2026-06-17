import { reactive } from "../petite-vue.es.js";

export const ui = reactive({
  userName: "你",
  sessionReady: false,
  tasks: [],
  activeTaskId: null,
  drawerOpen: false,
  drawerSheetOpen: false,
  createPanelOpen: false,
  pendingQuoteFile: null,
  createTemplateType: "simpleContract",
  drawerTitle: "确认解析文本并补充信息",
  drawerHint: "请检查当前任务的报价单解析文本，必要时可直接修正；额外信息会和解析文本一起交给 LLM 识别合同字段。",
  drawerStep: "",
  drawerStepTask: null,
  processingVisible: false,
  processingTitle: "任务处理中",
  processingHint: "请稍候，系统正在处理当前报价单。",
});
