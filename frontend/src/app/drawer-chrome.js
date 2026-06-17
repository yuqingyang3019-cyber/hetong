import { createApp, watch } from "../petite-vue.es.js";
import { ui } from "./store.js";

const taskDrawer = document.querySelector("#taskDrawer");
const taskDrawerBackdrop = document.querySelector("#taskDrawerBackdrop");
const closeTaskDrawerButton = document.querySelector("#closeTaskDrawerButton");
let drawerLastFocus = null;

function applyDrawerSheet(open) {
  document.body.classList.toggle("drawer-open", open);
  if (taskDrawer) {
    const wasOpen = !taskDrawer.hidden;
    taskDrawer.hidden = !open;
    taskDrawer.setAttribute("aria-hidden", open ? "false" : "true");
    if (open && !wasOpen) {
      drawerLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      window.setTimeout(() => closeTaskDrawerButton?.focus(), 0);
    }
    if (!open && wasOpen && drawerLastFocus && document.contains(drawerLastFocus)) {
      drawerLastFocus.focus();
      drawerLastFocus = null;
    }
  }
  if (taskDrawerBackdrop) taskDrawerBackdrop.hidden = !open;
}

watch(
  () => ui.drawerSheetOpen,
  (open) => {
    applyDrawerSheet(open);
  },
);

function drawerStepClass(stepId) {
  const order = ["upload", "text", "review", "generate"];
  const normalizedStep = ui.drawerStep;
  const activeIndex = order.indexOf(normalizedStep);
  const task = ui.drawerStepTask;
  const skipUploadAndText = Boolean(task?.manualEntry && normalizedStep === "review");
  const classes = [];
  if (normalizedStep === "done") {
    return "is-complete";
  }
  const itemIndex = order.indexOf(stepId);
  if (skipUploadAndText && (stepId === "upload" || stepId === "text")) {
    classes.push("is-complete");
  } else if (itemIndex >= 0 && itemIndex < activeIndex) {
    classes.push("is-complete");
  }
  if (stepId === normalizedStep) {
    classes.push("is-active");
  }
  return classes.join(" ");
}

function drawerStepAria(stepId) {
  return stepId === ui.drawerStep && ui.drawerStep && ui.drawerStep !== "done" ? "step" : false;
}

const drawerAppState = {
  ui,
  drawerStepClass,
  drawerStepAria,
};

export function mountDrawerChrome() {
  applyDrawerSheet(ui.drawerSheetOpen);
  createApp(drawerAppState).mount("#drawerChromeRoot");
  createApp({ ui }).mount("#drawerProcessingRoot");
}
