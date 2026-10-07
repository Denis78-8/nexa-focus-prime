import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, BookOpen, Clock, Info, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmployeeName } from "@/components/nexa/profile-display";
import { KB_ARTICLES, KB_CATEGORIES, articleText, readingTime, type KbArticle, type KbBlock, type KbCategory, type KbSection } from "@/lib/knowledge-base";
import { createKnowledgeArticle, getKnowledgeArticles, updateKnowledgeArticle, type KnowledgeArticleInput } from "@/lib/knowledge.functions";

type CategoryFilter = "all" | KbCategory;

const KB_QUERY_KEY = ["nexa", "knowledge"] as const;

type Person = { id: string; full_name: string; is_vip: boolean };
type CloudMeta = { createdAt: string; createdBy: string; updatedAt: string; updatedBy: string | null };
/** One list entry: built-in (code, read-only) or Cloud (Supabase, editable). */
type Entry = KbArticle & { source: "builtin" | "cloud"; meta?: CloudMeta };

const BUILTIN: Entry[] = KB_ARTICLES.map((article) => ({ ...article, source: "builtin" }));

function minutesLabel(minutes: number) {
  return `${minutes} мин чтения`;
}

function Block({ block }: { block: KbBlock }) {
  if (block.type === "p") return <p className="text-sm leading-relaxed text-foreground/90">{block.text}</p>;
  if (block.type === "list") {
    return (
      <ul className="space-y-1.5 text-sm leading-relaxed text-foreground/90">
        {block.items.map((item) => (
          <li key={item} className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />{item}</li>
        ))}
      </ul>
    );
  }
  if (block.type === "code") {
    return <pre className="overflow-x-auto rounded-md border border-border bg-background/70 px-4 py-3 font-mono text-xs leading-relaxed text-foreground/85">{block.code}</pre>;
  }
  const warning = block.type === "warning";
  const Icon = warning ? AlertTriangle : Info;
  return (
    <div className={`flex gap-3 rounded-md border px-4 py-3 text-sm leading-relaxed ${warning ? "border-amber-400/25 bg-amber-400/[0.06]" : "border-border bg-secondary/40"}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${warning ? "text-amber-300" : "text-muted-foreground"}`} />
      <p className="text-foreground/90">{block.text}</p>
    </div>
  );
}

function ArticleView({ article, byId, people, canWrite, onEdit, onOpen, onBack }: { article: Entry; byId: Map<string, Entry>; people: Map<string, Person>; canWrite: boolean; onEdit: () => void; onOpen: (id: string) => void; onBack: () => void }) {
  const related = article.relatedArticles.map((id) => byId.get(id)).filter((item): item is Entry => Boolean(item));
  return (
    <article key={article.id} className="animate-fade-in rounded-lg border border-border bg-card px-6 py-6 sm:px-8 sm:py-7">
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden">
        <ArrowLeft className="h-4 w-4" />
        Все статьи
      </button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="rounded-full border border-border px-2 py-0.5">{article.category}</span>
          {article.source === "builtin" && <span className="rounded-full bg-secondary/70 px-2 py-0.5 text-foreground/65">Встроенная</span>}
          <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{minutesLabel(readingTime(article))}</span>
        </div>
        {article.source === "cloud" && canWrite && (
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Редактировать
          </Button>
        )}
      </div>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight">{article.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{article.summary}</p>

      <div className="mt-7 space-y-7">
        {article.sections.map((section) => (
          <section key={section.heading} className="space-y-3">
            <h3 className="text-sm font-semibold">{section.heading}</h3>
            {section.blocks.map((block, index) => <Block key={index} block={block} />)}
          </section>
        ))}

        {article.steps && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Порядок действий</h3>
            <ol className="space-y-2">
              {article.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-relaxed text-foreground/90">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[11px] text-muted-foreground">{index + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </section>
        )}

        {article.importantNotes.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Важно</h3>
            {article.importantNotes.map((note) => <Block key={note} block={{ type: "note", text: note }} />)}
          </section>
        )}

        {related.length > 0 && (
          <section className="border-t border-border pt-6">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Связанные статьи</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {related.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className="rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-secondary/40"
                >
                  <div className="text-sm">{item.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{item.category} · {minutesLabel(readingTime(item))}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {article.meta && <ArticleMeta meta={article.meta} people={people} />}
      </div>
    </article>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function PersonRef({ id, people }: { id: string; people: Map<string, Person> }) {
  const person = people.get(id);
  return <EmployeeName name={person?.full_name || "Сотрудник"} isVip={person?.is_vip} />;
}

/** Authorship footer of a Cloud article; names come from profiles. */
function ArticleMeta({ meta, people }: { meta: CloudMeta; people: Map<string, Person> }) {
  return (
    <footer className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
      <p>Создал: <PersonRef id={meta.createdBy} people={people} /> · {formatDateTime(meta.createdAt)}</p>
      <p>
        {meta.updatedBy
          ? <>Изменил: <PersonRef id={meta.updatedBy} people={people} /> · {formatDateTime(meta.updatedAt)}</>
          : "Изменений не было"}
      </p>
    </footer>
  );
}

// ---------- Editor ----------

type DraftBlock = { type: KbBlock["type"]; value: string };
type DraftSection = { heading: string; blocks: DraftBlock[] };
type Draft = { title: string; category: KbCategory; summary: string; sections: DraftSection[]; importantNotes: string; relatedArticles: string[] };

const BLOCK_LABEL: Record<KbBlock["type"], string> = { p: "Абзац", list: "Список", code: "Код", note: "Заметка", warning: "Предупреждение" };

function toDraft(article?: Entry): Draft {
  if (!article) return { title: "", category: "Backend", summary: "", sections: [{ heading: "", blocks: [{ type: "p", value: "" }] }], importantNotes: "", relatedArticles: [] };
  return {
    title: article.title,
    category: article.category,
    summary: article.summary,
    sections: article.sections.map((section) => ({
      heading: section.heading,
      blocks: section.blocks.map((block) => ({ type: block.type, value: "items" in block ? block.items.join("\n") : "code" in block ? block.code : block.text })),
    })),
    importantNotes: article.importantNotes.join("\n"),
    relatedArticles: article.relatedArticles,
  };
}

function fromDraft(draft: Draft): KnowledgeArticleInput {
  const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
  const sections: KbSection[] = draft.sections
    .map((section) => ({
      heading: section.heading.trim(),
      blocks: section.blocks
        .filter((block) => block.value.trim())
        .map((block): KbBlock => block.type === "list" ? { type: "list", items: lines(block.value) } : block.type === "code" ? { type: "code", code: block.value } : { type: block.type, text: block.value.trim() }),
    }))
    .filter((section) => section.heading || section.blocks.length);
  return { title: draft.title.trim(), category: draft.category, summary: draft.summary.trim(), sections, importantNotes: lines(draft.importantNotes), relatedArticles: draft.relatedArticles };
}

const fieldLabel = "mb-1.5 block text-xs font-medium text-muted-foreground";
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm";

function ArticleEditor({ article, all, onCancel, onSaved }: { article?: Entry | undefined; all: Entry[]; onCancel: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const create = useServerFn(createKnowledgeArticle);
  const update = useServerFn(updateKnowledgeArticle);
  const [draft, setDraft] = useState<Draft>(() => toDraft(article));
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const setSection = (index: number, next: DraftSection) => patch({ sections: draft.sections.map((section, i) => (i === index ? next : section)) });

  const save = useMutation({
    mutationFn: async () => {
      const input = fromDraft(draft);
      if (input.sections.some((section) => !section.heading)) throw new Error("У каждого раздела должен быть заголовок");
      return article ? update({ data: { ...input, id: article.id } }) : create({ data: input });
    },
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: KB_QUERY_KEY });
      toast.success(article ? "Статья сохранена" : "Статья создана");
      onSaved(result.id);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const candidates = all.filter((item) => item.id !== article?.id);
  const valid = draft.title.trim().length >= 3;

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); if (valid) save.mutate(); }}
      className="animate-fade-in space-y-6 rounded-lg border border-border bg-card px-5 py-6 sm:px-8 sm:py-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{article ? "Редактирование статьи" : "Новая статья"}</h2>
        <span className="text-xs text-muted-foreground">Сохраняется в Supabase</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <label className="min-w-0">
          <span className={fieldLabel}>Заголовок</span>
          <Input value={draft.title} onChange={(e) => patch({ title: e.target.value })} maxLength={200} required minLength={3} placeholder="Например, Порядок выпуска релиза" />
        </label>
        <label className="min-w-0">
          <span className={fieldLabel}>Категория</span>
          <select value={draft.category} onChange={(e) => patch({ category: e.target.value as KbCategory })} className={selectClass}>
            {KB_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel}>Краткое описание</span>
        <Textarea value={draft.summary} onChange={(e) => patch({ summary: e.target.value })} rows={2} maxLength={600} placeholder="Одно-два предложения: о чём статья" />
      </label>

      <div className="space-y-4">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Содержание</div>
        {draft.sections.map((section, sectionIndex) => (
          <div key={sectionIndex} className="space-y-3 rounded-lg border border-border bg-background/30 p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <Input value={section.heading} onChange={(e) => setSection(sectionIndex, { ...section, heading: e.target.value })} maxLength={200} placeholder="Заголовок раздела" className="min-w-0 flex-1" />
              <Button type="button" variant="ghost" size="icon" aria-label="Удалить раздел" className="h-9 w-9 shrink-0 text-muted-foreground" onClick={() => patch({ sections: draft.sections.filter((_, i) => i !== sectionIndex) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {section.blocks.map((block, blockIndex) => {
              const setBlock = (next: DraftBlock) => setSection(sectionIndex, { ...section, blocks: section.blocks.map((b, i) => (i === blockIndex ? next : b)) });
              return (
                <div key={blockIndex} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <select aria-label="Тип блока" value={block.type} onChange={(e) => setBlock({ ...block, type: e.target.value as KbBlock["type"] })} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                      {(Object.keys(BLOCK_LABEL) as KbBlock["type"][]).map((type) => <option key={type} value={type}>{BLOCK_LABEL[type]}</option>)}
                    </select>
                    {block.type === "list" && <span className="text-[11px] text-muted-foreground">по пункту на строку</span>}
                    <Button type="button" variant="ghost" size="sm" className="ml-auto h-8 text-xs text-muted-foreground" onClick={() => setSection(sectionIndex, { ...section, blocks: section.blocks.filter((_, i) => i !== blockIndex) })}>Убрать</Button>
                  </div>
                  <Textarea
                    value={block.value}
                    onChange={(e) => setBlock({ ...block, value: e.target.value })}
                    rows={block.type === "code" ? 6 : 3}
                    className={block.type === "code" ? "font-mono text-xs" : ""}
                    placeholder={BLOCK_LABEL[block.type]}
                  />
                </div>
              );
            })}
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => setSection(sectionIndex, { ...section, blocks: [...section.blocks, { type: "p", value: "" }] })}>
              <Plus className="h-3.5 w-3.5" />
              Блок
            </Button>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" onClick={() => patch({ sections: [...draft.sections, { heading: "", blocks: [{ type: "p", value: "" }] }] })}>
          <Plus className="h-4 w-4" />
          Раздел
        </Button>
      </div>

      <label className="block">
        <span className={fieldLabel}>Важно — по заметке на строку</span>
        <Textarea value={draft.importantNotes} onChange={(e) => patch({ importantNotes: e.target.value })} rows={2} />
      </label>

      <div>
        <span className={fieldLabel}>Связанные статьи</span>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {candidates.map((item) => {
            const checked = draft.relatedArticles.includes(item.id);
            return (
              <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-secondary/40">
                <input type="checkbox" checked={checked} onChange={() => patch({ relatedArticles: checked ? draft.relatedArticles.filter((id) => id !== item.id) : [...draft.relatedArticles, item.id].slice(0, 20) })} />
                <span className="min-w-0 truncate">{item.title}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{item.category}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={save.isPending}>Отмена</Button>
        <Button type="submit" disabled={!valid || save.isPending}>{save.isPending ? "Сохраняем…" : "Сохранить"}</Button>
      </div>
    </form>
  );
}

/** Knowledge base: built-in articles (code, read-only) plus Cloud articles (Supabase, editable). */
export function KnowledgeBase() {
  const loadCloud = useServerFn(getKnowledgeArticles);
  const cloud = useQuery({ queryKey: KB_QUERY_KEY, queryFn: () => loadCloud() });
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedId, setSelectedId] = useState<string>(KB_ARTICLES[0]!.id);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  // On narrow screens the list and the article are shown one at a time.
  const [mobileView, setMobileView] = useState<"list" | "article">("list");

  const cloudEntries = useMemo<Entry[]>(() => (cloud.data?.articles ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    category: (KB_CATEGORIES as readonly string[]).includes(row.category) ? (row.category as KbCategory) : "Backend",
    summary: row.summary,
    sections: Array.isArray(row.sections) ? (row.sections as unknown as KbSection[]) : [],
    importantNotes: row.important_notes ?? [],
    relatedArticles: row.related_articles ?? [],
    source: "cloud",
    meta: { createdAt: row.created_at, createdBy: row.created_by, updatedAt: row.updated_at, updatedBy: row.updated_by },
  })), [cloud.data]);
  const all = useMemo(() => [...cloudEntries, ...BUILTIN], [cloudEntries]);
  const byId = useMemo(() => new Map(all.map((article) => [article.id, article])), [all]);
  const searchIndex = useMemo(() => new Map(all.map((article) => [article.id, `${article.category} ${articleText(article)}`.toLocaleLowerCase("ru-RU")])), [all]);
  const people = useMemo(() => new Map((cloud.data?.people ?? []).map((person) => [person.id, person])), [cloud.data]);
  const canWrite = cloud.data?.canWrite === true;

  const normalized = query.trim().toLocaleLowerCase("ru-RU");
  const visible = all.filter((article) =>
    (category === "all" || article.category === category)
    && (!normalized || (searchIndex.get(article.id) ?? "").includes(normalized)));
  const selected = byId.get(selectedId) ?? BUILTIN[0]!;

  const open = (id: string) => {
    setEditing(null);
    setSelectedId(id);
    setMobileView("article");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const startEditing = (target: "new" | string) => {
    setEditing(target);
    setMobileView("article");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">База знаний</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Внутренняя база знаний команды LUNO DIGITAL</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти статью..." aria-label="Найти статью" className="h-9 pl-9" />
          </div>
          {canWrite && (
            <Button size="sm" className="h-9 shrink-0" onClick={() => startEditing("new")}>
              <Plus className="h-4 w-4" />
              Новая статья
            </Button>
          )}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Категории">
          {(["all", ...KB_CATEGORIES] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
              className={`h-8 rounded-md px-3 text-sm transition-colors ${category === item ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"}`}
            >
              {item === "all" ? "Все" : item}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">Статей: {visible.length}</span>
      </div>
      {cloud.error && <p role="alert" className="mb-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">Статьи из Cloud не загрузились: {(cloud.error as Error).message}. Встроенные статьи доступны.</p>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className={`h-fit rounded-lg border border-border bg-card p-1.5 lg:sticky lg:top-24 ${mobileView === "article" ? "hidden lg:block" : ""}`}>
          {visible.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <BookOpen className="h-5 w-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">Ничего не найдено</p>
              <p className="mt-1 text-sm text-muted-foreground">Попробуйте другой запрос или выберите категорию «Все».</p>
            </div>
          ) : (
            <nav aria-label="Статьи" className="space-y-0.5">
              {visible.map((article) => {
                const active = !editing && article.id === selected.id;
                return (
                  <button
                    key={article.id}
                    type="button"
                    onClick={() => open(article.id)}
                    aria-current={active ? "true" : undefined}
                    className={`relative w-full rounded-md px-3 py-2.5 text-left transition-colors duration-200 ${active ? "bg-secondary/80" : "hover:bg-secondary/40"}`}
                  >
                    {active && <span aria-hidden className="absolute inset-y-2.5 left-0 w-0.5 rounded-full bg-primary" />}
                    <div className="text-sm font-medium leading-snug">{article.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{article.category}</span>
                      <span aria-hidden>·</span>
                      <span>{minutesLabel(readingTime(article))}</span>
                      {article.source === "builtin" && <span className="rounded-full bg-secondary/70 px-1.5 py-px text-[10px] text-foreground/60">Встроенная</span>}
                    </div>
                  </button>
                );
              })}
            </nav>
          )}
        </aside>

        <div className={`min-w-0 ${mobileView === "list" ? "hidden lg:block" : ""}`}>
          {editing ? (
            <>
              <button type="button" onClick={() => { setEditing(null); setMobileView("list"); }} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden">
                <ArrowLeft className="h-4 w-4" />
                Все статьи
              </button>
              <ArticleEditor
                key={editing}
                article={editing === "new" ? undefined : byId.get(editing)}
                all={all}
                onCancel={() => { setEditing(null); if (editing === "new") setMobileView("list"); }}
                onSaved={(id) => open(id)}
              />
            </>
          ) : (
            <ArticleView key={selected.id} article={selected} byId={byId} people={people} canWrite={canWrite} onEdit={() => startEditing(selected.id)} onOpen={open} onBack={() => setMobileView("list")} />
          )}
        </div>
      </div>
    </div>
  );
}
