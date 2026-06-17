import { createApp } from "../petite-vue.es.js";
import { ui } from "./store.js";
import { TEMPLATE_OPTIONS } from "./constants.js";
import {
  MAX_TASKS,
  downloadTask,
  incompleteTaskCount,
  openCreatePanel,
  closeCreatePanel,
  confirmCreateTask,
  removeTask,
  retryTask,
  selectTask,
  statusLabel,
  taskCardClass,
  taskIsBusy,
  taskNextAction,
  uploadDisabledReason,
} from "./core.js";

function hasTasks() {
  return ui.tasks.length > 0;
}

function createCardDisabled() {
  return !ui.sessionReady || incompleteTaskCount() >= MAX_TASKS;
}

function createCardTitle() {
  return hasTasks() ? "+ 新建报价单任务" : "开始第一份合同";
}

function createCardHint() {
  return createCardDisabled() ? uploadDisabledReason() : "选模板 → 可选上传报价单 → 确认字段后生成";
}

function selectButtonLabel(task) {
  return task.id === ui.activeTaskId && ui.drawerOpen ? "正在查看" : "查看详情";
}

function showTaskDownloadButton(task) {
  return task.status === "completed" && Boolean(task.download?.dingDrive?.fileId);
}

function taskDownloadLabel(task) {
  if (task.downloadState === "downloading") return "正在准备下载...";
  if (task.downloadState === "downloaded") return "再次触发下载";
  return "下载合同文件";
}

function taskDownloadClass(task) {
  const classes = ["btn-download", "task-download"];
  if (task.downloadState === "downloading") classes.push("is-loading");
  if (task.downloadState === "downloaded") classes.push("is-downloaded");
  return classes.join(" ");
}

function taskDownloadPath(task) {
  const payload = task.download;
  if (!payload || payload.dingDrive?.fileId) return "";
  return payload.filePath || payload.dingDrive?.filePath || "";
}

function taskDownloadFallback(task) {
  return task.status === "completed" && task.download && !task.download.dingDrive?.fileId && !taskDownloadPath(task);
}

export function mountTaskBoard() {
  createApp({
    ui,
    TEMPLATE_OPTIONS,
    MAX_TASKS,
    hasTasks,
    createCardDisabled,
    createCardTitle,
    createCardHint,
    selectButtonLabel,
    showTaskDownloadButton,
    taskDownloadLabel,
    taskDownloadClass,
    taskDownloadPath,
    taskDownloadFallback,
    incompleteTaskCount,
    openCreatePanel,
    closeCreatePanel,
    confirmCreateTask,
    removeTask,
    retryTask,
    selectTask,
    statusLabel,
    taskCardClass,
    taskIsBusy,
    taskNextAction,
    downloadTask,
  }).mount("#taskBoard");
}
