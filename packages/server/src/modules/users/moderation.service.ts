import type { RowDataPacket } from 'mysql2/promise';
import { ErrorCodes } from '@sova/shared';
import { AppError } from '../../infra/errors.js';
import { queryOne, query, withTransaction } from '../../infra/db.js';
import { getRedis, key } from '../../infra/redis.js';
import { recordEvent } from '../events/event.service.js';
import { publishConversationUpdate } from '../../pipeline/delivery.js';

export async function isUserBlocked(userId:string):Promise<boolean> {
  return !!await queryOne('SELECT id FROM sova_end_users WHERE id=? AND blocked_at IS NOT NULL AND (blocked_until IS NULL OR blocked_until>UTC_TIMESTAMP(3))',[userId]);
}
export async function assertUserMaySend(userId:string):Promise<void> {
  if(await isUserBlocked(userId))throw new AppError(ErrorCodes.Forbidden,'Отправка сообщений заблокирована службой поддержки.',423);
}
/** Blocks apply to the product's end-user, across their sessions and conversations. */
export async function setUserBlock(userId:string,blocked:boolean,reason:string,operatorId:string|null,seconds?:number):Promise<void> {
  const changed=await withTransaction(async conn=>{
    const [rows]=await conn.query<RowDataPacket[]>('SELECT blocked_at,blocked_until FROM sova_end_users WHERE id=? FOR UPDATE',[userId]);
    if(!rows[0])return false;
    if(!operatorId&&rows[0].blocked_at&&(!rows[0].blocked_until||new Date(rows[0].blocked_until).getTime()>Date.now()))return false;
    if(blocked)await conn.execute('UPDATE sova_end_users SET blocked_at=UTC_TIMESTAMP(3),blocked_until=?,blocked_reason=? WHERE id=?',[seconds?new Date(Date.now()+seconds*1000):null,reason.slice(0,500),userId]);
    else await conn.execute('UPDATE sova_end_users SET blocked_at=NULL,blocked_until=NULL,blocked_reason=NULL,moderation_reset_at=UTC_TIMESTAMP(3) WHERE id=?',[userId]);
    // Cancel replies already being generated; content/history remain available to operators.
    await conn.execute('UPDATE sova_conversations SET state_version=state_version+1 WHERE end_user_id=?',[userId]);
    return true;
  });
  if(!changed)return;
  if(!blocked)await getRedis().del(key('moderation',userId,'burst'));
  const conversations=await query<RowDataPacket>('SELECT id FROM sova_conversations WHERE end_user_id=?',[userId]);
  for(const c of conversations){await recordEvent(String(c.id),blocked?'user_blocked':'user_unblocked',operatorId?'operator':'system',operatorId,{reason,source:operatorId?'operator':'automatic',durationSeconds:seconds??null});await publishConversationUpdate(String(c.id));}
}
/** Idempotent retries do not count. Ninth distinct message in ten seconds pauses sending. */
export async function guardMessageBurst(userId:string,clientMsgId:string):Promise<void> {
  const count=Number(await getRedis().eval(`
    if redis.call('SET',KEYS[2],'1','EX',60,'NX') == false then return 0 end
    local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],10) end;return n`,2,key('moderation',userId,'burst'),key('moderation',userId,'message',clientMsgId)));
  if(count>8){await setUserBlock(userId,true,'Флуд: больше 8 сообщений за 10 секунд',null,15*60);await assertUserMaySend(userId);}
}
/** Three rejected messages in ten minutes trigger a reversible 24-hour automatic block. */
export async function blockRepeatedSpam(conversationId:string):Promise<void> {
  const row=await queryOne<RowDataPacket>(`SELECT u.id,COUNT(s.message_id) n FROM sova_conversations current_c
    JOIN sova_end_users u ON u.id=current_c.end_user_id JOIN sova_conversations c ON c.end_user_id=u.id
    JOIN sova_messages m ON m.conversation_id=c.id JOIN sova_screening s ON s.message_id=m.id
    WHERE current_c.id=? AND s.verdict='rejected' AND s.reviewed_by IS NULL
    AND s.created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE)
    AND (u.moderation_reset_at IS NULL OR s.created_at>u.moderation_reset_at) GROUP BY u.id`,[conversationId]);
  if(row&&Number(row.n)>=3)await setUserBlock(String(row.id),true,'Повторный явный спам или оскорбления без обращения: 3 отклонённых сообщения за 10 минут',null,86400);
}
