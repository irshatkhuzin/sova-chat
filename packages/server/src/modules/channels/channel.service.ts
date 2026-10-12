/**
 * Каналы подключения. Канал принадлежит продукту и описывает, откуда приходят
 * сообщения: сайт (web), Android-приложение, позднее Telegram и вебхуки.
 *
 * public_id — публичный идентификатор (его видно в коде сайта), он не секрет.
 * auth_secret — секрет для подписи токенов авторизованных пользователей,
 * хранится зашифрованным и показывается только при создании/перегенерации.
 */
import type { RowDataPacket } from "mysql2/promise";
import {
  DEFAULT_WIDGET_SETTINGS,
  type ChannelDto,
  type ChannelType,
  type WidgetSettings,
} from "@sova/shared";
import { dateToIso, execute, idToString, parseJson, query, queryOne, withTransaction } from "../../infra/db.js";
import { errors } from "../../infra/errors.js";
import { decryptSecret, encryptSecret, randomPublicId, randomToken } from "../../infra/crypto.js";

export interface ChannelRow extends RowDataPacket {
  id: string;
  product_id: string;
  type: ChannelType;
  name: string;
  public_id: string;
  auth_secret_enc: string;
  allowed_origins: string | null;
  settings: string | null;
  is_active: number;
  created_at: Date;
  updated_at: Date;
}

export function channelRowToDto(row: ChannelRow, authSecret?: string): ChannelDto {
  const dto: ChannelDto = {
    id: idToString(row.id),
    productId: idToString(row.product_id),
    type: row.type,
    name: row.name,
    publicId: row.public_id,
    allowedOrigins: parseJson<string[]>(row.allowed_origins, []),
    settings: { ...DEFAULT_WIDGET_SETTINGS, ...parseJson<Partial<WidgetSettings>>(row.settings, {}) },
    isActive: row.is_active === 1,
    createdAt: dateToIso(row.created_at) ?? "",
    updatedAt: dateToIso(row.updated_at) ?? "",
  };
  if (authSecret) dto.authSecret = authSecret;
  return dto;
}

export async function listChannels(productId?: string): Promise<ChannelDto[]> {
  const rows = productId
    ? await query<ChannelRow>(
        "SELECT * FROM sova_channels WHERE product_id = ? AND id NOT IN (SELECT channel_id FROM sova_deleted_channels) ORDER BY created_at ASC",
        [productId],
      )
    : await query<ChannelRow>("SELECT * FROM sova_channels WHERE id NOT IN (SELECT channel_id FROM sova_deleted_channels) ORDER BY product_id ASC, created_at ASC");
  return rows.map((r) => channelRowToDto(r));
}

export async function getChannelRow(id: string): Promise<ChannelRow | null> {
  return queryOne<ChannelRow>("SELECT * FROM sova_channels WHERE id = ? LIMIT 1", [id]);
}

export async function getChannelRowByPublicId(publicId: string): Promise<ChannelRow | null> {
  return queryOne<ChannelRow>("SELECT * FROM sova_channels WHERE public_id = ? AND id NOT IN (SELECT channel_id FROM sova_deleted_channels) LIMIT 1", [publicId]);
}

export async function getChannel(id: string): Promise<ChannelDto> {
  const row = await getChannelRow(id);
  if (!row) throw errors.notFound("Канал не найден");
  return channelRowToDto(row);
}

export function getChannelSecret(row: ChannelRow): string {
  return decryptSecret(row.auth_secret_enc);
}

export interface ChannelInput {
  productId: string;
  type: ChannelType;
  name: string;
  allowedOrigins?: string[];
  settings?: Partial<WidgetSettings>;
  isActive?: boolean;
}

export async function createChannel(input: ChannelInput): Promise<ChannelDto> {
  const product = await queryOne<RowDataPacket>("SELECT id FROM sova_products WHERE id = ? LIMIT 1", [
    input.productId,
  ]);
  if (!product) throw errors.notFound("Продукт не найден");

  const secret = randomToken(32);
  const res = await execute(
    `INSERT INTO sova_channels (product_id, type, name, public_id, auth_secret_enc, allowed_origins, settings, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.productId,
      input.type,
      input.name,
      randomPublicId(),
      encryptSecret(secret),
      JSON.stringify(normalizeOrigins(input.allowedOrigins ?? [])),
      JSON.stringify({ ...DEFAULT_WIDGET_SETTINGS, ...(input.settings ?? {}) }),
      input.isActive === false ? 0 : 1,
    ],
  );

  const row = await getChannelRow(String(res.insertId));
  if (!row) throw errors.internal("Канал не создан");
  return channelRowToDto(row, secret);
}

export async function updateChannel(
  id: string,
  input: Partial<Omit<ChannelInput, "productId" | "type">>,
): Promise<ChannelDto> {
  const row = await getChannelRow(id);
  if (!row) throw errors.notFound("Канал не найден");
  const current = channelRowToDto(row);

  const merged = {
    name: input.name ?? current.name,
    allowedOrigins: normalizeOrigins(input.allowedOrigins ?? current.allowedOrigins),
    settings: { ...current.settings, ...(input.settings ?? {}) },
    isActive: input.isActive ?? current.isActive,
  };

  await execute(
    "UPDATE sova_channels SET name = ?, allowed_origins = ?, settings = ?, is_active = ? WHERE id = ? AND id NOT IN (SELECT channel_id FROM sova_deleted_channels)",
    [
      merged.name,
      JSON.stringify(merged.allowedOrigins),
      JSON.stringify(merged.settings),
      merged.isActive ? 1 : 0,
      id,
    ],
  );

  if (await queryOne("SELECT channel_id FROM sova_deleted_channels WHERE channel_id=?", [id]))
    throw errors.notFound("Канал удалён");
  return getChannel(id);
}

export async function regenerateChannelSecret(id: string): Promise<ChannelDto> {
  const row = await getChannelRow(id);
  if (!row) throw errors.notFound("Канал не найден");
  const secret = randomToken(32);
  await execute("UPDATE sova_channels SET auth_secret_enc = ? WHERE id = ?", [
    encryptSecret(secret),
    id,
  ]);
  const updated = await getChannelRow(id);
  if (!updated) throw errors.internal("Канал не найден после обновления");
  return channelRowToDto(updated, secret);
}

export async function deleteChannel(id: string): Promise<void> {
  await withTransaction(async conn => {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT id FROM sova_channels WHERE id=? FOR UPDATE", [id]);
    if (!rows.length) throw errors.notFound("Канал не найден");
    await conn.execute("UPDATE sova_channels SET is_active=0 WHERE id=?", [id]);
    await conn.execute("INSERT IGNORE INTO sova_deleted_channels(channel_id) VALUES (?)", [id]);
  });
}

function normalizeOrigins(origins: string[]): string[] {
  return origins
    .map((o) => o.trim().toLowerCase().replace(/\/+$/, ""))
    .filter((o) => o.length > 0);
}

/**
 * Проверяет Origin запроса по списку разрешённых доменов канала.
 * Пустой список означает «не ограничено» (удобно на этапе настройки),
 * о чём панель предупреждает оператора.
 * Поддерживается шаблон `*.example.com`.
 */
export function isOriginAllowed(allowed: string[], origin: string | undefined): boolean {
  if (allowed.length === 0) return true;
  if (!origin) return false;
  const normalized = origin.trim().toLowerCase().replace(/\/+$/, "");
  let host: string;
  try {
    host = new URL(normalized).host;
  } catch {
    return false;
  }
  return allowed.some((entry) => {
    let entryHost = entry;
    if (entry.includes("://")) {
      try {
        entryHost = new URL(entry).host;
      } catch {
        return false;
      }
    }
    if (entryHost.startsWith("*.")) {
      const suffix = entryHost.slice(1); // ".example.com"
      return host === entryHost.slice(2) || host.endsWith(suffix);
    }
    return host === entryHost;
  });
}
