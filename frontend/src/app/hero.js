import { createApp } from "../petite-vue.es.js";
import { ui } from "./store.js";

export function mountHero() {
  createApp({ ui }).mount(".hero-copy");
}
