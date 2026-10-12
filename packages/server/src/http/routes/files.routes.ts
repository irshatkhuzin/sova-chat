/**
 * Выдача вложений. Файл отдаётся только участнику диалога:
 * оператору с активной сессией или клиенту с session_token этого диалога.
 */
import { Router } from "express";
import { idToString } from "../../infra/db.js";
import { errors } from "../../infra/errors.js";
import { resolveClientSession } from "../../modules/auth/client-session.service.js";
import {
  assertSessionActive,
  verifyAccessToken,
} from "../../modules/auth/operator-auth.service.js";
import { getConversationRow } from "../../modules/conversations/conversation.service.js";
import { getAttachmentRow, readAttachment } from "../../modules/files/file.service.js";
import { ACCESS_COOKIE, asyncHandler } from "../middleware.js";

export const filesRouter = Router();

filesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const attachment = await getAttachmentRow(String(req.params.id));
    if (!attachment) throw errors.notFound("Файл не найден");

    const allowed = await isAllowed(req, idToString(attachment.conversation_id));
    if (!allowed) throw errors.forbidden("Нет доступа к файлу");

    const file = await readAttachment(attachment);

    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Length", String(file.buffer.length));
    // Изображения показываются в чате, но никогда не исполняются как HTML.
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.fileName)}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("Accept-Ranges","bytes");
    if(req.headers.range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      const total=file.buffer.length;
      const start=match?(match[1]?Number(match[1]):Math.max(0,total-Number(match[2]))):NaN;
      const end=match?(match[1]&&match[2]?Math.min(total-1,Number(match[2])):total-1):NaN;
      if(!match||(!match[1]&&!match[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=total||end<start){res.status(416).setHeader('Content-Range',`bytes */${total}`);res.removeHeader('Content-Length');res.end();return;}
      res.status(206).setHeader('Content-Range',`bytes ${start}-${end}/${total}`);res.setHeader('Content-Length',String(end-start+1));res.send(file.buffer.subarray(start,end+1));return;
    }
    res.send(file.buffer);
  }),
);

async function isAllowed(
  req: import("express").Request,
  conversationId: string,
): Promise<boolean> {
  // 1. Оператор.
  const cookieToken = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (cookieToken) {
    try {
      const payload = verifyAccessToken(cookieToken);
      await assertSessionActive(payload.sid);
      return true;
    } catch {
      // Ниже проверим клиентскую сессию.
    }
  }

  // 2. Клиент: токен сессии в заголовке.
  const sessionToken =
    bearer ?? (typeof req.headers["x-sova-session"] === "string" ? req.headers["x-sova-session"] : undefined);
  if (!sessionToken) return false;

  try {
    const ctx = await resolveClientSession(sessionToken);
    const conversation = await getConversationRow(conversationId);
    if (!conversation) return false;
    return (
      idToString(conversation.end_user_id) === idToString(ctx.endUser.id) &&
      idToString(conversation.channel_id) === idToString(ctx.channel.id)
    );
  } catch {
    return false;
  }
}
