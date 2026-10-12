/** Настройки: состояние системы, расходы на ИИ, операторы. */
import { useEffect, useState } from "react";
import type { OperatorDto, UsageSummaryDto } from "@sova/shared";
import type { AppContext } from "../App";
import { api, ApiError } from "../lib/api";

interface Status {
  aiConfigured: boolean;
  aiProvider: string;
  aiModel: string;
  translationProvider: string;
  telegramConfigured: boolean;
  publicUrl: string;
  operatorLanguage: string;
}

export function SettingsPage({ ctx }: { ctx: AppContext }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [usage, setUsage] = useState<UsageSummaryDto[]>([]);
  const [operators, setOperators] = useState<OperatorDto[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [newOperator, setNewOperator] = useState({ email: "", displayName: "", password: "" });

  useEffect(() => {
    void api.status().then(setStatus).catch(() => undefined);
    void api.usage().then((res) => setUsage(res.usage)).catch(() => undefined);
    void api.operators().then((res) => setOperators(res.operators)).catch(() => undefined);
  }, []);

  async function addOperator() {
    try {
      const res = await api.createOperator({
        email: newOperator.email.trim(),
        displayName: newOperator.displayName.trim(),
        password: newOperator.password,
      });
      setOperators(res.operators);
      setNewOperator({ email: "", displayName: "", password: "" });
      setMessage("Оператор добавлен");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Не удалось добавить оператора");
    }
  }

  return (
    <div className="page">
      <div className="page-scroll">
        <div className="page-header">
          <h1 className="page-title">Настройки</h1>
        </div>

        {message ? <div className="card" style={{ marginBottom: 14 }}>{message}</div> : null}

        <div className="grid-2">
          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Состояние системы</h2>
            {!status ? (
              <div className="row">
                <div className="spinner" /> Загружаем…
              </div>
            ) : (
              <>
                <div className="detail-row">
                  <span>ИИ-помощник</span>
                  <span>
                    {status.aiConfigured ? (
                      <span className="badge badge-operator">Подключён</span>
                    ) : (
                      <span className="badge badge-danger">Ключ не задан</span>
                    )}
                  </span>
                </div>
                <div className="detail-row">
                  <span>Провайдер</span>
                  <span>{status.aiProvider}</span>
                </div>
                <div className="detail-row">
                  <span>Модель по умолчанию</span>
                  <span>{status.aiModel}</span>
                </div>
                <div className="detail-row">
                  <span>Перевод</span>
                  <span>{status.translationProvider}</span>
                </div>
                <div className="detail-row">
                  <span>Уведомления в Telegram</span>
                  <span>{status.telegramConfigured ? "Включены" : "Выключены"}</span>
                </div>
                <div className="detail-row">
                  <span>Язык оператора</span>
                  <span>{status.operatorLanguage}</span>
                </div>
                <div className="detail-row">
                  <span>Публичный адрес</span>
                  <span>{status.publicUrl}</span>
                </div>
                {!status.aiConfigured ? (
                  <div className="hint" style={{ marginTop: 10 }}>
                    Ключ провайдера не задан: ответы ИИ не генерируются, все обращения сразу
                    попадают оператору. Настройте ключ и модель в разделе «AI-агенты».
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Расходы на ИИ</h2>
            {usage.length === 0 ? (
              <div className="hint">Пока нет данных.</div>
            ) : (
              <table className="table" style={{ border: "none" }}>
                <thead>
                  <tr>
                    <th>Продукт</th>
                    <th>Сегодня</th>
                    <th>Месяц</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((row) => (
                    <tr key={row.productId}>
                      <td>{row.productName}</td>
                      <td>
                        ${row.todayUsd.toFixed(3)}
                        <div className="hint">лимит ${row.dailyLimitUsd}</div>
                      </td>
                      <td>
                        ${row.monthUsd.toFixed(2)}
                        <div className="hint">лимит ${row.monthlyLimitUsd}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Операторы</h2>
            <table className="table" style={{ border: "none", marginBottom: 14 }}>
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Email</th>
                  <th>Роль</th>
                </tr>
              </thead>
              <tbody>
                {operators.map((operator) => (
                  <tr key={operator.id}>
                    <td>{operator.displayName}</td>
                    <td>{operator.email}</td>
                    <td>{operator.role === "admin" ? "Администратор" : "Оператор"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {ctx.operator.role === "admin" ? (
              <>
                <div className="field">
                  <label className="label">Email</label>
                  <input
                    className="input"
                    value={newOperator.email}
                    onChange={(e) => setNewOperator({ ...newOperator, email: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="label">Имя</label>
                  <input
                    className="input"
                    value={newOperator.displayName}
                    onChange={(e) =>
                      setNewOperator({ ...newOperator, displayName: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label className="label">Пароль (от 10 символов, с цифрой)</label>
                  <input
                    className="input"
                    type="password"
                    value={newOperator.password}
                    onChange={(e) => setNewOperator({ ...newOperator, password: e.target.value })}
                  />
                </div>
                <button type="button" className="btn btn-primary" onClick={() => void addOperator()}>
                  Добавить оператора
                </button>
              </>
            ) : (
              <div className="hint">Добавлять операторов может только администратор.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
