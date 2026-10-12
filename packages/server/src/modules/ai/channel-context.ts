
export interface SupportChannelContext { name: string; type: string }
/** Load owner-maintained metadata afresh, scoped to this conversation's product. */
export async function loadSupportChannel(productId:string,conversationId:string):Promise<SupportChannelContext|undefined> {
  const {queryOne}=await import('../../infra/db.js');
  const row=await queryOne(`SELECT ch.name,ch.type FROM sova_conversations c
    JOIN sova_channels ch ON ch.id=c.channel_id AND ch.product_id=c.product_id
    WHERE c.id=? AND c.product_id=?`,[conversationId,productId]);
  return row?{name:String(row.name),type:String(row.type)}:undefined;
}
