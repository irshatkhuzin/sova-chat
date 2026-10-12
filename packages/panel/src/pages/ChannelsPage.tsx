/** Каналы подключения: код виджета, настройки внешнего вида, разрешённые домены. */
import { useCallback, useEffect, useState } from "react";
import type { ChannelDto, ChannelType } from "@sova/shared";
import type { AppContext } from "../App";
import { api, ApiError } from "../lib/api";
import { channelTypeLabel } from "../lib/format";
import { WIDGET_LOCALES, languageNameRu } from '@sova/shared';
import { WidgetLocalizationPreview } from '../components/WidgetLocalizationPreview';

export function ChannelsPage({ ctx }: { ctx: AppContext }) {
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [selected, setSelected] = useState<ChannelDto | null>(null);
  const [snippet, setSnippet] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function remove(channel: ChannelDto) {
    if (!window.confirm(`Удалить канал «${channel.name}»?\n\nПодключение через этот канал перестанет работать. История диалогов и сообщений сохранится.`)) return;
    setDeleting(channel.id);
    setMessage(null);
    try {
      await api.deleteChannel(channel.id);
      setChannels(current => current.filter(item => item.id !== channel.id));
      if (selected?.id === channel.id) { setSelected(null); setSnippet(''); setSecret(null); }
      setMessage(`Канал «${channel.name}» удалён. История переписки сохранена.`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Не удалось удалить канал');
    } finally { setDeleting(null); }
  }

  const load = useCallback(async () => {
    try {
      const res = await api.channels();
      setChannels(res.channels);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Не удалось загрузить каналы");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(channel: ChannelDto) {
    const res = await api.channel(channel.id);
    setSelected(res.channel);
    setSnippet(res.snippet);
    setSecret(null);
  }

  async function create(input: { productId: string; type: ChannelType; name: string }) {
    try {
      const res = await api.createChannel(input);
      setCreating(false);
      setSelected(res.channel);
      setSnippet(res.snippet);
      setSecret(res.channel.authSecret ?? null);
      await load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Не удалось создать канал");
    }
  }

  async function save(patch: Partial<ChannelDto>) {
    if (!selected) return;
    try {
      const res = await api.updateChannel(selected.id, patch as Record<string, unknown>);
      setSelected(res.channel);
      setSnippet(res.snippet);
      await load();
      setMessage("Сохранено");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Не удалось сохранить");
    }
  }

  return (
    <div className="page">
      <div className="page-scroll">
        <div className="page-header">
          <h1 className="page-title">Каналы подключения</h1>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreating(true)}
            disabled={ctx.products.length === 0}
          >
            Новый канал
          </button>
        </div>

        <div className="card" style={{marginBottom:16}}>
          <strong>Код для сайта и SDK находятся здесь</strong>
          <p className="hint">Создайте канал для нужного продукта и нажмите «Код / SDK». Для сайта получите готовый script-тег, для Android — SDK и пример подключения с идентификатором канала.</p>
          <div className="row row-wrap"><a className="btn" href={`${import.meta.env.BASE_URL}api/v1/admin/sdk/android`}>Скачать Android SDK (.zip)</a><a className="btn" href={`${import.meta.env.BASE_URL}api/v1/admin/sdk/android/readme`}>Инструкция Android SDK</a></div>
          <p className="hint">Android SDK: исходники для подключения модулем, базовый экран чата, загрузка и просмотр скриншотов/видео. Сообщения обновляются опросом; Socket.IO пока не реализован. Отдельного iOS SDK пока нет.</p>
        </div>

        {message ? <div className="card" style={{ marginBottom: 14 }}>{message}</div> : null}

        {creating ? (
          <CreateChannelForm
            products={ctx.products.map((p) => ({ id: p.id, name: p.name }))}
            onCancel={() => setCreating(false)}
            onCreate={create}
          />
        ) : null}

        {channels.length === 0 ? (
          <div className="card">
            Каналов нет. Создайте канал типа «Сайт», чтобы получить код виджета.
          </div>
        ) : (
          <table className="table" style={{ marginBottom: 20 }}>
            <thead>
              <tr>
                <th>Канал</th>
                <th style={{ width: 110 }}>Тип</th>
                <th style={{ width: 180 }}>Продукт</th>
                <th style={{ width: 110 }}>Состояние</th>
                <th style={{ width: 230 }} />
              </tr>
            </thead>
            <tbody>
              {channels.map((channel) => (
                <tr key={channel.id}>
                  <td>
                    <strong>{channel.name}</strong>
                    <div className="hint">{channel.publicId}</div>
                  </td>
                  <td>{channelTypeLabel(channel.type)}</td>
                  <td>{ctx.products.find((p) => p.id === channel.productId)?.name ?? "—"}</td>
                  <td>
                    {channel.isActive ? (
                      <span className="badge badge-operator">Активен</span>
                    ) : (
                      <span className="badge badge-closed">Выключен</span>
                    )}
                  </td>
                  <td>
                    <button type="button" className="btn btn-sm" disabled={deleting !== null} onClick={() => void open(channel)}>
                      Настроить / Код
                    </button>
                    {ctx.operator.role === 'admin' && <button type="button" className="btn btn-sm" style={{ marginLeft: 8, color: 'var(--danger)' }} disabled={deleting !== null} onClick={() => void remove(channel)} aria-label={`Удалить канал ${channel.name}`}>
                      {deleting === channel.id ? 'Удаляем…' : 'Удалить'}
                    </button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {selected ? (
          <ChannelEditor
            key={selected.id}
            channel={selected}
            snippet={snippet}
            secret={secret}
            onSave={save}
            onRegenerate={async () => {
              const res = await api.regenerateSecret(selected.id);
              setSecret(res.channel.authSecret ?? null);
              setMessage("Секрет перевыпущен. Старые токены больше не действуют.");
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function CreateChannelForm({
  products,
  onCancel,
  onCreate,
}: {
  products: Array<{ id: string; name: string }>;
  onCancel: () => void;
  onCreate: (input: { productId: string; type: ChannelType; name: string }) => Promise<void>;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [type, setType] = useState<ChannelType>("web");
  const [name, setName] = useState("");

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Новый канал</h2>
      <div className="row row-wrap" style={{ gap: 12, alignItems: "flex-end" }}>
        <div className="field" style={{ width: 220, marginBottom: 0 }}>
          <label className="label">Продукт</label>
          <select className="select" value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ width: 180, marginBottom: 0 }}>
          <label className="label">Тип</label>
          <select
            className="select"
            value={type}
            onChange={(e) => setType(e.target.value as ChannelType)}
          >
            <option value="web">Сайт</option>
            <option value="android">Android</option>
            <option value="telegram">Telegram (позже)</option>
            <option value="webhook">Вебхук (позже)</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
          <label className="label">Название</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onCreate({ productId, type, name: name.trim() })}
          disabled={!productId || !name.trim()}
        >
          Создать
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

function ChannelEditor({
  channel,
  snippet,
  secret,
  onSave,
  onRegenerate,
}: {
  channel: ChannelDto;
  snippet: string;
  secret: string | null;
  onSave: (patch: Partial<ChannelDto>) => Promise<void>;
  onRegenerate: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ChannelDto>(channel);
  const [origins, setOrigins] = useState(channel.allowedOrigins.join("\n"));
  const [copyStatus,setCopyStatus]=useState("");
  const [channelName,setChannelName]=useState(channel.name);
  const [savingName,setSavingName]=useState(false);

  useEffect(()=>{setChannelName(channel.name);setDraft(d=>({...d,name:channel.name}));},[channel.name]);

  return (
    <div className="grid-2">
      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Название канала</h2>
        <div className="field">
          <label className="label" htmlFor="channel-name">Название для оператора и ИИ</label>
          <input id="channel-name" className="input" maxLength={160} value={channelName} onChange={e=>setChannelName(e.target.value)} placeholder="Поддержка сайта" />
          <p className="hint">ИИ получает это название как контекст: например, поддержка сайта или мобильного приложения. Переименование не меняет код виджета, SDK или идентификатор канала.</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={savingName||!channelName.trim()||channelName.trim()===channel.name} onClick={async()=>{setSavingName(true);try{await onSave({name:channelName.trim()});}finally{setSavingName(false);}}}>{savingName?'Сохраняем…':'Сохранить название'}</button>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Подключение</h2>
        <div className="field">
          <label className="label">{channel.type==='android'?'Код подключения Android (Kotlin)':channel.type==='web'?'Код для сайта':'Подключение канала'}</label>
          <div className="code-box">{snippet}</div>
          {['web','android'].includes(channel.type)&&<button type="button" className="btn btn-sm" onClick={()=>void navigator.clipboard.writeText(snippet).then(()=>setCopyStatus("Код скопирован")).catch(()=>setCopyStatus("Не удалось скопировать автоматически. Выделите код и скопируйте вручную."))}>Скопировать код</button>}
          {copyStatus&&<p role="status" className="hint">{copyStatus}</p>}
          <div className="hint">
            {channel.type==='web'?<>Вставьте эту строку перед закрывающим тегом &lt;/body&gt;. Менять код сайта больше не нужно.</>:channel.type==='android'?<>Скачайте SDK по ссылке выше, подключите модуль sova-sdk по README и используйте этот пример. Адрес сервера уже включает нужный путь.</>:<>Этот тип интеграции пока недоступен. Используйте канал «Сайт» или «Android».</>}
          </div>
        </div>
        <div className="field">
          <label className="label">Публичный идентификатор канала</label>
          <div className="code-box">{channel.publicId}</div>
          <div className="hint">Не является секретом: доступа к чужой переписке не даёт.</div>
        </div>
        {secret ? (
          <div className="field">
            <label className="label">Секрет подписи токенов</label>
            <div className="code-box">{secret}</div>
            <div className="hint">
              Сохраните: показывается один раз. Этим секретом ваш бекенд подписывает токен
              авторизованного пользователя.
              Секрет нельзя размещать в коде сайта или Android-приложения.
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => void onRegenerate()}>
            Перевыпустить секрет
          </button>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Разрешённые домены</h2>
        <textarea
          className="textarea"
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
          placeholder={"https://example.com\nhttps://*.example.com"}
        />
        <div className="hint">
          По одному в строке. Пустой список — любой домен (удобно на этапе настройки, но на
          production лучше перечислить). Это дополнительная мера: основная защита — session_token.
        </div>
        <button
          type="button"
          className="btn"
          style={{ marginTop: 10 }}
          onClick={() =>
            void onSave({
              allowedOrigins: origins.split("\n").map((v) => v.trim()).filter(Boolean),
            })
          }
        >
          Сохранить домены
        </button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Внешний вид виджета</h2>
        <p className="hint">Для сайта и Android. Заполняйте тексты по-русски: клиент увидит перевод на выбранном языке. Если переводчик недоступен, временно показываем весь интерфейс на русском.</p>
        <div className="field">
          <label className="label">Заголовок (исходник на русском)</label>
          <input
            className="input"
            value={draft.settings.title}
            onChange={(e) =>
              setDraft({ ...draft, settings: { ...draft.settings, title: e.target.value } })
            }
          />
        </div>
        <div className="field">
          <label className="label">Подзаголовок (исходник на русском)</label>
          <input
            className="input"
            value={draft.settings.subtitle}
            onChange={(e) =>
              setDraft({ ...draft, settings: { ...draft.settings, subtitle: e.target.value } })
            }
          />
        </div>
        <div className="field">
          <label className="label">Приветствие (исходник на русском)</label>
          <textarea
            className="textarea"
            value={draft.settings.greeting}
            onChange={(e) =>
              setDraft({ ...draft, settings: { ...draft.settings, greeting: e.target.value } })
            }
          />
        </div>
        <div className="field">
          <label className="label">Текст при передаче оператору (на русском)</label>
          <textarea
            className="textarea"
            value={draft.settings.handoffNotice}
            onChange={(e) =>
              setDraft({ ...draft, settings: { ...draft.settings, handoffNotice: e.target.value } })
            }
          />
          <div className="hint">Это сообщение для клиента, а не для оператора. Использует тот же сохранённый перевод, что заголовок и приветствие.</div>
        </div>
        <div className="row row-wrap" style={{ gap: 12 }}>
          <div className="field" style={{ width: 130 }}>
            <label className="label">Цвет</label>
            <input
              className="input"
              type="color"
              value={draft.settings.primaryColor}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  settings: { ...draft.settings, primaryColor: e.target.value },
                })
              }
            />
          </div>
          <div className="field" style={{ width: 150 }}>
            <label className="label">Положение</label>
            <select
              className="select"
              value={draft.settings.position}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  settings: {
                    ...draft.settings,
                    position: e.target.value as "right" | "left",
                  },
                })
              }
            >
              <option value="right">Справа</option>
              <option value="left">Слева</option>
            </select>
          </div>
          <div className="field" style={{ flex: "1 1 200px" }}>
            <label className="label">Язык чата для клиента</label>
            <select
              className="select"
              value={draft.settings.locale}
              onChange={(e) =>
                setDraft({ ...draft, settings: { ...draft.settings, locale: e.target.value } })
              }
            >
              <option value="auto">Автоматически</option>
              {WIDGET_LOCALES.map(l => <option key={l} value={l}>{languageNameRu(l)}</option>)}
            </select>
          </div>
        </div>
        <p className="hint">Автоматически — по языку браузера или Android. Для неподдерживаемых языков используется английский. Выбор действует на оформление и кнопки; язык ответов в переписке определяется отдельно.</p>
        <label className="row" style={{ marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={draft.settings.allowAttachments}
            onChange={(e) =>
              setDraft({
                ...draft,
                settings: { ...draft.settings, allowAttachments: e.target.checked },
              })
            }
          />
          Разрешить скриншоты и видео
        </label>
        <label className="row" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
          />
          Канал активен
        </label>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            void onSave({ settings: draft.settings, isActive: draft.isActive })
          }
        >
          Сохранить настройки
        </button>
        <WidgetLocalizationPreview channel={channel} draft={draft} />
      </div>
    </div>
  );
}
