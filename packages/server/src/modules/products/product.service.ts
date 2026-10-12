/** Продукты: CRUD, настройки ИИ, правила передачи оператору. */
import type { RowDataPacket } from "mysql2/promise";
import {
  DEFAULT_HANDOFF_RULES,
  type HandoffRules,
  type ProductDto,
  type ReopenPolicy,
} from "@sova/shared";
import { dateToIso, execute, idToString, parseJson, query, queryOne } from "../../infra/db.js";
import { errors } from "../../infra/errors.js";

export interface ProductRow extends RowDataPacket {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  ai_enabled: number;
  ai_instructions: string | null;
  ai_model: string | null;
  ai_temperature: string | number;
  ai_max_output_tokens: number;
  ai_max_clarify_rounds: number;
  handoff_keywords: string | null;
  handoff_rules: string | null;
  default_language: string;
  reopen_policy: ReopenPolicy;
  ai_daily_cost_limit_usd: string | number;
  ai_monthly_cost_limit_usd: string | number;
  is_active: number;
  created_at: Date;
  updated_at: Date;
}

export function productRowToDto(row: ProductRow): ProductDto {
  return {
    id: idToString(row.id),
    slug: row.slug,
    name: row.name,
    description: row.description,
    aiEnabled: row.ai_enabled === 1,
    aiInstructions: row.ai_instructions,
    aiModel: row.ai_model,
    aiTemperature: Number(row.ai_temperature),
    aiMaxOutputTokens: Number(row.ai_max_output_tokens),
    aiMaxClarifyRounds: Number(row.ai_max_clarify_rounds),
    handoffKeywords: parseJson<string[]>(row.handoff_keywords, []),
    handoffRules: { ...DEFAULT_HANDOFF_RULES, ...parseJson<Partial<HandoffRules>>(row.handoff_rules, {}) },
    defaultLanguage: row.default_language,
    reopenPolicy: row.reopen_policy,
    aiDailyCostLimitUsd: Number(row.ai_daily_cost_limit_usd),
    aiMonthlyCostLimitUsd: Number(row.ai_monthly_cost_limit_usd),
    isActive: row.is_active === 1,
    createdAt: dateToIso(row.created_at) ?? "",
    updatedAt: dateToIso(row.updated_at) ?? "",
  };
}

export async function listProducts(): Promise<ProductDto[]> {
  const rows = await query<ProductRow>("SELECT * FROM sova_products ORDER BY name ASC");
  return rows.map(productRowToDto);
}

export async function getProductRow(id: string): Promise<ProductRow | null> {
  return queryOne<ProductRow>("SELECT * FROM sova_products WHERE id = ? LIMIT 1", [id]);
}

export async function getProduct(id: string): Promise<ProductDto> {
  const row = await getProductRow(id);
  if (!row) throw errors.notFound("Продукт не найден");
  return productRowToDto(row);
}

export interface ProductInput {
  slug: string;
  name: string;
  description?: string | null;
  aiEnabled?: boolean;
  aiInstructions?: string | null;
  aiModel?: string | null;
  aiTemperature?: number;
  aiMaxOutputTokens?: number;
  aiMaxClarifyRounds?: number;
  handoffKeywords?: string[];
  handoffRules?: Partial<HandoffRules>;
  defaultLanguage?: string;
  reopenPolicy?: ReopenPolicy;
  aiDailyCostLimitUsd?: number;
  aiMonthlyCostLimitUsd?: number;
  isActive?: boolean;
}

export async function createProduct(input: ProductInput): Promise<ProductDto> {
  const existing = await queryOne<RowDataPacket>("SELECT id FROM sova_products WHERE slug = ? LIMIT 1", [
    input.slug,
  ]);
  if (existing) throw errors.conflict("Продукт с таким идентификатором уже существует");

  const res = await execute(
    `INSERT INTO sova_products
       (slug, name, description, ai_enabled, ai_instructions, ai_model, ai_temperature,
        ai_max_output_tokens, ai_max_clarify_rounds, handoff_keywords, handoff_rules,
        default_language, reopen_policy, ai_daily_cost_limit_usd, ai_monthly_cost_limit_usd, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.slug,
      input.name,
      input.description ?? null,
      input.aiEnabled === false ? 0 : 1,
      input.aiInstructions ?? null,
      input.aiModel ?? null,
      input.aiTemperature ?? 0.3,
      input.aiMaxOutputTokens ?? 500,
      input.aiMaxClarifyRounds ?? 2,
      JSON.stringify(input.handoffKeywords ?? []),
      JSON.stringify({ ...DEFAULT_HANDOFF_RULES, ...(input.handoffRules ?? {}) }),
      input.defaultLanguage ?? "en",
      input.reopenPolicy ?? "reopen_to_ai",
      input.aiDailyCostLimitUsd ?? 5,
      input.aiMonthlyCostLimitUsd ?? 50,
      input.isActive === false ? 0 : 1,
    ],
  );
  return getProduct(String(res.insertId));
}

export async function updateProduct(id: string, input: Partial<ProductInput>): Promise<ProductDto> {
  const current = await getProduct(id);

  const merged = {
    slug: input.slug ?? current.slug,
    name: input.name ?? current.name,
    description: input.description === undefined ? current.description : input.description,
    aiEnabled: input.aiEnabled ?? current.aiEnabled,
    aiInstructions:
      input.aiInstructions === undefined ? current.aiInstructions : input.aiInstructions,
    aiModel: input.aiModel === undefined ? current.aiModel : input.aiModel,
    aiTemperature: input.aiTemperature ?? current.aiTemperature,
    aiMaxOutputTokens: input.aiMaxOutputTokens ?? current.aiMaxOutputTokens,
    aiMaxClarifyRounds: input.aiMaxClarifyRounds ?? current.aiMaxClarifyRounds,
    handoffKeywords: input.handoffKeywords ?? current.handoffKeywords,
    handoffRules: { ...current.handoffRules, ...(input.handoffRules ?? {}) },
    defaultLanguage: input.defaultLanguage ?? current.defaultLanguage,
    reopenPolicy: input.reopenPolicy ?? current.reopenPolicy,
    aiDailyCostLimitUsd: input.aiDailyCostLimitUsd ?? current.aiDailyCostLimitUsd,
    aiMonthlyCostLimitUsd: input.aiMonthlyCostLimitUsd ?? current.aiMonthlyCostLimitUsd,
    isActive: input.isActive ?? current.isActive,
  };

  if (merged.slug !== current.slug) {
    const clash = await queryOne<RowDataPacket>(
      "SELECT id FROM sova_products WHERE slug = ? AND id <> ? LIMIT 1",
      [merged.slug, id],
    );
    if (clash) throw errors.conflict("Продукт с таким идентификатором уже существует");
  }

  await execute(
    `UPDATE sova_products SET
       slug = ?, name = ?, description = ?, ai_enabled = ?, ai_instructions = ?, ai_model = ?,
       ai_temperature = ?, ai_max_output_tokens = ?, ai_max_clarify_rounds = ?,
       handoff_keywords = ?, handoff_rules = ?, default_language = ?, reopen_policy = ?,
       ai_daily_cost_limit_usd = ?, ai_monthly_cost_limit_usd = ?, is_active = ?
     WHERE id = ?`,
    [
      merged.slug,
      merged.name,
      merged.description,
      merged.aiEnabled ? 1 : 0,
      merged.aiInstructions,
      merged.aiModel,
      merged.aiTemperature,
      merged.aiMaxOutputTokens,
      merged.aiMaxClarifyRounds,
      JSON.stringify(merged.handoffKeywords),
      JSON.stringify(merged.handoffRules),
      merged.defaultLanguage,
      merged.reopenPolicy,
      merged.aiDailyCostLimitUsd,
      merged.aiMonthlyCostLimitUsd,
      merged.isActive ? 1 : 0,
      id,
    ],
  );

  return getProduct(id);
}

export async function deleteProduct(id: string): Promise<void> {
  await execute("DELETE FROM sova_products WHERE id = ?", [id]);
}
