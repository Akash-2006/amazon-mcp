import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AmazonBrowser } from "./browser.js";
import { createServer } from "./server.js";

const browser = new AmazonBrowser();
const server = createServer(browser);
let stopping = false;

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await server.close();
  await browser.close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().catch((error: unknown) => {
      console.error("Shutdown failed:", error);
      process.exitCode = 1;
    });
  });
}

const transport = new StdioServerTransport();
await server.connect(transport);
const onClose = transport.onclose;
transport.onclose = () => {
  onClose?.();
  void browser.close().catch((error: unknown) => {
    console.error("Browser cleanup failed:", error);
    process.exitCode = 1;
  });
};
