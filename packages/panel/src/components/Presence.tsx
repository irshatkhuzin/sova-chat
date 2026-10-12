import type { UserPresence } from '@sova/shared';

export function Presence({ value }: { value?: UserPresence }) {
  const state = value?.state ?? 'unknown';
  const label = state === 'online' ? 'Онлайн' : state === 'away' ? 'Отошёл' : state === 'offline' ? 'Не в сети' : 'Статус неизвестен';
  const title = state === 'offline' && value?.lastSeenAt
    ? `${label} · Был в сети ${new Date(value.lastSeenAt).toLocaleString('ru-RU')}` : label;
  return <span className={`presence presence-${state}`} title={title}><span aria-hidden="true" className="presence-dot" />{label}</span>;
}
