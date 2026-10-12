import { query, queryOne } from "../../infra/db.js";
import { preparedAttachment, type AttachmentRow } from "../files/file.service.js";
export interface AiImage { dataUrl:string; label:string }

/** Read only accepted customer media from this conversation, never future messages. */
export async function loadMediaContext(conversationId:string,messageId:string):Promise<AiImage[]> {
  const current=await queryOne("SELECT seq FROM sova_messages WHERE id=? AND conversation_id=?",[messageId,conversationId]);
  if(!current)return [];
  const rows=await query<AttachmentRow>(`SELECT a.*,m.seq FROM sova_attachments a
    JOIN sova_messages m ON m.id=a.message_id
    LEFT JOIN sova_screening s ON s.message_id=m.id
    WHERE a.conversation_id=? AND m.conversation_id=? AND m.author_type='user' AND m.is_internal=0
      AND m.seq<=? AND m.seq>? AND (s.verdict IS NULL OR s.verdict='allowed')
    ORDER BY m.seq DESC,a.id LIMIT 3`,[conversationId,conversationId,current.seq,Math.max(0,Number(current.seq)-20)]);
  const images:AiImage[]=[];
  for(const row of rows.reverse()) {
    const prepared=await preparedAttachment(row);
    for(const frame of prepared.frames) images.push({dataUrl:frame.dataUrl,label:
      `Customer message #${row.seq}, attachment ${row.id}. `+(prepared.duration===null?'Image (first frame if animated).':`Video sample at ${frame.seconds.toFixed(1)}s of ${prepared.duration.toFixed(1)}s. Only 3 sampled frames; no audio, unseen events are unknown.`)});
  }
  return images;
}
