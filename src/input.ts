import { z } from "zod";

export const searchSchema = z.object({
  query: z.string().trim().min(1).max(200).describe("Product keywords"),
  minPrice: z.number().finite().nonnegative().optional().describe("Minimum price in INR"),
  maxPrice: z.number().finite().nonnegative().optional().describe("Maximum price in INR"),
  minRating: z.number().min(0).max(5).optional(),
  brand: z.string().trim().min(1).max(80).optional()
    .describe("Brand keyword; matches product titles, not verified manufacturer identity"),
  primeOnly: z.boolean().default(false),
  includeSponsored: z.boolean().default(false),
  sort: z.enum(["relevance", "price_asc", "price_desc", "rating"]).default("relevance"),
  page: z.number().int().min(1).max(20).default(1),
  limit: z.number().int().min(1).max(20).default(10),
});

export const productSchema = z.object({
  asin: z.string().trim().regex(/^[A-Za-z0-9]{10}$/, "Use a 10-character Amazon ASIN")
    .transform((value) => value.toUpperCase()),
});

export type SearchInput = z.infer<typeof searchSchema>;

export function validatePriceRange(input: SearchInput): void {
  if (input.minPrice !== undefined && input.maxPrice !== undefined && input.minPrice > input.maxPrice) {
    throw new Error("minPrice must be less than or equal to maxPrice.");
  }
}

export function searchUrl(input: SearchInput): string {
  validatePriceRange(input);
  const url = new URL("https://www.amazon.in/s");
  url.searchParams.set("k", input.query);
  url.searchParams.set("page", String(input.page));
  const refinements: string[] = [];
  if (input.primeOnly) refinements.push("p_85:10440599031");
  if (refinements.length) url.searchParams.set("rh", refinements.join(","));
  if (input.minPrice !== undefined || input.maxPrice !== undefined) {
    url.searchParams.set("low-price", String(input.minPrice ?? ""));
    url.searchParams.set("high-price", String(input.maxPrice ?? ""));
  }
  const sorts = {
    relevance: "relevanceblender",
    price_asc: "price-asc-rank",
    price_desc: "price-desc-rank",
    rating: "review-rank",
  };
  url.searchParams.set("s", sorts[input.sort]);
  return url.href;
}
