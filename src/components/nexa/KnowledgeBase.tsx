import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, BookOpen, Clock, Info, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { KB_ARTICLES, KB_CATEGORIES, KB_SEARCH_INDEX, readingTime, type KbArticle, type KbBlock, type KbCategory } from "@/lib/knowledge-base";

type CategoryFilter = "all" | KbCategory;

const ARTICLES_BY_ID = new Map(KB_ARTICLES.map((article) => [article.id, article]));

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

function ArticleView({ article, onOpen, onBack }: { article: KbArticle; onOpen: (id: string) => void; onBack: () => void }) {
  const related = article.relatedArticles.map((id) => ARTICLES_BY_ID.get(id)).filter((item): item is KbArticle => Boolean(item));
  return (
    <article key={article.id} className="animate-fade-in rounded-lg border border-border bg-card px-6 py-6 sm:px-8 sm:py-7">
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden">
        <ArrowLeft className="h-4 w-4" />
        Все статьи
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="rounded-full border border-border px-2 py-0.5">{article.category}</span>
        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{minutesLabel(readingTime(article))}</span>
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
      </div>
    </article>
  );
}

/** Internal knowledge base: static, read-only articles with client-side search. */
export function KnowledgeBase() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedId, setSelectedId] = useState<string>(KB_ARTICLES[0]!.id);
  // On narrow screens the list and the article are shown one at a time.
  const [mobileView, setMobileView] = useState<"list" | "article">("list");

  const normalized = query.trim().toLocaleLowerCase("ru-RU");
  const visible = useMemo(
    () => KB_ARTICLES.filter((article) =>
      (category === "all" || article.category === category)
      && (!normalized || (KB_SEARCH_INDEX.get(article.id) ?? "").includes(normalized))),
    [category, normalized],
  );
  const selected = ARTICLES_BY_ID.get(selectedId) ?? KB_ARTICLES[0]!;

  const open = (id: string) => {
    setSelectedId(id);
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
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти статью..." aria-label="Найти статью" className="h-9 pl-9" />
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

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[22rem_minmax(0,1fr)]">
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
                const active = article.id === selected.id;
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
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{article.category}</span>
                      <span aria-hidden>·</span>
                      <span>{minutesLabel(readingTime(article))}</span>
                    </div>
                  </button>
                );
              })}
            </nav>
          )}
        </aside>

        <div className={`min-w-0 ${mobileView === "list" ? "hidden lg:block" : ""}`}>
          <ArticleView key={selected.id} article={selected} onOpen={open} onBack={() => setMobileView("list")} />
        </div>
      </div>
    </div>
  );
}
