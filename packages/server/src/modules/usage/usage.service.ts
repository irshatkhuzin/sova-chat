/**
 * Учёт расходов на ИИ по продуктам и проверка лимитов.
 * Лимит — защита от неожиданного счёта: при превышении ИИ отключается,
 * а диалог передаётся оператору (обращение не теряется).
 */
import type { RowDataPacket } from "mysql2/promise";
import type { UsageSummaryDto } from "@sova/shared";
import { execute, query, queryOne } from "../../infra/db.js";
import { moduleLogger } from "../../infra/logger.js";
import type { ChatUsage } from "../ai/openai-client.js";

const log = moduleLogger("usage");

export async function recordUsage(input: {
  productId: string;
  conversationId: string | null;
  kind: "reply" | "translate" | "detect" | "summary";
  provider: string;
  model: string;
  usage: ChatUsage;
  costUsd: number;
}): Promise<void> {
  try {
    await execute(
      `INSERT INTO sova_ai_usage
         (product_id, conversation_id, kind, provider, model, prompt_tokens, completion_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.productId,
        input.conversationId,
        input.kind,
        input.provider,
        input.model,
        input.usage.promptTokens,
        input.usage.completionTokens,
        input.costUsd.toFixed(6),
      ],
    );
  } catch (err) {
    log.warn({ err: String(err) }, "Не удалось записать расход ИИ");
  }
}

export interface BudgetState {
  todayUsd: number;
  monthUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  exceeded: boolean;
}

export async function checkBudget(
  productId: string,
  limits: { daily: number; monthly: number },
): Promise<BudgetState> {
  const row = await queryOne<RowDataPacket>(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at >= UTC_DATE() THEN cost_usd ELSE 0 END), 0) AS today_usd,
       COALESCE(SUM(CASE WHEN created_at >= DATE_FORMAT(UTC_DATE(), '%Y-%m-01') THEN cost_usd ELSE 0 END), 0) AS month_usd
     FROM sova_ai_usage WHERE product_id = ?`,
    [productId],
  );

  const todayUsd = Number(row?.today_usd ?? 0);
  const monthUsd = Number(row?.month_usd ?? 0);

  return {
    todayUsd,
    monthUsd,
    dailyLimitUsd: limits.daily,
    monthlyLimitUsd: limits.monthly,
    exceeded:
      (limits.daily > 0 && todayUsd >= limits.daily) ||
      (limits.monthly > 0 && monthUsd >= limits.monthly),
  };
}

export async function usageSummary(): Promise<UsageSummaryDto[]> {
  const rows = await query<RowDataPacket>(
    `SELECT p.id, p.name, p.ai_daily_cost_limit_usd, p.ai_monthly_cost_limit_usd,
            COALESCE(SUM(CASE WHEN u.created_at >= UTC_DATE() THEN u.cost_usd ELSE 0 END), 0) AS today_usd,
            COALESCE(SUM(CASE WHEN u.created_at >= DATE_FORMAT(UTC_DATE(), '%Y-%m-01') THEN u.cost_usd ELSE 0 END), 0) AS month_usd,
            COALESCE(SUM(CASE WHEN u.created_at >= UTC_DATE() THEN 1 ELSE 0 END), 0) AS today_calls,
            COALESCE(SUM(CASE WHEN u.created_at >= DATE_FORMAT(UTC_DATE(), '%Y-%m-01') THEN 1 ELSE 0 END), 0) AS month_calls
       FROM sova_products p
       LEFT JOIN sova_ai_usage u ON u.product_id = p.id
      GROUP BY p.id, p.name, p.ai_daily_cost_limit_usd, p.ai_monthly_cost_limit_usd
      ORDER BY p.name ASC`,
  );

  return rows.map((row) => ({
    productId: String(row.id),
    productName: String(row.name),
    todayUsd: Number(row.today_usd),
    monthUsd: Number(row.month_usd),
    dailyLimitUsd: Number(row.ai_daily_cost_limit_usd),
    monthlyLimitUsd: Number(row.ai_monthly_cost_limit_usd),
    todayCalls: Number(row.today_calls),
    monthCalls: Number(row.month_calls),
  }));
}
