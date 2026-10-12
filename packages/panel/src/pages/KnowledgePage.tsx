/** База знаний продукта: статьи и FAQ. */
import { useCallback, useEffect, useState } from "react";
import type { KnowledgeArticleDto } from "@sova/shared";
import type { AppContext } from "../App";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";

const EMPTY_DRAFT = {
  id: "",
  title: "",
  body: "",
  kind: "article" as "article" | "faq",
  tags: "",
  isPublished: true,
};

export function KnowledgePage({ ctx }: { ctx: AppContext }) {
  const [productId, setProductId] = useState("");
  const [articles, setArticles] = useState<KnowledgeArticleDto[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<typeof EMPTY_DRAFT | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!productId && ctx.products.length > 0) setProductId(ctx.products[0]?.id ?? "");
  }, [ctx.products, productId]);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    try {
      const res = await api.articles(productId, search.trim() || undefined);
      setArticles(res.articles);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Не удалось загрузить статьи");
    } finally {
      setLoading(false);
    }
  }, [productId, search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  async function save() {
    if (!draft || !productId) return;
    try {
      const payload = {
        title: draft.title.trim(),
        body: draft.body,
        kind: draft.kind,
        tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
        isPublished: draft.isPublished,
      };
      if (draft.id) {
        await api.updateArticle(draft.id, payload);
      } else {
        await api.createArticle({ ...payload, productId });
      }
      setDraft(null);
      await load();
      setMessage("Сохранено");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Не удалось сохранить статью");
    }
  }

  async function remove(id: string) {
    await api.deleteArticle(id).catch(() => undefined);
    await load();
  }

  return (
    <div className="page">
      <div className="page-scroll">
        <div className="page-header">
          <h1 className="page-title">База знаний</h1>
          <div className="row">
            <select
              className="select"
              style={{ width: 240 }}
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              {ctx.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setDraft({ ...EMPTY_DRAFT })}
              disabled={!productId}
            >
              Новая статья
            </button>
          </div>
        </div>

        {message ? <div className="card" style={{ marginBottom: 14 }}>{message}</div> : null}

        <input
          className="input"
          style={{ maxWidth: 380, marginBottom: 14 }}
          type="search"
          placeholder="Поиск по статьям"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {draft ? (
          <div className="card" style={{ marginBottom: 18 }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>
              {draft.id ? "Редактирование статьи" : "Новая статья"}
            </h2>
            <div className="field">
              <label className="label">Заголовок</label>
              <input
                className="input"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="label">Текст</label>
              <textarea
                className="textarea"
                style={{ minHeight: 220 }}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
              <div className="hint">
                Пишите фактами: ИИ отвечает только тем, что есть здесь. Чем конкретнее, тем меньше
                передач оператору.
              </div>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <div className="field" style={{ width: 160 }}>
                <label className="label">Тип</label>
                <select
                  className="select"
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as "article" | "faq" })}
                >
                  <option value="article">Статья</option>
                  <option value="faq">FAQ</option>
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="label">Теги (через запятую)</label>
                <input
                  className="input"
                  value={draft.tags}
                  onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                />
              </div>
            </div>
            <label className="row" style={{ marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={draft.isPublished}
                onChange={(e) => setDraft({ ...draft, isPublished: e.target.checked })}
              />
              Доступна ИИ
            </label>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => void save()}>
                Сохранить
              </button>
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                Отмена
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="row">
            <div className="spinner" /> Загружаем…
          </div>
        ) : articles.length === 0 ? (
          <div className="card">
            Статей пока нет. Добавьте инструкции, ответы на частые вопросы и ограничения продукта —
            это то, чем будет пользоваться ИИ.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Заголовок</th>
                <th style={{ width: 90 }}>Тип</th>
                <th style={{ width: 170 }}>Обновлена</th>
                <th style={{ width: 170 }} />
              </tr>
            </thead>
            <tbody>
              {articles.map((article) => (
                <tr key={article.id}>
                  <td>
                    <strong>{article.title}</strong>
                    <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 3 }}>
                      {article.body.slice(0, 160)}
                      {article.body.length > 160 ? "…" : ""}
                    </div>
                    {!article.isPublished ? (
                      <span className="badge badge-closed" style={{ marginTop: 5 }}>
                        Скрыта от ИИ
                      </span>
                    ) : null}
                  </td>
                  <td>{article.kind === "faq" ? "FAQ" : "Статья"}</td>
                  <td>{formatDateTime(article.updatedAt)}</td>
                  <td>
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          setDraft({
                            id: article.id,
                            title: article.title,
                            body: article.body,
                            kind: article.kind,
                            tags: article.tags.join(", "),
                            isPublished: article.isPublished,
                          })
                        }
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => void remove(article.id)}
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
