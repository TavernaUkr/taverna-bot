declare const process: { env: Record<string, string | undefined> };
import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sb(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "search_products",
  title: "Search products",
  description:
    "Search the Taverna marketplace catalog by keyword. Returns id, name, price, brand and stock status.",
  inputSchema: {
    query: z.string().trim().min(1).describe("Search text (product name, brand, keyword)."),
    limit: z.number().int().min(1).max(50).default(10).describe("Maximum results to return."),
    in_stock_only: z.boolean().default(true).describe("Only return products currently in stock."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit, in_stock_only }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    let q = sb(ctx)
      .from("products")
      .select("id, name, price, brand, in_stock, sizes, colors")
      .or(`name.ilike.%${query}%,brand.ilike.%${query}%`)
      .limit(limit);
    if (in_stock_only) q = q.eq("in_stock", true);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { products: data ?? [] },
    };
  },
});
