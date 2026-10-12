import { localizeChannel, localizationStatuses } from "../../modules/channels/localization.service.js";
import { WIDGET_LOCALES } from "@sova/shared";
import { disconnectChannelClients } from "../../realtime/io.js";
import { agentsRouter } from "./agents.routes.js";
import path from "node:path";
import { serverRoot, projectRoot } from "../../infra/paths.js";
import { connectionSnippet } from "../../modules/channels/connection-snippet.js";
import { isAgentReady, resolveAgent } from "../../modules/ai/settings.service.js";
/** Управление продуктами, каналами, базой знаний, операторами и расходами. */
import { Router } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { errors } from "../../infra/errors.js";
import { hashPassword, validatePasswordStrength } from "../../modules/auth/password.js";
import { execute, idToString } from "../../infra/db.js";
import {
  createChannel,
  deleteChannel,
  getChannel,
  getChannelRow,
  listChannels,
  regenerateChannelSecret,
  updateChannel,
} from "../../modules/channels/channel.service.js";
import {
  createArticle,
  deleteArticle,
  getArticle,
  listArticles,
  updateArticle,
} from "../../modules/knowledge/knowledge.service.js";
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from "../../modules/products/product.service.js";
import { listOperators } from "../../modules/auth/operator-auth.service.js";
import { usageSummary } from "../../modules/usage/usage.service.js";
import { signUserToken } from "../../modules/auth/client-session.service.js";
import { getChannelSecret } from "../../modules/channels/channel.service.js";
import { asyncHandler, requireAdmin, rateLimit } from "../middleware.js";

export const adminRouter = Router();
adminRouter.use("/agents", agentsRouter);
adminRouter.get('/sdk/android',(_req,res,next)=>{
  res.download(path.join(serverRoot,'assets','sova-android-sdk.zip'),'sova-android-sdk.zip',err=>{if(err)next(err);});
});
adminRouter.get('/sdk/android/readme',(_req,res,next)=>{
  res.download(path.join(projectRoot,'android-sdk','README.md'),'Sova-Android-SDK.md',err=>{if(err)next(err);});
});

/* ───────────────────────── Продукты ───────────────────────── */

const handoffRulesSchema = z
  .object({
    onComplaint: z.boolean().optional(),
    onTechnicalFailure: z.boolean().optional(),
    onBillingOrAccount: z.boolean().optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    custom: z.array(z.string().max(300)).max(20).optional(),
  })
  .optional();

const productSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/, "Только латиница, цифры и дефис"),
  name: z.string().min(1).max(160),
  description: z.string().max(4000).nullable().optional(),
  aiEnabled: z.boolean().optional(),
  aiInstructions: z.string().max(20000).nullable().optional(),
  aiModel: z.string().max(80).nullable().optional(),
  aiTemperature: z.number().min(0).max(2).optional(),
  aiMaxOutputTokens: z.number().min(50).max(4000).optional(),
  aiMaxClarifyRounds: z.number().min(0).max(5).optional(),
  handoffKeywords: z.array(z.string().max(80)).max(100).optional(),
  handoffRules: handoffRulesSchema,
  defaultLanguage: z.string().min(2).max(8).optional(),
  reopenPolicy: z.enum(["reopen_to_ai", "reopen_to_operator", "new_conversation"]).optional(),
  aiDailyCostLimitUsd: z.number().min(0).max(10000).optional(),
  aiMonthlyCostLimitUsd: z.number().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
});

adminRouter.get(
  "/products",
  asyncHandler(async (_req, res) => {
    res.json({ products: await listProducts() });
  }),
);

adminRouter.post(
  "/products",
  asyncHandler(async (req, res) => {
    const input = productSchema.parse(req.body);
    res.json({ product: await createProduct(input) });
  }),
);

adminRouter.get(
  "/products/:id",
  asyncHandler(async (req, res) => {
    res.json({ product: await getProduct(String(req.params.id)) });
  }),
);

adminRouter.patch(
  "/products/:id",
  asyncHandler(async (req, res) => {
    const input = productSchema.partial().parse(req.body);
    res.json({ product: await updateProduct(String(req.params.id), input) });
  }),
);

adminRouter.delete(
  "/products/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await deleteProduct(String(req.params.id));
    res.json({ ok: true });
  }),
);

/* ───────────────────────── Каналы ───────────────────────── */

const widgetSettingsSchema = z
  .object({
    title: z.string().max(80).optional(),
    subtitle: z.string().max(120).optional(),
    greeting: z.string().max(500).optional(),
    handoffNotice: z.string().max(500).optional(),
    offlineNotice: z.string().max(500).optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    position: z.enum(["right", "left"]).optional(),
    offsetX: z.number().min(0).max(200).optional(),
    offsetY: z.number().min(0).max(200).optional(),
    locale: z.enum(["auto", ...WIDGET_LOCALES]).optional(),
    showLauncherLabel: z.boolean().optional(),
    launcherLabel: z.string().max(60).optional(),
    allowAttachments: z.boolean().optional(),
  })
  .optional();

const channelSchema = z.object({
  productId: z.string().min(1),
  type: z.enum(["web", "android", "telegram", "webhook"]),
  name: z.string().min(1).max(160),
  allowedOrigins: z.array(z.string().max(200)).max(50).optional(),
  settings: widgetSettingsSchema,
  isActive: z.boolean().optional(),
});

adminRouter.get(
  "/channels",
  asyncHandler(async (req, res) => {
    const productId = req.query.productId ? String(req.query.productId) : undefined;
    res.json({ channels: await listChannels(productId) });
  }),
);

adminRouter.post(
  "/channels",
  asyncHandler(async (req, res) => {
    const input = channelSchema.parse(req.body);
    const channel = await createChannel(input);
    res.json({
      channel,
      snippet: connectionSnippet(channel.type, channel.publicId, config.publicUrl),
    });
  }),
);

adminRouter.get(
  "/channels/:id",
  asyncHandler(async (req, res) => {
    const channel = await getChannel(String(req.params.id));
    res.json({ channel, snippet: connectionSnippet(channel.type, channel.publicId, config.publicUrl) });
  }),
);

adminRouter.patch(
  "/channels/:id",
  asyncHandler(async (req, res) => {
    const input = channelSchema.partial().omit({ productId: true, type: true }).parse(req.body);
    const channel = await updateChannel(String(req.params.id), input);
    res.json({ channel, snippet: connectionSnippet(channel.type, channel.publicId, config.publicUrl) });
  }),
);

adminRouter.post(
  "/channels/:id/regenerate-secret",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ channel: await regenerateChannelSecret(String(req.params.id)) });
  }),
);

adminRouter.delete(
  "/channels/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await deleteChannel(String(req.params.id));
    disconnectChannelClients(String(req.params.id));
    res.json({ ok: true });
  }),
);

/**
 * Пример подписанного токена пользователя — чтобы можно было сразу проверить
 * интеграцию авторизованных пользователей, не поднимая свой бекенд.
 * Доступно только администратору.
 */
adminRouter.post(
  "/channels/:id/sample-token",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await getChannelRow(String(req.params.id));
    if (!row) throw errors.notFound("Канал не найден");
    const input = z
      .object({
        externalId: z.string().min(1).max(190),
        name: z.string().max(160).optional(),
        email: z.string().email().optional(),
        ttlMinutes: z.number().min(1).max(1440).optional(),
      })
      .parse(req.body);

    const secret = getChannelSecret(row);
    const token = signUserToken(
      {
        externalId: input.externalId,
        name: input.name,
        email: input.email,
        exp: Math.floor(Date.now() / 1000) + (input.ttlMinutes ?? 60) * 60,
      },
      secret,
    );
    res.json({ token });
  }),
);

/* ───────────────────────── База знаний ───────────────────────── */

const articleSchema = z.object({
  productId: z.string().min(1),
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(100000),
  kind: z.enum(["article", "faq"]).optional(),
  lang: z.string().min(2).max(8).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  isPublished: z.boolean().optional(),
});

adminRouter.get(
  "/knowledge",
  asyncHandler(async (req, res) => {
    const productId = String(req.query.productId ?? "");
    if (!productId) throw errors.validation("Не указан продукт");
    const search = req.query.search ? String(req.query.search) : undefined;
    res.json({ articles: await listArticles(productId, { search }) });
  }),
);

adminRouter.post(
  "/knowledge",
  asyncHandler(async (req, res) => {
    const input = articleSchema.parse(req.body);
    res.json({ article: await createArticle(input) });
  }),
);

adminRouter.get(
  "/knowledge/:id",
  asyncHandler(async (req, res) => {
    res.json({ article: await getArticle(String(req.params.id)) });
  }),
);

adminRouter.patch(
  "/knowledge/:id",
  asyncHandler(async (req, res) => {
    const input = articleSchema.partial().omit({ productId: true }).parse(req.body);
    res.json({ article: await updateArticle(String(req.params.id), input) });
  }),
);

adminRouter.delete(
  "/knowledge/:id",
  asyncHandler(async (req, res) => {
    await deleteArticle(String(req.params.id));
    res.json({ ok: true });
  }),
);

/* ───────────────────────── Операторы и расходы ───────────────────────── */

adminRouter.get(
  "/operators",
  asyncHandler(async (_req, res) => {
    res.json({ operators: await listOperators() });
  }),
);

const operatorSchema = z.object({
  email: z.string().email().max(190),
  displayName: z.string().min(1).max(120),
  password: z.string().min(10).max(200),
  role: z.enum(["admin", "operator"]).optional(),
  telegramUserId: z.string().max(40).nullable().optional(),
});

adminRouter.post(
  "/operators",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = operatorSchema.parse(req.body);
    const weak = validatePasswordStrength(input.password);
    if (weak) throw errors.validation(weak);

    await execute(
      `INSERT INTO sova_operators (email, password_hash, display_name, role, telegram_user_id)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.email.trim().toLowerCase(),
        await hashPassword(input.password),
        input.displayName,
        input.role ?? "operator",
        input.telegramUserId ?? null,
      ],
    );
    res.json({ operators: await listOperators() });
  }),
);

adminRouter.get(
  "/usage",
  asyncHandler(async (_req, res) => {
    res.json({ usage: await usageSummary(), aiConfigured: await isAgentReady("support") });
  }),
);

adminRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json({
      aiConfigured: await isAgentReady("support"),
      aiProvider: config.ai.provider,
      aiModel: (await resolveAgent("support")).model,
      translationProvider: config.translation.provider,
      telegramConfigured: config.telegram.enabled,
      publicUrl: config.publicUrl,
      operatorLanguage: config.translation.operatorLanguage,
    });
  }),
);

export function channelIdToString(value: unknown): string {
  return idToString(value);
}

adminRouter.get('/channels/:id/localization', asyncHandler(async (req, res) => {
  const row = await getChannelRow(String(req.params.id));
  if (!row) throw errors.notFound('Канал не найден');
  res.json({ sourceLanguage: 'ru', translations: await localizationStatuses(row) });
}));
adminRouter.post('/channels/:id/localization/preview', rateLimit({ name: 'widget-preview', limit: 20, windowSec: 60 }), asyncHandler(async (req, res) => {
  const { language } = z.object({ language: z.enum(WIDGET_LOCALES) }).parse(req.body);
  const row = await getChannelRow(String(req.params.id));
  if (!row) throw errors.notFound('Канал не найден');
  res.json(await localizeChannel(row, language, { previewLanguage: language, retryFailed: true }));
}));
