/** Страница входа оператора. */
import { useState, type FormEvent } from "react";
import type { OperatorDto } from "@sova/shared";
import { api, ApiError } from "../lib/api";

interface Props {
  onSuccess: (operator: OperatorDto) => void;
}

export function LoginPage({ onSuccess }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(email.trim(), password);
      onSuccess(res.operator);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="nav-logo"><img src={`${import.meta.env.BASE_URL}brand/sova-icon.png`} alt="" /></div>
        <h1 className="page-title" style={{ marginBottom: 4 }}>Sova</h1>
        <p className="hint" style={{ marginTop: 0, marginBottom: 18 }}>
          Панель поддержки пользователей
        </p>

        <div className="field">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="password">
            Пароль
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Входим…" : "Войти"}
        </button>

        {error ? <div className="error-text">{error}</div> : null}
      </form>
    </div>
  );
}
