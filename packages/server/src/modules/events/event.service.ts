/** Журнал событий диалога: переходы состояний, передачи, отброшенные ответы ИИ. */
import type { RowDataPacket } from "mysql2/promise";
import { dateToIso, execute, idToString, parseJson, query } from "../../infra/db.js";
import { moduleLogger } from "../../infra/logger.js";

const log = moduleLogger("events");

export type EventActor = "system" | "operator" | "ai" | "user";

export interface ConversationEventDto {
  id: string;
  conversationId: string;
  type: string;
  actorType: EventActor;
  actorId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface EventRow extends RowDataPacket {
  id: string;
  conversation_id: string;
  type: string;
  actor_type: EventActor;
  actor_id: string | null;
  payload: string | null;
  created_at: Date;
}

export async function recordEvent(
  conversationId: string,
  type: string,
  actorType: EventActor,
  actorId: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await execute(
      "INSERT INTO sova_conversation_events (conversation_id, type, actor_type, actor_id, payload) VALUES (?, ?, ?, ?, ?)",
      [conversationId, type, actorType, actorId, JSON.stringify(payload)],
    );
  } catch (err) {
    // Журнал не должен ломать основной сценарий.
    log.warn({ err, conversationId, type }, "Не удалось записать событие диалога");
  }
}

export async function listEvents(conversationId: string): Promise<ConversationEventDto[]> {
  const rows = await query<EventRow>(
    "SELECT * FROM sova_conversation_events WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 200",
    [conversationId],
  );
  return rows.map((row) => ({
    id: idToString(row.id),
    conversationId: idToString(row.conversation_id),
    type: row.type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    createdAt: dateToIso(row.created_at) ?? "",
  }));
}
