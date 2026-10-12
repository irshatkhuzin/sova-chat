/** Расширение типов Express: контекст оператора и клиента. */
import type { OperatorDto } from "@sova/shared";
import type { ClientSessionContext } from "../modules/auth/client-session.service.js";

export interface OperatorContext {
  operator: OperatorDto;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      operatorCtx?: OperatorContext;
      clientCtx?: ClientSessionContext;
      clientToken?: string;
    }
  }
}

export {};
