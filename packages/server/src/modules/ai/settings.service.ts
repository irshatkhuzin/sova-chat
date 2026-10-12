import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { config } from "../../config.js";
import { execute, queryOne } from "../../infra/db.js";
import { encryptSecret, decryptSecret } from "../../infra/crypto.js";
import { errors } from "../../infra/errors.js";

export const roles = ["filter", "support", "translation", "learning"] as const;
export type AgentRole = typeof roles[number];
export const settingsSchema = z.object({
  enabled: z.boolean(), useShared: z.boolean(), baseUrl: z.string().url().max(500),
  model: z.string().trim().max(120), apiKey: z.string().trim().max(8000).optional(),
  deleteKey: z.boolean().optional(), inputPrice: z.number().min(0).max(10000),
  outputPrice: z.number().min(0).max(10000), sendTemperature: z.boolean(),
  tokenParameter: z.enum(["max_tokens", "max_completion_tokens"]),
});

export function validateEndpoint(value: string): string {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || (u.port && u.port !== "443"))
    throw errors.validation("Адрес API должен быть HTTPS без логина, параметров и нестандартного порта");
  if (u.hostname === "localhost" || isIP(u.hostname.replace(/^\[|\]$/g, "")))
    throw errors.validation("Укажите публичное доменное имя API");
  return u.href.replace(/\/+$/, "");
}

export async function validatePublicEndpoint(value: string): Promise<void> {
  const u = new URL(validateEndpoint(value));
  const addresses = await lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some(({address}) => {
    if (address.includes(":")) return !/^[23][0-9a-f]{3}:/i.test(address);
    const [a,b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 || a! >= 224 ||
      (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b! >= 64 && b! <= 127) || (a === 198 && (b === 18 || b === 19));
  })) throw errors.validation("Адрес API должен вести на публичный сервер");
}

async function stored(role: string) {
  return queryOne<RowDataPacket>("SELECT * FROM sova_ai_settings WHERE role = ?", [role]);
}

export async function resolveAgent(role: AgentRole) {
  const [row, shared] = await Promise.all([stored(role), stored("shared")]);
  const useShared = row ? !!row.use_shared : true;
  const credentials = useShared ? shared : row;
  const apiKey = credentials?.api_key_enc ? decryptSecret(credentials.api_key_enc) :
    (useShared && !shared ? config.ai.openai.apiKey : "");
  const model = row?.model ?? (role === "support" ? config.ai.openai.model : config.ai.openai.translationModel);
  const enabled = row ? !!row.enabled : (role === "support" || role === "translation" || role === "filter");
  return { role, enabled, useShared, apiKey, model: String(model),
    configured: enabled && !!apiKey && !!model,
    baseUrl: String(credentials?.base_url ?? config.ai.openai.baseUrl),
    inputPrice: Number(row?.input_price ?? (role === "support" ? config.ai.openai.priceInputPerMTok : config.ai.openai.translationPriceInputPerMTok)),
    outputPrice: Number(row?.output_price ?? (role === "support" ? config.ai.openai.priceOutputPerMTok : config.ai.openai.translationPriceOutputPerMTok)),
    sendTemperature: row ? !!row.send_temperature : true,
    tokenParameter: String(row?.token_parameter ?? "max_tokens"),
  };
}
export async function isAgentReady(role: AgentRole) { return (await resolveAgent(role)).configured; }

export async function listAgentSettings() {
  const common = await stored("shared");
  const shared = { role: "shared", enabled: true, useShared: false,
    baseUrl: common?.base_url ?? config.ai.openai.baseUrl,
    hasKey: !!common?.api_key_enc || (!common && !!config.ai.openai.apiKey),
    model: "", inputPrice: 0, outputPrice: 0, sendTemperature: true, tokenParameter: "max_tokens" };
  const agents = await Promise.all(roles.map(async role => {
    const resolved = await resolveAgent(role);
    const own = await stored(role);
    const { apiKey, ...safe } = resolved;
    return { ...safe, baseUrl: own?.base_url ?? resolved.baseUrl, hasKey: !!own?.api_key_enc, effectiveKeyAvailable: !!apiKey };
  }));
  return { shared, agents };
}

export async function saveAgentSettings(role: AgentRole | "shared", input: z.infer<typeof settingsSchema>) {
  const baseUrl = validateEndpoint(input.baseUrl);
  const old = await stored(role);
  if (old && old.base_url !== baseUrl && !input.apiKey && !input.deleteKey)
    throw errors.validation("При смене адреса API введите новый ключ или удалите сохранённый");
  const inherited = role === "shared" && !old && baseUrl === config.ai.openai.baseUrl && config.ai.openai.apiKey
    ? encryptSecret(config.ai.openai.apiKey) : null;
  const encrypted = input.deleteKey ? null : input.apiKey ? encryptSecret(input.apiKey) : old?.api_key_enc ?? inherited;
  await execute(`INSERT INTO sova_ai_settings
    (role, enabled, use_shared, base_url, api_key_enc, model, input_price, output_price, send_temperature, token_parameter)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE
    enabled=VALUES(enabled), use_shared=VALUES(use_shared), base_url=VALUES(base_url), api_key_enc=VALUES(api_key_enc),
    model=VALUES(model), input_price=VALUES(input_price), output_price=VALUES(output_price),
    send_temperature=VALUES(send_temperature), token_parameter=VALUES(token_parameter)`,
    [role, +input.enabled, +input.useShared, baseUrl, encrypted, input.model, input.inputPrice, input.outputPrice, +input.sendTemperature, input.tokenParameter]);
}
