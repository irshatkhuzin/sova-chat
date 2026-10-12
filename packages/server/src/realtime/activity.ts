/** Ephemeral activity only: no message text and no MySQL writes. */
import { ClientEvents, PanelEvents, type UserPresence } from '@sova/shared';
import { getRedis, key } from '../infra/redis.js';
import { publishEvent } from './bus.js';
import { moduleLogger } from '../infra/logger.js';

const log = moduleLogger('activity');
const presenceKeys = (id: string) => [key('presence', `{${id}}`, 'connections'), key('presence', `{${id}}`, 'visible'), key('presence', `{${id}}`, 'seen')];
const PRESENCE = `
local now=tonumber(ARGV[1])
local function state()
  if redis.call('ZCOUNT',KEYS[2],now,'+inf')>0 then return 'online' end
  if redis.call('ZCOUNT',KEYS[1],now,'+inf')>0 then return 'away' end
  return 'offline'
end
local before=state()
for i=1,2 do redis.call('ZREMRANGEBYSCORE',KEYS[i],'-inf',now) end
if ARGV[3]=='offline' then
  redis.call('ZREM',KEYS[1],ARGV[2]); redis.call('ZREM',KEYS[2],ARGV[2])
else
  redis.call('ZADD',KEYS[1],now+tonumber(ARGV[4]),ARGV[2])
  if ARGV[3]=='online' then redis.call('ZADD',KEYS[2],now+tonumber(ARGV[4]),ARGV[2])
  else redis.call('ZREM',KEYS[2],ARGV[2]) end
end
for i=1,2 do redis.call('PEXPIRE',KEYS[i],90000) end
redis.call('SET',KEYS[3],ARGV[1],'EX',86400)
return {before,state()}
`;

export async function setPresence(endUserId: string, connectionId: string, state: UserPresence['state'], leaseMs = 70_000): Promise<void> {
  const now = Date.now();
  const [before, after] = await getRedis().eval(PRESENCE, 3, ...presenceKeys(endUserId), now, connectionId, state, leaseMs) as string[];
  if (before !== after) await publishEvent({ target: { scope: 'panel' }, event: PanelEvents.Presence,
    payload: { endUserId, state: after, lastSeenAt: new Date(now).toISOString() } });
}

export async function readPresence(ids: string[]): Promise<UserPresence[]> {
  if (!ids.length) return [];
  const now = Date.now(), pipe = getRedis().pipeline();
  for (const id of ids) {
    const [connections, visible, seen] = presenceKeys(id);
    pipe.zcount(connections!, now, '+inf').zcount(visible!, now, '+inf').get(seen!);
  }
  const results = await pipe.exec();
  if (!results || results.some(([err]) => err)) throw new Error('Presence unavailable');
  return ids.map((endUserId, i) => ({ endUserId,
    state: Number(results[i*3+1]?.[1]) > 0 ? 'online' : Number(results[i*3]?.[1]) > 0 ? 'away' : 'offline',
    lastSeenAt: results[i*3+2]?.[1] ? new Date(Number(results[i*3+2]![1])).toISOString() : null,
  }));
}

const TYPING = `
local now=tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
if ARGV[3]=='1' then redis.call('ZADD',KEYS[1],now+6000,ARGV[2])
else redis.call('ZREM',KEYS[1],ARGV[2]) end
redis.call('PEXPIRE',KEYS[1],10000)
return redis.call('ZCARD',KEYS[1])
`;

export async function setTyping(conversationId: string, who: 'user' | 'agent', source: string, active: boolean): Promise<void> {
  const count = Number(await getRedis().eval(TYPING, 1, key('typing', conversationId, who), Date.now(), source, active ? '1' : '0'));
  await publishEvent({ target: who === 'user' ? { scope: 'panel' } : { scope: 'client', conversationId },
    event: who === 'user' ? PanelEvents.Typing : ClientEvents.Typing,
    payload: { conversationId, who, active: count > 0 } });
}

export async function agentIsTyping(conversationId: string): Promise<boolean> {
  return (await getRedis().zcount(key('typing', conversationId, 'agent'), Date.now(), '+inf')) > 0;
}

export function activityError(err: unknown): void { log.warn({ err: String(err) }, 'Activity update failed'); }

/** Pulses expire after a crash; finally always stops them on success/error. */
export async function withAgentTyping<T>(conversationId: string, source: string, work: () => Promise<T>, stillActive?: () => Promise<boolean>): Promise<T> {
  await setTyping(conversationId, 'agent', source, true).catch(activityError);
  let stopped = false, busy = false, pulse = Promise.resolve();
  const timer = setInterval(() => {
    if (stopped || busy) return;
    busy = true;
    pulse = (async () => {
      if (stillActive && !(await stillActive())) {
        stopped = true;
        clearInterval(timer);
        await setTyping(conversationId, 'agent', source, false);
      } else if (!stopped) await setTyping(conversationId, 'agent', source, true);
    })().catch(activityError).finally(() => { busy = false; });
  }, 2500);
  timer.unref();
  try { return await work(); }
  finally { stopped = true; clearInterval(timer); await pulse; await setTyping(conversationId, 'agent', source, false).catch(activityError); }
}
