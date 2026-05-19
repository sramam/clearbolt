import { z } from "zod";

/** Structured fields the enrich-phase LLM may suggest (gaps only; merged conservatively). */
export const ListingLlmEnrichPatchSchema = z.object({
  category: z.string().min(1).max(200).optional(),
  categories: z.array(z.string().min(1).max(120)).min(1).max(12).optional(),
  finalCategory: z.string().min(1).max(120).optional(),
  industry: z.string().min(1).max(200).optional(),
  numberOfEmployees: z.string().min(1).max(120).optional(),
  inventoryIncludedInAskingPrice: z.boolean().optional(),
  ffeIncludedInAskingPrice: z.boolean().optional(),
  sellerType: z.string().min(1).max(120).optional(),
  reasonForSelling: z.string().min(1).max(500).optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

export type ListingLlmEnrichPatch = z.infer<typeof ListingLlmEnrichPatchSchema>;
