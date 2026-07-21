import { randomBytes } from "node:crypto";
import { app, BrowserWindow, dialog, shell } from "electron";
import { createCliExportAdapter } from "../../../src/server/share-export.js";
import { startShareServer } from "../../../src/server/share-server.js";
import { AppController } from "./app-controller.js";
import { createElectronRuntime } from "./electron-runtime.js";

app.setName("Airgap");

const runtime = createElectronRuntime({
  app,
  createBrowserWindow: (options) => new BrowserWindow(options),
  shell,
  dialog,
});

const controller = AppController.acquire({
  runtime,
  startShareServer,
  createAccessToken: () => randomBytes(32).toString("base64url"),
  // Task 4 replaces this temporary bridge with the native Electron adapter.
  exportAdapter: createCliExportAdapter(),
});

if (controller) {
  app.on("window-all-closed", () => {
    void controller.shutdown();
  });

  app.on("before-quit", (event) => {
    if (controller.state === "closed") return;
    event.preventDefault();
    void controller.shutdown();
  });

  void app.whenReady()
    .then(() => controller.start())
    .catch((error: unknown) => {
      runtime.reportError(error, "startup");
      return controller.shutdown();
    });
}
