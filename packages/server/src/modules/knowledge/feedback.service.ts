import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { z } from "zod";
import { query, withTransaction } from "../../infra/db.js";
import { errors } from "../../infra/errors.js";

export const feedbackSchema = z.object({
  rating: z.enum(['good','bad']),
  comment: z.string().trim().max(2000).default(''),
  correction: z.string().trim().max(4000).default(''),
}).strict();

export async function listFeedback(conversationId: string) {
  return query<RowDataPacket>(`SELECT f.message_id,f.rating,f.comment,f.correction,j.status,j.reason
    FROM sova_message_feedback f JOIN sova_messages m ON m.id=f.message_id
    LEFT JOIN sova_learning_jobs j ON j.feedback_id=f.id
    WHERE m.conversation_id=?`, [conversationId]);
}

export async function saveFeedback(conversationId: string, messageId: string, operatorId: string, input: z.infer<typeof feedbackSchema>) {
  return withTransaction(async conn => {
    const [messages] = await conn.query<RowDataPacket[]>(`SELECT id,author_type,is_internal,delivery_status FROM sova_messages
      WHERE id=? AND conversation_id=? FOR UPDATE`, [messageId,conversationId]);
    const m=messages[0];
    if(!m) throw errors.notFound('Сообщение не найдено');
    if(m.author_type!=='ai'||m.is_internal||m.delivery_status!=='sent') throw errors.validation('Можно оценить только отправленный ответ ИИ');
    const [rows] = await conn.query<RowDataPacket[]>('SELECT * FROM sova_message_feedback WHERE message_id=? FOR UPDATE',[messageId]);
    const old=rows[0];
    // Repeated clicks or network retries must not produce another model call.
    if(old && old.rating===input.rating && old.comment===input.comment && old.correction===input.correction) return;
    let feedbackId=old?.id;
    const [jobs]=await conn.query<RowDataPacket[]>('SELECT id,status FROM sova_learning_jobs WHERE feedback_id=? FOR UPDATE',[feedbackId??null]);
    const job=jobs[0];
    if(job?.status==='processing') throw errors.conflict('Идёт анализ оценки. Измените её после завершения анализа');
    if(old) await conn.execute('UPDATE sova_message_feedback SET rating=?,comment=?,correction=?,operator_id=? WHERE id=?',[input.rating,input.comment,input.correction,operatorId,feedbackId]);
    else {
      const [created]=await conn.execute<ResultSetHeader>('INSERT INTO sova_message_feedback (message_id,rating,comment,correction,operator_id) VALUES (?,?,?,?,?)',[messageId,input.rating,input.comment,input.correction,operatorId]);
      feedbackId=String(created.insertId);
    }
    const needsExplanation=input.rating==='bad'&&!input.comment&&!input.correction;
    const status=needsExplanation?'skipped':'pending';
    const reason=needsExplanation?'Добавьте причину дизлайка или правильный ответ':null;
    if(job) {
      await conn.execute('DELETE FROM sova_knowledge_proposals WHERE job_id=?',[job.id]);
      await conn.execute('UPDATE sova_learning_jobs SET status=?,reason=?,attempts=0,updated_at=UTC_TIMESTAMP(3) WHERE id=?',[status,reason,job.id]);
    } else await conn.execute('INSERT INTO sova_learning_jobs (conversation_id,closed_version,feedback_id,status,reason) VALUES (?,NULL,?,?,?)',[conversationId,feedbackId,status,reason]);
  });
}
