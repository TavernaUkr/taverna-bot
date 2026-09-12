import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchProducts from "./tools/search-products";
import getProduct from "./tools/get-product";
import listMyOrders from "./tools/my-orders";

// Direct Supabase issuer (never the .lovable.cloud proxy). Built from the
// project ref that Vite inlines at build time — keeps this module import-safe.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "taverna-mcp",
  title: "Taverna Marketplace MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Taverna Group marketplace (tactical & military gear, Ukraine). Use `search_products` and `get_product` to browse the catalog, and `list_my_orders` for the signed-in user's order history.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchProducts, getProduct, listMyOrders],
});
