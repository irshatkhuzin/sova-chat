/**
 * Конечные пользователи (посетители сайта, пользователи приложения).
 * Пользователь всегда принадлежит одному продукту — истории разных продуктов
 * и разных пользователей никогда не смешиваются.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { EndUserDto } from "@sova/shared";
import { dateToIso, execute, idToString, parseJson, queryOne } from "../../infra/db.js";

export interface EndUserRow extends RowDataPacket {
  id: string;
  product_id: string;
  first_channel_id: string | null;
  external_id: string | null;
  is_verified: number;
  display_name: string | null;
  email: string | null;
  language: string | null;
  meta: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  blocked_at: Date | null;
  blocked_until: Date | null;
  blocked_reason: string | null;
}

export function endUserRowToDto(row: EndUserRow): EndUserDto {
  return {
    id: idToString(row.id),
    productId: idToString(row.product_id),
    externalId: row.external_id,
    isVerified: row.is_verified === 1,
    displayName: row.display_name,
    email: row.email,
    language: row.language,
    firstSeenAt: dateToIso(row.first_seen_at) ?? "",
    lastSeenAt: dateToIso(row.last_seen_at) ?? "",
    meta: parseJson<Record<string, unknown>>(row.meta, {}),
    isBlocked: !!row.blocked_at && (!row.blocked_until || new Date(row.blocked_until).getTime()>Date.now()),
    blockedUntil: dateToIso(row.blocked_until),
    blockedReason: row.blocked_reason,
  };
}

export async function getEndUserRow(id: string): Promise<EndUserRow | null> {
  return queryOne<EndUserRow>("SELECT * FROM sova_end_users WHERE id = ? LIMIT 1", [id]);
}

export async function findVerifiedUser(
  productId: string,
  externalId: string,
): Promise<EndUserRow | null> {
  return queryOne<EndUserRow>(
    "SELECT * FROM sova_end_users WHERE product_id = ? AND external_id = ? LIMIT 1",
    [productId, externalId],
  );
}

export async function createEndUser(input: {
  productId: string;
  channelId: string;
  externalId?: string | null;
  isVerified: boolean;
  displayName?: string | null;
  email?: string | null;
  language?: string | null;
  meta?: Record<string, unknown>;
}): Promise<EndUserRow> {
  const res = await execute(
    `INSERT INTO sova_end_users
       (product_id, first_channel_id, external_id, is_verified, display_name, email, language, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.productId,
      input.channelId,
      input.externalId ?? null,
      input.isVerified ? 1 : 0,
      input.displayName ?? null,
      input.email ?? null,
      input.language ?? null,
      JSON.stringify(input.meta ?? {}),
    ],
  );
  const row = await getEndUserRow(String(res.insertId));
  if (!row) throw new Error("Не удалось создать пользователя");
  return row;
}

export async function touchEndUser(
  id: string,
  patch: { language?: string | null; displayName?: string | null; email?: string | null } = {},
): Promise<void> {
  const sets: string[] = ["last_seen_at = UTC_TIMESTAMP(3)"];
  const params: unknown[] = [];
  if (patch.language) {
    sets.push("language = ?");
    params.push(patch.language);
  }
  if (patch.displayName) {
    sets.push("display_name = ?");
    params.push(patch.displayName);
  }
  if (patch.email) {
    sets.push("email = ?");
    params.push(patch.email);
  }
  params.push(id);
  await execute(`UPDATE sova_end_users SET ${sets.join(", ")} WHERE id = ?`, params);
}

/** Имя пользователя для панели: подтверждённое имя либо «Гость #id». */
export function endUserDisplayName(row: EndUserRow): string {
  if (row.display_name && row.display_name.trim()) return row.display_name.trim();
  if (row.external_id) return `ID ${row.external_id}`;
  return `Гость #${idToString(row.id)}`;
}
