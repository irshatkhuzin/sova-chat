import type { RowDataPacket } from 'mysql2/promise';
import { PanelEvents, type MessageReadReceipt } from '@sova/shared';
import { query, execute, dateToIso, idToString } from '../../infra/db.js';
import { publishEvent } from '../../realtime/bus.js';

export async function loadReadReceipts(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await query<RowDataPacket>(`SELECT message_id, read_at FROM sova_message_reads WHERE message_id IN (${ids.map(() => '?').join(',')})`, ids);
  return new Map(rows.map(row => [idToString(row.message_id), dateToIso(row.read_at)!]));
}

/** The authenticated session owns every acknowledged message. Never infer reads from presence/history requests. */
export async function recordClientReads(endUserId: string, channelId: string, messageIds: string[]): Promise<MessageReadReceipt[]> {
  const ids = [...new Set(messageIds)].slice(0, 100);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  await execute(`INSERT IGNORE INTO sova_message_reads (message_id)
    SELECT m.id FROM sova_messages m JOIN sova_conversations c ON c.id=m.conversation_id
    WHERE m.id IN (${placeholders}) AND c.end_user_id=? AND c.channel_id=?
      AND m.author_type IN ('operator','ai') AND m.is_internal=0 AND m.delivery_status='sent'`, [...ids, endUserId, channelId]);
  const rows = await query<RowDataPacket>(`SELECT m.id, m.conversation_id, r.read_at
    FROM sova_message_reads r JOIN sova_messages m ON m.id=r.message_id
    JOIN sova_conversations c ON c.id=m.conversation_id
    WHERE m.id IN (${placeholders}) AND c.end_user_id=? AND c.channel_id=?`, [...ids, endUserId, channelId]);
  const receipts = rows.map(row => ({ messageId: idToString(row.id), readAt: dateToIso(row.read_at)! }));
  for (const conversationId of new Set(rows.map(row => idToString(row.conversation_id)))) {
    await publishEvent({ target: { scope: 'panel' }, event: PanelEvents.ReadReceipt,
      payload: { conversationId, receipts: rows.filter(row => idToString(row.conversation_id) === conversationId).map(row => ({ messageId: idToString(row.id), readAt: dateToIso(row.read_at)! })) } });
  }
  return receipts;
}
