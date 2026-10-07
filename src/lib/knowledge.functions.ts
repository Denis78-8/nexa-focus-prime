import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { KB_CATEGORIES } from "@/lib/knowledge-base";

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

// Same block model as the built-in articles; the database validates it again.
const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("p"), text: z.string().trim().min(1).max(5000) }),
  z.object({ type: z.literal("note"), text: z.string().trim().min(1).max(5000) }),
  z.object({ type: z.literal("warning"), text: z.string().trim().min(1).max(5000) }),
  z.object({ type: z.literal("code"), code: z.string().min(1).max(10000) }),
  z.object({ type: z.literal("list"), items: z.array(z.string().trim().min(1).max(1000)).min(1).max(50) }),
]);
const articleSchema = z.object({
  title: z.string().trim().min(3).max(200),
  category: z.enum(KB_CATEGORIES),
  summary: z.string().trim().max(600),
  sections: z.array(z.object({ heading: z.string().trim().min(1).max(200), blocks: z.array(blockSchema).max(60) })).max(40),
  importantNotes: z.array(z.string().trim().min(1).max(1000)).max(20),
  relatedArticles: z.array(z.string().trim().min(1).max(100)).max(20),
});
export type KnowledgeArticleInput = z.input<typeof articleSchema>;

const COLUMNS = "id,title,category,summary,sections,important_notes,related_articles,created_at,created_by,updated_at,updated_by";

/** Cloud articles (RLS: active users) plus whether the caller may write. */
export const getKnowledgeArticles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [articles, canWrite] = await Promise.all([
      sb.from("knowledge_base_articles").select(COLUMNS).order("updated_at", { ascending: false }),
      sb.rpc("has_permission", { _permission: "knowledge.write" }),
    ]);
    fail(articles.error);
    fail(canWrite.error);
    const rows = articles.data ?? [];
    // Author / editor names come from profiles (never stored as text on the article).
    const ids = [...new Set(rows.flatMap((row) => [row.created_by, row.updated_by]).filter((id): id is string => Boolean(id)))];
    const people = ids.length
      ? await sb.from("profiles").select("id, full_name, is_vip").in("id", ids)
      : { data: [] as { id: string; full_name: string; is_vip: boolean }[], error: null };
    fail(people.error);
    return { articles: rows, people: people.data ?? [], canWrite: canWrite.data === true };
  });

const toRow = (data: z.output<typeof articleSchema>) => ({
  title: data.title,
  category: data.category,
  summary: data.summary,
  sections: data.sections,
  important_notes: data.importantNotes,
  related_articles: data.relatedArticles,
});

/** Authorship (created_by / updated_by) and timestamps are set by the database trigger. */
export const createKnowledgeArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: KnowledgeArticleInput) => articleSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("knowledge_base_articles").insert(toRow(data)).select("id").single();
    fail(error);
    return { id: row!.id };
  });

export const updateKnowledgeArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: KnowledgeArticleInput & { id: string }) => articleSchema.extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("knowledge_base_articles").update(toRow(data)).eq("id", data.id).select("id");
    fail(error);
    if (!rows?.length) throw new Error("Статья не найдена или нет прав на редактирование");
    return { id: data.id };
  });
