/** Список диалогов с фильтрами. */
import type { ChannelDto, ConversationListItemDto, ConversationStatus, ProductDto, UserPresence } from "@sova/shared";
import { Presence } from './Presence';
import { channelTypeLabel, formatRelative, statusLabel } from "../lib/format";

export interface Filters {
  productId: string;
  channelId: string;
  statuses: ConversationStatus[];
  onlyUnread: boolean;
  search: string;
}

interface Props {
  presence: Record<string, UserPresence>;
  typing: Record<string, number>;
  items: ConversationListItemDto[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  filters: Filters;
  products: ProductDto[];
  channels: ChannelDto[];
  total: number;
  onSelect: (id: string) => void;
  onFiltersChange: (filters: Filters) => void;
  onReload: () => void;
}

const STATUS_CHIPS: Array<{ value: ConversationStatus; label: string }> = [
  { value: "waiting_operator", label: "Ждут оператора" },
  { value: "operator", label: "У оператора" },
  { value: "ai", label: "У ИИ" },
  { value: "closed", label: "Закрытые" },
];

export function statusBadgeClass(status: ConversationStatus): string {
  switch (status) {
    case "ai":
      return "badge badge-ai";
    case "waiting_operator":
      return "badge badge-waiting";
    case "operator":
      return "badge badge-operator";
    case "closed":
      return "badge badge-closed";
    default:
      return "badge";
  }
}

export function ConversationList(props: Props) {
  const { filters, onFiltersChange } = props;

  function toggleStatus(status: ConversationStatus) {
    const active = filters.statuses.includes(status);
    onFiltersChange({
      ...filters,
      statuses: active
        ? filters.statuses.filter((s) => s !== status)
        : [...filters.statuses, status],
    });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <input
          className="input"
          type="search"
          placeholder="Поиск по переписке"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
        />

        <select
          className="select"
          value={filters.productId}
          onChange={(e) =>
            onFiltersChange({ ...filters, productId: e.target.value, channelId: "" })
          }
        >
          <option value="">Все продукты</option>
          {props.products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>

        {filters.productId ? (
          <select
            className="select"
            value={filters.channelId}
            onChange={(e) => onFiltersChange({ ...filters, channelId: e.target.value })}
          >
            <option value="">Все каналы</option>
            {props.channels
              .filter((channel) => channel.productId === filters.productId)
              .map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name} · {channelTypeLabel(channel.type)}
                </option>
              ))}
          </select>
        ) : null}

        <div className="filters">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className={`chip${filters.statuses.includes(chip.value) ? " active" : ""}`}
              onClick={() => toggleStatus(chip.value)}
            >
              {chip.label}
            </button>
          ))}
          <button
            type="button"
            className={`chip${filters.onlyUnread ? " active" : ""}`}
            onClick={() => onFiltersChange({ ...filters, onlyUnread: !filters.onlyUnread })}
          >
            Непрочитанные
          </button>
        </div>
      </div>

      <div className="conversation-list">
        {props.error ? (
          <div className="empty">
            <div>{props.error}</div>
            <button type="button" className="btn btn-sm" onClick={props.onReload}>
              Повторить
            </button>
          </div>
        ) : props.loading && props.items.length === 0 ? (
          <div className="empty">
            <div className="spinner" />
            <div>Загружаем диалоги…</div>
          </div>
        ) : props.items.length === 0 ? (
          <div className="empty">
            <div style={{ fontSize: 26 }}>🌙</div>
            <div>Диалогов нет</div>
            <div style={{ fontSize: 12.5 }}>
              Здесь появятся обращения из виджета и мобильного приложения.
            </div>
          </div>
        ) : (
          props.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`conversation-item${item.id === props.selectedId ? " selected" : ""}`}
              onClick={() => props.onSelect(item.id)}
            >
              <div className="conversation-top">
                <span className="conversation-name">{item.endUserName}</span>
                {item.unreadCount > 0 ? (
                  <span className="unread-dot">{item.unreadCount}</span>
                ) : null}
                <span className="conversation-time">{formatRelative(item.lastMessageAt)}</span>
              </div>
              <div className="conversation-preview">
                {props.typing[item.id] ? <span className="user-typing">Пользователь печатает…</span> : item.lastMessagePreview ?? "Нет сообщений"}
              </div>
              <Presence value={props.presence[item.endUserId]} />
              <div className="conversation-meta">
                <span className={statusBadgeClass(item.status)}>{statusLabel(item.status)}</span>
                <span className="badge">{item.productName}</span>
                <span className="badge">{channelTypeLabel(item.channelType)}</span>
                {item.language ? <span className="badge">{item.language.toUpperCase()}</span> : null}
              </div>
            </button>
          ))
        )}
      </div>

      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--border)",
          fontSize: 12,
          color: "var(--text-faint)",
        }}
      >
        Показано {props.items.length} из {props.total}
      </div>
    </aside>
  );
}
