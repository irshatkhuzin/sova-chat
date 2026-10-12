/** Продукты: список, создание, настройки ИИ и правил передачи оператору. */
import { useEffect, useState } from "react";
import type { ProductDto } from "@sova/shared";
import type { AppContext } from "../App";
import { api, ApiError } from "../lib/api";

export function ProductsPage({ ctx }: { ctx: AppContext }) {
  const [selected, setSelected] = useState<ProductDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && ctx.products.length > 0) setSelected(ctx.products[0] ?? null);
  }, [ctx.products, selected]);

  async function save(patch: Partial<ProductDto>) {
    if (!selected) return;
    try {
      const res = await api.updateProduct(selected.id, patch as Record<string, unknown>);
      setSelected(res.product);
      await ctx.reloadProducts();
      setMessage("Сохранено");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Не удалось сохранить");
    }
  }

  return (
    <div className="page">
      <div className="page-scroll">
        <div className="page-header">
          <h1 className="page-title">Продукты</h1>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            Новый продукт
          </button>
        </div>

        {message ? <div className="card" style={{ marginBottom: 16 }}>{message}</div> : null}

        {creating ? (
          <CreateProductForm
            onCancel={() => setCreating(false)}
            onCreated={async (product) => {
              setCreating(false);
              await ctx.reloadProducts();
              setSelected(product);
            }}
          />
        ) : null}

        {ctx.products.length === 0 ? (
          <div className="card">
            Продуктов пока нет. Создайте первый — он объединит базу знаний, настройки ИИ и каналы
            подключения.
          </div>
        ) : (
          <div className="row row-wrap" style={{ marginBottom: 16 }}>
            {ctx.products.map((product) => (
              <button
                key={product.id}
                type="button"
                className={`chip${selected?.id === product.id ? " active" : ""}`}
                onClick={() => setSelected(product)}
              >
                {product.name}
                {!product.isActive ? " (выключен)" : ""}
              </button>
            ))}
          </div>
        )}

        {selected ? <ProductEditor key={selected.id} product={selected} onSave={save} /> : null}
      </div>
    </div>
  );
}

function CreateProductForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (product: ProductDto) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createProduct({
        name: name.trim(),
        slug: slug.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60),
        description: description.trim() || null,
      });
      await onCreated(res.product);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать продукт");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Новый продукт</h2>
      <div className="field">
        <label className="label">Название</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label className="label">Идентификатор (латиница)</label>
        <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-product" />
        <div className="hint">Используется в служебных адресах. Можно оставить пустым.</div>
      </div>
      <div className="field">
        <label className="label">Описание</label>
        <textarea
          className="textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {error ? <div className="error-text">{error}</div> : null}
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !name.trim()}>
          Создать
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

function ProductEditor({
  product,
  onSave,
}: {
  product: ProductDto;
  onSave: (patch: Partial<ProductDto>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ProductDto>(product);
  const [busy, setBusy] = useState(false);

  function update<K extends keyof ProductDto>(key: K, value: ProductDto[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    await onSave({
      name: draft.name,
      description: draft.description,
      aiEnabled: draft.aiEnabled,
      aiInstructions: draft.aiInstructions,
      aiModel: draft.aiModel || null,
      aiTemperature: draft.aiTemperature,
      aiMaxOutputTokens: draft.aiMaxOutputTokens,
      aiMaxClarifyRounds: draft.aiMaxClarifyRounds,
      handoffKeywords: draft.handoffKeywords,
      handoffRules: draft.handoffRules,
      defaultLanguage: draft.defaultLanguage,
      reopenPolicy: draft.reopenPolicy,
      aiDailyCostLimitUsd: draft.aiDailyCostLimitUsd,
      aiMonthlyCostLimitUsd: draft.aiMonthlyCostLimitUsd,
      isActive: draft.isActive,
    });
    setBusy(false);
  }

  return (
    <div className="grid-2">
      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Основное</h2>
        <div className="field">
          <label className="label">Название</label>
          <input className="input" value={draft.name} onChange={(e) => update("name", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Описание (передаётся ИИ)</label>
          <textarea
            className="textarea"
            value={draft.description ?? ""}
            onChange={(e) => update("description", e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">Язык по умолчанию</label>
          <input
            className="input"
            value={draft.defaultLanguage}
            onChange={(e) => update("defaultLanguage", e.target.value)}
          />
          <div className="hint">Используется, пока язык пользователя не определён.</div>
        </div>
        <div className="field">
          <label className="label">Новое сообщение в закрытом диалоге</label>
          <select
            className="select"
            value={draft.reopenPolicy}
            onChange={(e) => update("reopenPolicy", e.target.value as ProductDto["reopenPolicy"])}
          >
            <option value="reopen_to_ai">Открыть заново, отвечает ИИ</option>
            <option value="reopen_to_operator">Открыть заново и передать оператору</option>
            <option value="new_conversation">Создать новое обращение</option>
          </select>
        </div>
        <label className="row" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => update("isActive", e.target.checked)}
          />
          Продукт активен
        </label>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>ИИ-помощник</h2>
        <label className="row" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={draft.aiEnabled}
            onChange={(e) => update("aiEnabled", e.target.checked)}
          />
          ИИ отвечает первым
        </label>
        <div className="field">
          <label className="label">Инструкции ИИ (на русском)</label>
          <textarea
            className="textarea"
            style={{ minHeight: 160 }}
            value={draft.aiInstructions ?? ""}
            onChange={(e) => update("aiInstructions", e.target.value)}
            placeholder="Тон общения, что можно обещать, чего делать нельзя, когда звать оператора."
          />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Модель</label>
            <input
              className="input"
              value={draft.aiModel ?? ""}
              placeholder="по умолчанию из конфигурации"
              onChange={(e) => update("aiModel", e.target.value)}
            />
          </div>
          <div className="field" style={{ width: 110 }}>
            <label className="label">Температура</label>
            <input
              className="input"
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={draft.aiTemperature}
              onChange={(e) => update("aiTemperature", Number(e.target.value))}
            />
          </div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Лимит в день, $</label>
            <input
              className="input"
              type="number"
              step="0.5"
              min="0"
              value={draft.aiDailyCostLimitUsd}
              onChange={(e) => update("aiDailyCostLimitUsd", Number(e.target.value))}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Лимит в месяц, $</label>
            <input
              className="input"
              type="number"
              step="1"
              min="0"
              value={draft.aiMonthlyCostLimitUsd}
              onChange={(e) => update("aiMonthlyCostLimitUsd", Number(e.target.value))}
            />
          </div>
        </div>
        <div className="hint">
          При превышении лимита ИИ отключается, а новые обращения сразу передаются оператору.
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Передача оператору</h2>
        <label className="row" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={draft.handoffRules.onComplaint}
            onChange={(e) =>
              update("handoffRules", { ...draft.handoffRules, onComplaint: e.target.checked })
            }
          />
          При жалобе или конфликте
        </label>
        <label className="row" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={draft.handoffRules.onTechnicalFailure}
            onChange={(e) =>
              update("handoffRules", { ...draft.handoffRules, onTechnicalFailure: e.target.checked })
            }
          />
          При серьёзном техническом сбое
        </label>
        <label className="row" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={draft.handoffRules.onBillingOrAccount}
            onChange={(e) =>
              update("handoffRules", {
                ...draft.handoffRules,
                onBillingOrAccount: e.target.checked,
              })
            }
          />
          При вопросах об оплате и состоянии аккаунта
        </label>

        <div className="field">
          <label className="label">Минимальная уверенность ИИ (0–1)</label>
          <input
            className="input"
            type="number"
            step="0.05"
            min="0"
            max="1"
            value={draft.handoffRules.minConfidence}
            onChange={(e) =>
              update("handoffRules", {
                ...draft.handoffRules,
                minConfidence: Number(e.target.value),
              })
            }
          />
          <div className="hint">Ниже этого порога диалог передаётся вам.</div>
        </div>

        <div className="field">
          <label className="label">Ключевые слова (через запятую)</label>
          <input
            className="input"
            value={draft.handoffKeywords.join(", ")}
            onChange={(e) =>
              update(
                "handoffKeywords",
                e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
              )
            }
          />
          <div className="hint">
            Если сообщение содержит такое слово, диалог передаётся оператору без обращения к модели.
          </div>
        </div>

        <div className="field">
          <label className="label">Дополнительные правила (по одному в строке)</label>
          <textarea
            className="textarea"
            value={draft.handoffRules.custom.join("\n")}
            onChange={(e) =>
              update("handoffRules", {
                ...draft.handoffRules,
                custom: e.target.value.split("\n").map((v) => v.trim()).filter(Boolean),
              })
            }
            placeholder="если спрашивают про корпоративный тариф — передавай оператору"
          />
        </div>

        <div className="field">
          <label className="label">Уточняющих вопросов до передачи</label>
          <input
            className="input"
            type="number"
            min="0"
            max="5"
            value={draft.aiMaxClarifyRounds}
            onChange={(e) => update("aiMaxClarifyRounds", Number(e.target.value))}
          />
        </div>
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить продукт"}
        </button>
      </div>
    </div>
  );
}
