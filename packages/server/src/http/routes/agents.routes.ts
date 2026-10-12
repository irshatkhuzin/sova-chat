import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2/promise";
import { asyncHandler, requireAdmin, rateLimit } from "../middleware.js";
import { roles, listAgentSettings, saveAgentSettings, settingsSchema } from "../../modules/ai/settings.service.js";
import { chatCompletion, AiProviderError } from "../../modules/ai/openai-client.js";
import { screeningLog } from "../../modules/ai/screening.service.js";
import { reviewProposal, restoreVersion, deleteLearningJob } from "../../modules/knowledge/learning.service.js";
import { execute, query, queryOne } from "../../infra/db.js";
import { getInboundQueue } from "../../queue/queues.js";
import { errors } from "../../infra/errors.js";
import { instructionsSchema, readInstructions, saveInstructions } from "../../modules/ai/instructions.service.js";

export const agentsRouter=Router();
agentsRouter.use(requireAdmin);
agentsRouter.get('/instructions',asyncHandler(async(req,res)=>{
  const productId=z.string().regex(/^[1-9]\d{0,19}$/).optional().parse(req.query.productId);
  res.json({instructions:await readInstructions(productId)});
}));
agentsRouter.put('/instructions',asyncHandler(async(req,res)=>{
  const parsed=instructionsSchema.safeParse(req.body);
  if(!parsed.success)throw errors.validation("Проверьте инструкции: каждое поле должно содержать не больше 4000 символов, продукт должен иметь корректный ID");
  const input=parsed.data;
  await saveInstructions(input);res.json({instructions:await readInstructions(input.productId)});
}));
agentsRouter.get('/settings',asyncHandler(async(_req,res)=>res.json(await listAgentSettings())));
agentsRouter.put('/settings/:role',asyncHandler(async(req,res)=>{
  const role=z.enum(['shared',...roles]).parse(req.params.role);
  await saveAgentSettings(role,settingsSchema.parse(req.body));res.json(await listAgentSettings());
}));
agentsRouter.post('/settings/:role/test',rateLimit({name:'ai-test',limit:6,windowSec:60}),asyncHandler(async(req,res)=>{
  const role=z.enum(roles).parse(req.params.role);
  try {
    const result=await chatCompletion({role,applyInstructions:false,messages:[{role:'user',content:'Reply OK.'}],maxOutputTokens:64});
    res.json({ok:true,model:result.model});
  } catch (err) { throw errors.validation(err instanceof AiProviderError ? err.message : "Проверка не выполнена: проверьте адрес API"); }
}));
agentsRouter.get('/usage',asyncHandler(async(_req,res)=>res.json({rows:await query<RowDataPacket>(`SELECT role,COUNT(*) calls,
  SUM(prompt_tokens) inputTokens,SUM(completion_tokens) outputTokens,SUM(cost_usd) costUsd
  FROM sova_agent_calls WHERE created_at>=UTC_DATE() GROUP BY role`)})));
agentsRouter.get('/screening',asyncHandler(async(_req,res)=>res.json({rows:await screeningLog()})));
agentsRouter.post('/screening/:id/release',asyncHandler(async(req,res)=>{
  const id=z.string().regex(/^\d+$/).parse(req.params.id);
  const m=await queryOne<RowDataPacket>("SELECT conversation_id FROM sova_messages WHERE id=?",[id]);
  if(!m)throw errors.notFound("Сообщение не найдено");
  const screening=await queryOne<RowDataPacket>("SELECT verdict FROM sova_screening WHERE message_id=?",[id]);
  if(screening?.verdict!=="rejected")throw errors.conflict("Сообщение уже восстановлено");
  const released=await execute("UPDATE sova_screening SET verdict='allowed',reason='Восстановлено администратором',reviewed_by=? WHERE message_id=? AND verdict='rejected'",[req.operatorCtx!.operator.id,id]);
  if(!released.affectedRows)throw errors.conflict("Сообщение уже восстановлено");
  await getInboundQueue().add('inbound',{conversationId:String(m.conversation_id),messageId:id},{jobId:`release-${id}-${Date.now()}`});
  res.json({ok:true});
}));
agentsRouter.get('/proposals',asyncHandler(async(_req,res)=>res.json({rows:await query<RowDataPacket>(`SELECT p.*,pr.name product_name,j.feedback_id FROM sova_knowledge_proposals p LEFT JOIN sova_learning_jobs j ON j.id=p.job_id
  JOIN sova_products pr ON pr.id=p.product_id WHERE p.status='draft' ORDER BY p.id DESC LIMIT 200`),jobs:await query<RowDataPacket>(`SELECT j.*,
  COALESCE(NULLIF(TRIM(u.display_name),''), IF(NULLIF(u.external_id,'') IS NOT NULL, CONCAT('ID ',u.external_id), CONCAT('Гость #',u.id))) AS user_name
  FROM sova_learning_jobs j JOIN sova_conversations c ON c.id=j.conversation_id
  JOIN sova_end_users u ON u.id=c.end_user_id ORDER BY j.id DESC LIMIT 30`)})));
agentsRouter.delete('/learning/:id',asyncHandler(async(req,res)=>{
  await deleteLearningJob(z.string().regex(/^\d+$/).parse(req.params.id));res.json({ok:true});
}));
agentsRouter.post('/proposals/:id/review',asyncHandler(async(req,res)=>{
  const input=z.object({action:z.enum(['approve','reject']),title:z.string().min(1).max(255).optional(),body:z.string().min(1).max(12000).optional(),articleId:z.string().regex(/^\d+$/).optional()}).parse(req.body);
  res.json({articleId:await reviewProposal(String(req.params.id),req.operatorCtx!.operator.id,input)});
}));
agentsRouter.post('/learning/:id/retry',asyncHandler(async(req,res)=>{
  await execute("UPDATE sova_learning_jobs SET status='pending',attempts=0,reason=NULL WHERE id=? AND status IN ('skipped','failed')",[String(req.params.id)]);res.json({ok:true});
}));
agentsRouter.get('/versions/:articleId',asyncHandler(async(req,res)=>res.json({rows:await query<RowDataPacket>("SELECT * FROM sova_knowledge_versions WHERE article_id=? ORDER BY id DESC LIMIT 100",[String(req.params.articleId)])})));
agentsRouter.post('/versions/:articleId/:id/restore',asyncHandler(async(req,res)=>{
  await restoreVersion(String(req.params.articleId),String(req.params.id));res.json({ok:true});
}));
