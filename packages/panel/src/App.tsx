import { AgentsPage } from "./pages/AgentsPage";
/** Корень панели: проверка сессии, маршруты, общий каркас. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { OperatorDto, ProductDto } from "@sova/shared";
import { api } from "./lib/api";
import { closePanelSocket, getPanelSocket } from "./lib/socket";
import { attentionTitle, watchAttention } from './lib/attention';
import { LoginPage } from "./pages/LoginPage";
import { InboxPage } from "./pages/InboxPage";
import { ProductsPage } from "./pages/ProductsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Nav } from "./components/Nav";

export interface AppContext {
  operator: OperatorDto;
  products: ProductDto[];
  reloadProducts: () => Promise<void>;
  unread: number;
}

export function App() {
  const [operator, setOperator] = useState<OperatorDto | null>(null);
  const [checked, setChecked] = useState(false);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [unread, setUnread] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();

  const reloadProducts = useCallback(async () => {
    try {
      const res = await api.products();
      setProducts(res.products);
    } catch {
      setProducts([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.me();
        if (!cancelled) setOperator(res.operator);
      } catch {
        if (!cancelled) setOperator(null);
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (operator) void reloadProducts();
  }, [operator, reloadProducts]);

  useEffect(() => {
    setUnread(0);
    if (!operator) return;
    return watchAttention(getPanelSocket(), api.attention, setUnread);
  }, [operator?.id]);

  useEffect(() => {
    document.title = attentionTitle(operator ? unread : 0);
  }, [operator, unread]);

  const handleLogout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    closePanelSocket();
    setOperator(null);
    navigate("/login");
  }, [navigate]);

  const ctx = useMemo<AppContext | null>(
    () =>
      operator
        ? { operator, products, reloadProducts, unread }
        : null,
    [operator, products, reloadProducts, unread],
  );

  if (!checked) {
    return (
      <div className="empty">
        <div className="spinner" />
        <div>Проверяем сессию…</div>
      </div>
    );
  }

  if (!ctx) {
    if (location.pathname !== "/login") return <Navigate to="/login" replace />;
    return <LoginPage onSuccess={setOperator} />;
  }

  return (
    <div className="app">
      <Nav unread={unread} operator={ctx.operator} onLogout={handleLogout} />
      <div className="app-workspace">
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/" element={<InboxPage ctx={ctx} />} />
        <Route path="/conversations/:id" element={<InboxPage ctx={ctx} />} />
        <Route path="/products" element={<ProductsPage ctx={ctx} />} />
        <Route path="/knowledge" element={<KnowledgePage ctx={ctx} />} />
        <Route path="/channels" element={<ChannelsPage ctx={ctx} />} />
        <Route path="/agents" element={<AgentsPage ctx={ctx} />} />
        <Route path="/settings" element={<SettingsPage ctx={ctx} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </div>
    </div>
  );
}
