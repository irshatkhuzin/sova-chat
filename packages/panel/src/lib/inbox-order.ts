import type { ConversationListItemDto } from '@sova/shared';

/** Only message time determines position. Reading/status changes cannot promote a row. */
export function sortConversations(items: ConversationListItemDto[]): ConversationListItemDto[] {
  return [...items].sort((a, b) => {
    const delta = Date.parse(b.lastMessageAt ?? b.createdAt) - Date.parse(a.lastMessageAt ?? a.createdAt);
    if (delta) return delta;
    return BigInt(a.id) < BigInt(b.id) ? 1 : BigInt(a.id) > BigInt(b.id) ? -1 : 0;
  });
}

export function canMarkRead(selectedId: string | null, id: string, visibility: string, focused: boolean): boolean {
  return selectedId === id && visibility === 'visible' && focused;
}
