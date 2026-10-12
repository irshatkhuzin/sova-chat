import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { query, queryOne, withTransaction } from "../../infra/db.js";
import { errors } from "../../infra/errors.js";
import { roles, type AgentRole } from "./settings.service.js";

const instruction = z.string().trim().max(4000);
export const instructionsSchema = z.object({
  productId: z.string().regex(/^[1-9]\d{0,19}$/).nullable().optional(),
  instructions: z.object({filter:instruction,support:instruction,translation:instruction,learning:instruction}),
});
const scopeKey = (id?: string | null) => id ? `product:${id}` : "global";

export async function readInstructions(productId?: string | null) {
  const result = {filter:"",support:"",translation:"",learning:""};
  const rows = await query<RowDataPacket>("SELECT role,instructions FROM sova_agent_instructions WHERE scope_key=?",[scopeKey(productId)]);
  for (const row of rows) if (roles.includes(row.role)) result[row.role as AgentRole] = String(row.instructions);
  return result;
}

export async function saveInstructions(input: z.infer<typeof instructionsSchema>) {
  if (input.productId && !await queryOne("SELECT id FROM sova_products WHERE id=?",[input.productId])) throw errors.notFound("Продукт не найден");
  await withTransaction(async conn => {
    for (const role of roles) await conn.execute(`INSERT INTO sova_agent_instructions (scope_key,role,instructions)
      VALUES (?,?,?) ON DUPLICATE KEY UPDATE instructions=VALUES(instructions)`,[scopeKey(input.productId),role,input.instructions[role]]);
  });
}

export async function effectiveInstructions(role: AgentRole, productId?: string): Promise<string> {
  const rows = await query<RowDataPacket>(`SELECT scope_key,instructions FROM sova_agent_instructions
    WHERE role=? AND scope_key IN (?,?)`,[role,"global",scopeKey(productId)]);
  const common = rows.find(r=>r.scope_key==="global")?.instructions;
  const specific = productId ? rows.find(r=>r.scope_key===scopeKey(productId))?.instructions : "";
  return [common && `General owner guidance:\n${common}`,specific && `Product-specific owner guidance (takes priority over general guidance):\n${specific}`].filter(Boolean).join("\n\n");
}
