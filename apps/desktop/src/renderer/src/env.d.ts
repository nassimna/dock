import type { DesktopBridge } from "@dock/contracts";
import "vite/client";

declare global {
  interface Window {
    dock: DesktopBridge;
  }
}
