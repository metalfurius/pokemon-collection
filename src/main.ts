import { mountApp } from "./ui/app";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("App root is missing");
document.documentElement.dataset.revision = __POCKETDEX_REVISION__;
mountApp(root);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
    const serviceWorkerUrl = new URL("sw.js", baseUrl);
    serviceWorkerUrl.searchParams.set("revision", __POCKETDEX_REVISION__);
    void navigator.serviceWorker.register(serviceWorkerUrl, { scope: baseUrl.pathname });
  });
}
