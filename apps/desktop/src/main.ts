import { randomBytes } from "node:crypto";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  nativeImage,
  shell,
  type NativeImage,
  type SaveDialogOptions,
} from "electron";
import { startShareServer } from "../../../src/server/share-server.js";
import { AppController } from "./app-controller.js";
import { createElectronExportAdapter } from "./electron-export-adapter.js";
import { createElectronRuntime } from "./electron-runtime.js";

app.setName("Airgap");

const runtime = createElectronRuntime({
  app,
  createBrowserWindow: (options) => new BrowserWindow(options),
  shell,
  dialog,
});

const exportAdapter = createElectronExportAdapter({
  createCaptureWindow: (options) => new BrowserWindow(options),
  nativeImage,
  clipboard: {
    writeImage: (image) => clipboard.writeImage(image as NativeImage),
    writeText: (text) => clipboard.writeText(text),
  },
  dialog: {
    showSaveDialog: (parent, options) => parent instanceof BrowserWindow
      ? dialog.showSaveDialog(parent, options as SaveDialogOptions)
      : dialog.showSaveDialog(options as SaveDialogOptions),
  },
  getParentWindow: () => BrowserWindow.getFocusedWindow() ?? undefined,
});

const controller = AppController.acquire({
  runtime,
  startShareServer,
  createAccessToken: () => randomBytes(32).toString("base64url"),
  exportAdapter,
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
