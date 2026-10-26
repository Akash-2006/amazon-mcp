import { chromium, type Browser, type BrowserContext } from "playwright";
import { assertPage } from "./parser.js";

export class AmazonBrowser {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private queue: Promise<void> = Promise.resolve();
  private lastRequest = 0;

  fetch(url: string): Promise<string> {
    const task = this.queue.then(() => this.load(url));
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  private async load(url: string): Promise<string> {
    const target = new URL(url);
    if (target.origin !== "https://www.amazon.in" ||
        !(target.pathname === "/s" || /^\/dp\/[A-Z0-9]{10}$/.test(target.pathname))) {
      throw new Error("Only Amazon India search and ASIN product URLs are allowed.");
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 2000 - (Date.now() - this.lastRequest))));
    this.lastRequest = Date.now();
    if (!this.browser?.isConnected()) {
      this.browser = await chromium.launch({ headless: process.env.AMAZON_HEADLESS !== "false" });
      this.context = await this.browser.newContext({ locale: "en-IN" });
    }
    const context = this.context;
    if (!context) throw new Error("Browser context was not initialized.");
    const page = await context.newPage();
    try {
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (request.isNavigationRequest()) {
          const destination = new URL(request.url());
          if (destination.origin !== "https://www.amazon.in") {
            await route.abort("blockedbyclient");
            return;
          }
        }
        await route.continue();
      });
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const html = await page.content();
      assertPage(html);
      if (!response || !response.ok()) {
        throw new Error(`AMAZON_HTTP_ERROR: Amazon returned HTTP ${response?.status() ?? "no response"}. Try later; no automatic retry was attempted.`);
      }
      return html;
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    await this.queue;
    await this.browser?.close();
    this.browser = undefined;
    this.context = undefined;
  }
}
