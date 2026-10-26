import { load } from "cheerio";
import type { SearchInput } from "./input.js";

export function clean(value: string): string {
  return value.replace(/[\u200e\u200f\u202a-\u202e]/g, "").replace(/\s+/g, " ").trim();
}

export function numeric(value: string): number | null {
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function reviewCount(value: string): number | null {
  const count = numeric(value);
  if (count === null) return null;
  const multiplier = /\d\s*k\b/i.test(value) ? 1000 : /\d\s*m\b/i.test(value) ? 1000000 : 1;
  return Math.round(count * multiplier);
}

export interface ProductSummary {
  asin: string;
  title: string;
  url: string;
  price: number | null;
  currency: "INR";
  rating: number | null;
  reviewCount: number | null;
  prime: boolean;
  sponsored: boolean;
  image: string | null;
}

export function assertPage(html: string): void {
  const $ = load(html);
  const title = clean($("title").text());
  const text = clean($("body").text());
  if ($("#captchacharacters, form[action*='validateCaptcha'], #challenge-container").length ||
      /robot check|automated access|verify (?:that )?you(?:'re| are) (?:a )?human|enter the characters you see below/i.test(`${title} ${text}`)) {
    throw new Error("AMAZON_BLOCKED: Amazon returned a CAPTCHA or automation block. No bypass was attempted. Try later or use Amazon manually.");
  }
  if (/sign in/i.test(title) && $("#ap_email, #ap_email_login").length) {
    throw new Error("AMAZON_SIGN_IN_REQUIRED: This public page requires sign-in; this server does not use account credentials.");
  }
}

export function parseSearch(html: string): ProductSummary[] {
  assertPage(html);
  const $ = load(html);
  const products: ProductSummary[] = [];
  const seen = new Set<string>();
  $("[data-component-type='s-search-result'][data-asin]").each((_, element) => {
    const card = $(element);
    const asin = card.attr("data-asin") ?? "";
    const title = clean(card.find("h2").toArray().map((heading) => $(heading).text()).join(" "));
    if (!/^[A-Z0-9]{10}$/.test(asin) || !title || seen.has(asin)) return;
    seen.add(asin);
    products.push({
      asin, title, url: `https://www.amazon.in/dp/${asin}`,
      price: numeric(card.find(".a-price:not(.a-text-price) .a-offscreen").first().text()),
      currency: "INR",
      rating: numeric(card.find("[aria-label*='out of 5 stars']").first().attr("aria-label") ??
        card.find(".a-icon-star-small .a-icon-alt, .a-icon-star .a-icon-alt, .a-icon-star-mini .a-icon-alt").first().text()),
      reviewCount: reviewCount(card.find("a[href*='customerReviews']").first().attr("aria-label") ??
        card.find("a[href*='customerReviews']").first().text()),
      prime: card.find(".a-icon-prime, [aria-label='Amazon Prime'], img[alt='Prime']").length > 0,
      sponsored: card.find("[data-component-type='s-sponsored-label-marker'], .puis-sponsored-label-text, .s-sponsored-label-text").length > 0 ||
        card.find("a[aria-label='Sponsored']").length > 0,
      image: card.find("img.s-image").attr("src") ?? null,
    });
  });
  if (!products.length && !/no results for|did not match any products|no results found/i.test(clean($("body").text()))) {
    throw new Error("AMAZON_LAYOUT_CHANGED: No recognizable product cards or explicit no-results message. Amazon may have blocked access or changed its layout.");
  }
  return products;
}

export function filterProducts(products: ProductSummary[], input: SearchInput): ProductSummary[] {
  const filtered = products.filter((product) =>
    (input.includeSponsored || !product.sponsored) &&
    (!input.primeOnly || product.prime) &&
    (!input.brand || product.title.toLocaleLowerCase("en-IN").includes(input.brand.toLocaleLowerCase("en-IN"))) &&
    (input.minPrice === undefined || (product.price !== null && product.price >= input.minPrice)) &&
    (input.maxPrice === undefined || (product.price !== null && product.price <= input.maxPrice)) &&
    (input.minRating === undefined || (product.rating !== null && product.rating >= input.minRating))
  );
  if (input.sort !== "relevance") {
    filtered.sort((a, b) => {
      const left = input.sort === "rating" ? a.rating : a.price;
      const right = input.sort === "rating" ? b.rating : b.price;
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      return input.sort === "price_asc" ? left - right : right - left;
    });
  }
  return filtered.slice(0, input.limit);
}

export function parseProduct(html: string, asin: string) {
  assertPage(html);
  const $ = load(html);
  const title = clean($("#productTitle").text());
  if (!title) throw new Error("AMAZON_PRODUCT_UNAVAILABLE: Product title not found. The ASIN may be unavailable or the page layout has changed.");
  const specs: Record<string, string> = {};
  $("#productDetails_techSpec_section_1 tr, #productDetails_techSpec_section_2 tr, #productDetails_detailBullets_sections1 tr, #productOverview_feature_div tr").each((_, row) => {
    const key = clean($(row).find("th, td.a-span3, td:first-child").first().text()).replace(/\s*:\s*$/, "");
    const value = clean($(row).find("td").last().text());
    if (key && value && key !== value) specs[key] = value;
  });
  $("#detailBullets_feature_div li .a-list-item").each((_, element) => {
    const label = $(element).find(".a-text-bold").first();
    const key = clean(label.text()).replace(/\s*:\s*$/, "");
    const valueElement = $(element).clone();
    valueElement.find(".a-text-bold").remove();
    const value = clean(valueElement.text());
    if (key && value) specs[key] = value;
  });
  const features = $("#feature-bullets li .a-list-item").toArray()
    .map((element) => clean($(element).text())).filter(Boolean);
  const priceText = $("#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen, #corePrice_feature_div .priceToPay .a-offscreen, #corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen, #corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen, #priceblock_ourprice, #priceblock_dealprice").first().text();
  return {
    asin, title, url: `https://www.amazon.in/dp/${asin}`,
    price: numeric(priceText), currency: "INR" as const,
    priceText: clean(priceText) || null,
    rating: numeric($("#acrPopover .a-icon-alt").first().text()),
    reviewCount: reviewCount($("#acrCustomerReviewText").first().text()),
    availability: clean($("#availability").text()) || null,
    brand: clean($("#bylineInfo").text()) || null,
    image: $("#landingImage, #imgBlkFront").first().attr("src") ?? null,
    features, specs,
    selectedVariants: $("#twister .selection, #twister .a-dropdown-prompt").toArray()
      .map((element) => clean($(element).text())).filter(Boolean),
  };
}
