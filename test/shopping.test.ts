import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AmazonBrowser } from "../src/browser.js";
import { searchSchema, productSchema, searchUrl } from "../src/input.js";
import { assertPage, filterProducts, numeric, parseProduct, parseSearch } from "../src/parser.js";
import { createServer } from "../src/server.js";
import { searchHtml, productHtml } from "./fixtures.js";

test("parses Indian currency, ratings, missing fields and deduplicates ASINs", () => {
  assert.equal(numeric("₹1,23,456.78"), 123456.78);
  assert.equal(numeric(""), null);
  const products = parseSearch(searchHtml);
  assert.equal(products.length, 3);
  assert.deepEqual(products[0], {
    asin: "B012345678", title: "Sony Wireless Headphones",
    url: "https://www.amazon.in/dp/B012345678", price: 2499.5, currency: "INR",
    rating: 4.3, reviewCount: 1234, prime: true, sponsored: false,
    image: "https://example.invalid/sony.jpg",
  });
  assert.equal(products[2]?.price, null);
  assert.equal(products[2]?.rating, null);
});

test("combines inclusive price/rating/brand/Prime filters and excludes sponsored by default", () => {
  const input = searchSchema.parse({
    query: "headphones", minPrice: 2499.5, maxPrice: 2499.5,
    minRating: 4.3, brand: "SONY", primeOnly: true,
  });
  assert.deepEqual(filterProducts(parseSearch(searchHtml), input).map((p) => p.asin), ["B012345678"]);
  assert.equal(filterProducts(parseSearch(searchHtml), searchSchema.parse({ query: "x", maxPrice: 1000 })).length, 0);
  assert.equal(filterProducts(parseSearch(searchHtml), searchSchema.parse({ query: "x", minRating: 4.4 })).length, 0);
});

test("supports live split brand/title headings, mini stars and exact accessible review counts", () => {
  const html = `<div data-component-type="s-search-result" data-asin="B012345678">
    <h2>Sony</h2><h2 aria-label="WH-CH520 Wireless Headphones">WH-CH520 Wireless Headphones</h2>
    <a aria-label="4.2 out of 5 stars, rating details"><i class="a-icon-star-mini"><span class="a-icon-alt">4.2 out of 5 stars</span></i></a>
    <a href="/dp/B012345678#customerReviews" aria-label="32,155 ratings"><span>(32.1K)</span></a>
  </div>`;
  const product = parseSearch(html)[0];
  assert.equal(product?.title, "Sony WH-CH520 Wireless Headphones");
  assert.equal(product?.rating, 4.2);
  assert.equal(product?.reviewCount, 32155);
  const abbreviated = html.replace(' aria-label="32,155 ratings"', "");
  assert.equal(parseSearch(abbreviated)[0]?.reviewCount, 32100);
});

test("sorts price ascending/descending and ratings; unknown values stay last; limits results", () => {
  const products = parseSearch(searchHtml);
  for (const [sort, expected] of [
    ["price_asc", ["B012345679", "B012345678", "B012345680"]],
    ["price_desc", ["B012345678", "B012345679", "B012345680"]],
    ["rating", ["B012345678", "B012345679", "B012345680"]],
  ] as const) {
    const input = searchSchema.parse({ query: "x", includeSponsored: true, sort });
    assert.deepEqual(filterProducts(products, input).map((p) => p.asin), expected);
  }
  assert.equal(filterProducts(products, searchSchema.parse({ query: "x", limit: 1 })).length, 1);
});

test("validates input and constructs encoded Amazon search URLs", () => {
  const input = searchSchema.parse({
    query: "laptop & tablet", minPrice: 1000, maxPrice: 50000,
    primeOnly: true, sort: "price_asc", page: 2,
  });
  const url = new URL(searchUrl(input));
  assert.equal(url.origin, "https://www.amazon.in");
  assert.equal(url.searchParams.get("k"), "laptop & tablet");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("low-price"), "1000");
  assert.equal(url.searchParams.get("high-price"), "50000");
  assert.equal(url.searchParams.get("s"), "price-asc-rank");
  assert.equal(url.searchParams.get("rh"), "p_85:10440599031");
  assert.throws(() => searchUrl(searchSchema.parse({ query: "x", minPrice: 10, maxPrice: 1 })), /minPrice/);
  for (const invalid of [{ query: " " }, { query: "x", minPrice: -1 }, { query: "x", minRating: 6 }, { query: "x", limit: 21 }, { query: "x", page: 0 }]) {
    assert.equal(searchSchema.safeParse(invalid).success, false);
  }
  assert.equal(productSchema.parse({ asin: "b012345678" }).asin, "B012345678");
  assert.equal(productSchema.safeParse({ asin: "https://example.com" }).success, false);
});

test("extracts current price rather than list price, features, specs and selected variant", () => {
  const product = parseProduct(productHtml, "B012345678");
  assert.equal(product.price, 2499.5);
  assert.equal(product.currency, "INR");
  assert.equal(product.rating, 4.3);
  assert.equal(product.reviewCount, 1234);
  assert.equal(product.availability, "In stock");
  assert.deepEqual(product.specs, { Brand: "Sony", Weight: "192 g", Connectivity: "Bluetooth", Model: "WH-TEST" });
  assert.deepEqual(product.features, ["30-hour battery"]);
  assert.deepEqual(product.selectedVariants, ["Black"]);
  const sparse = parseProduct('<span id="productTitle">Example</span>', "B012345678");
  assert.equal(sparse.price, null);
  assert.deepEqual(sparse.specs, {});
});

test("reports CAPTCHA, sign-in, changed layouts and unavailable products, not fake empty success", () => {
  for (const html of [
    "<title>Robot Check</title>", "<form action='/errors/validateCaptcha'></form>",
    "<body>Sorry, automated access to this page is blocked</body>",
  ]) assert.throws(() => assertPage(html), /AMAZON_BLOCKED/);
  assert.throws(() => assertPage('<title>Amazon Sign In</title><input id="ap_email">'), /SIGN_IN_REQUIRED/);
  assert.throws(() => parseSearch("<html>Unknown layout</html>"), /LAYOUT_CHANGED/);
  assert.throws(() => parseProduct("<html>Unknown layout</html>", "B012345678"), /PRODUCT_UNAVAILABLE/);
  assert.deepEqual(parseSearch("<body>No results for this query</body>"), []);
});

test("rejects arbitrary URLs before launching a browser", async () => {
  const browser = new AmazonBrowser();
  for (const url of ["http://127.0.0.1/", "https://www.amazon.in.evil.test/s", "https://www.amazon.in/gp/cart", "https://www.amazon.in/dp/invalid"]) {
    await assert.rejects(browser.fetch(url), /Only Amazon India/);
  }
  await browser.close();
});

test("MCP handshake, tool discovery, both tool calls, validation and upstream error propagation", async () => {
  const requests: string[] = [];
  const server = createServer({
    async fetch(url) {
      requests.push(url);
      if (url.includes("B099999999")) throw new Error("AMAZON_BLOCKED: fixture CAPTCHA");
      return url.includes("/dp/") ? productHtml : searchHtml;
    },
  });
  const client = new Client({ name: "shopping-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((t) => t.name).sort(), ["get_product", "search_products"]);
    assert.ok(tools.tools.every((t) => t.annotations?.readOnlyHint));
    const search = await client.callTool({ name: "search_products", arguments: { query: "Sony", minRating: 4, maxPrice: 3000 } });
    assert.notEqual(search.isError, true);
    const data = search.structuredContent;
    assert.ok(data);
    assert.equal(data.marketplace, "amazon.in");
    assert.ok(Array.isArray(data.products));
    assert.equal(data.products.length, 1);
    assert.equal(data.scannedCount, 3);
    assert.match(String(data.fetchedAt), /^\d{4}-\d\d-\d\dT/);
    const product = await client.callTool({ name: "get_product", arguments: { asin: "b012345678" } });
    assert.notEqual(product.isError, true);
    assert.equal(requests[1], "https://www.amazon.in/dp/B012345678");
    const invalid = await client.callTool({ name: "search_products", arguments: { query: "x", minPrice: 100, maxPrice: 1 } });
    assert.equal(invalid.isError, true);
    assert.equal(requests.length, 2);
    const blocked = await client.callTool({ name: "get_product", arguments: { asin: "B099999999" } });
    assert.equal(blocked.isError, true);
    const badAsin = await client.callTool({ name: "get_product", arguments: { asin: "../etc/passwd" } });
    assert.equal(badAsin.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("built server starts and discovers tools over real stdio without launching Chromium", async () => {
  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../dist/index.js", import.meta.url).pathname],
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 2);
  } finally {
    await client.close();
  }
});
