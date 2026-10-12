/** Левая навигация. */
import { NavLink } from "react-router-dom";
import type { OperatorDto } from "@sova/shared";

interface Props {
  unread: number;
  operator: OperatorDto;
  onLogout: () => void;
}

const ITEMS = [
  { to: "/", icon: "💬", label: "Диалоги", exact: true },
  { to: "/products", icon: "📦", label: "Продукты", exact: false },
  { to: "/knowledge", icon: "📚", label: "Знания", exact: false },
  { to: "/channels", icon: "🔌", label: "Каналы", exact: false },
  { to: "/agents", icon: "🤖", label: "AI-агенты", exact: false },
  { to: "/settings", icon: "⚙️", label: "Настройки", exact: false },
];

export function Nav({ unread, operator, onLogout }: Props) {
  return (
    <nav className="nav">
      <NavLink to="/" className="nav-logo" aria-label="Sova — диалоги">
        <img src={`${import.meta.env.BASE_URL}brand/sova-icon.png`} alt="" />
      </NavLink>
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.exact}
          className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
        >
          <span className="nav-icon">{item.icon}</span>
          <span>{item.label}</span>
          {item.to === "/" && unread > 0 ? (
            <span className="nav-counter" role="status" aria-label={`Обращений для оператора: ${unread}`} title="Ожидают оператора или содержат новые сообщения в ваших диалогах">{unread > 99 ? "99+" : unread}</span>
          ) : null}
        </NavLink>
      ))}
      <div className="nav-spacer" />
      <button
        type="button"
        className="nav-item"
        onClick={onLogout}
        title={`${operator.displayName} — выйти`}
      >
        <span className="nav-icon">⏻</span>
        <span>Выход</span>
      </button>
    </nav>
  );
}
