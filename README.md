# Amazon shopping MCP for Hermes

A free, local, read-only TypeScript MCP server for **Amazon India**. Uses Playwright to read public pages, not a paid API. No Amazon credentials required. This is unofficial and not affiliated with Amazon.

## Requirements and setup

Node.js 22+ and npm. Run inside this project:

```sh
npm install
npm run browser:install
npm run build
```

On Linux, Chromium may also need system libraries (`npx playwright install --with-deps chromium`; review the requested OS package changes first).

## Start the MCP server

```sh
./start.sh
```

The launcher works from any working directory, builds the TypeScript source, then starts the stdio MCP server. Build output goes to stderr so it cannot interfere with MCP messages. Install dependencies and Chromium using the setup commands above before the first launch.

The server waits for an MCP client on stdin; it does not open a web page or HTTP port. Use Ctrl+C to stop a manual launch. Normally Hermes launches it automatically using the configuration below.

## Connect Hermes

Merge this entry into your Hermes `~/.hermes/config.yaml` (do not replace other settings). Replace the example path with the **absolute path** to this project:

```yaml
mcp_servers:
  amazon_shopping:
    command: /absolute/path/to/amazon-aws/start.sh
    enabled: true
    timeout: 120
    supports_parallel_tool_calls: false
```

Ensure Node.js and npm are on the PATH available to Hermes. Restart Hermes to discover the tools. No server port is required: Hermes starts the process and uses MCP over stdio. Keep stdout reserved for MCP; diagnostics go to stderr. Alternatively, after building, configure `command: node` and `args: ["/absolute/path/to/amazon-aws/dist/index.js"]` to launch without rebuilding.

Example prompts:

- "Search Amazon India for Sony headphones between ₹2,000 and ₹10,000, rated at least 4 stars, sorted cheapest first."
- "Find Prime laptops under ₹60,000, then get full specs for the best three."
- "Get the current price, availability and specifications for ASIN B0XXXXXXXX."

## Tools

### `search_products`

Required: `query`. Optional:

- `minPrice`, `maxPrice`: inclusive INR bounds, nonnegative.
- `minRating`: inclusive 0–5 threshold.
- `brand`: case-insensitive keyword in the title, **not verified manufacturer identity**.
- `primeOnly`: default false; requires a visible Prime marker.
- `includeSponsored`: default false. Sponsored-label detection is best-effort.
- `sort`: `relevance` (default), `price_asc`, `price_desc`, `rating`.
- `page`: Amazon result-page number, 1–20; default 1.
- `limit`: maximum returned products, 1–20; default 10.

Returns `marketplace`, `fetchedAt` (UTC ISO timestamp), `sourceUrl`, `page`, applied `filters`, `scannedCount`, `products`, and `warnings`. Each product has ASIN, title, canonical URL, numeric price or null, INR currency, rating/review count or null, Prime/sponsored flags, and image URL or null. Review counts use exact accessible labels when available; abbreviated counts such as `32.1K` otherwise expand to an approximate `32100`.

Amazon is asked to apply price/Prime refinements and sorting. Local filtering and sorting also run on **one fetched page only**. Results are not a catalog-wide sorted list; no total count or guaranteed page size is claimed. Unknown prices/ratings are excluded when the corresponding filter is present. Fetch additional pages explicitly; an empty filtered page does not mean later pages have no matches.

### `get_product`

Required: `asin` (10 alphanumeric characters; lowercase accepted).

Returns `marketplace`, `fetchedAt`, `product`, and `warnings`. Product fields include the displayed offer's price/price text, title, URL, rating, review count, availability, raw brand/byline text, image, feature bullets, specification key/value pairs, and selected variants. Missing information stays null or empty. Only the displayed variant is described; no variant selection or checkout is performed.

## Important limits

- **No API fee is not a reliability guarantee.** Amazon can block automated browsing, show CAPTCHA, require login, or change markup. The server returns explicit MCP errors (`isError: true`) rather than fabricated results. It does not bypass blocks, rotate proxies, solve CAPTCHA, or use stealth plugins.
- Review Amazon's current terms and applicable rules before use. Use only where permitted. Navigation is serialized with at least 2 seconds between starts, no background crawl and no automatic retries. This does not guarantee permission or prevent blocking.
- Prices, Prime delivery, availability, and listings can depend on location. This server uses a fresh anonymous browser context (no saved login or delivery postcode). It does not calculate shipping, coupons, bank offers, taxes or checkout totals; always verify on Amazon.
- Page text is untrusted external content. The tools flag it as data, not instructions; your agent must not follow instructions embedded in product descriptions.
- No account access, cart, orders or purchasing tools. Only Amazon India search/product navigation is accepted. Chromium may contact third-party page assets normally used by Amazon.
- To see the browser for troubleshooting, add `env: { AMAZON_HEADLESS: "false" }` to the Hermes entry. This is **not** a CAPTCHA bypass or persistent login mode.

## Development and verification

```sh
npm run check
npm test
npm run build
```

Tests use deterministic HTML fixtures and MCP in-memory/stdio connections; they do not need network access or Amazon credentials. Live Amazon access can fail independently of these tests.

Hermes configuration reference: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/mcp-config-reference.md
