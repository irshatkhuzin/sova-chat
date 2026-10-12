import { useEffect, useState } from 'react';
import { WIDGET_LOCALES, languageNameRu, widgetTexts, type ChannelDto, type LocalizedWidget } from '@sova/shared';
import { api } from '../lib/api';

export function WidgetLocalizationPreview({ channel, draft }: { channel: ChannelDto; draft: ChannelDto }) {
  const [language, setLanguage] = useState('en');
  const [preview, setPreview] = useState<LocalizedWidget | null>(null);
  const [statuses, setStatuses] = useState<Array<{language: string; status: string; error: string | null}>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = JSON.stringify(widgetTexts(channel.settings));
  const dirty = JSON.stringify(widgetTexts(draft.settings)) !== revision || draft.settings.locale !== channel.settings.locale;
  useEffect(() => {
    let active = true;
    setPreview(null);
    void api.channelTranslations(channel.id).then(r => { if(active) setStatuses(r.translations); }).catch(() => { if(active) setError('Не удалось загрузить статусы переводов'); });
    return () => { active = false; };
  }, [channel.id, revision]);
  async function show() {
    setBusy(true); setError(''); setPreview(null);
    try {
      setPreview(await api.previewChannel(channel.id, language));
      setStatuses((await api.channelTranslations(channel.id)).translations);
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось получить перевод'); }
    finally { setBusy(false); }
  }
  return <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
    <h3 style={{fontSize:16}}>Переводы и предпросмотр</h3>
    <p className="hint">Исходный язык — русский. Переводы готовятся при первом открытии на выбранном языке и сохраняются. Изменение русского текста создаёт новую версию перевода.</p>
    <p className="hint">{statuses.length ? statuses.map(s => `${languageNameRu(s.language)}: ${s.status === 'ok' ? 'сохранён' : 'ошибка перевода'}`).join(' · ') : 'Для текущего текста переводов пока нет.'}</p>
    <div className="row row-wrap">
      <select aria-label="Язык предпросмотра" className="select" style={{width:180}} disabled={busy} value={language} onChange={e => {setLanguage(e.target.value);setPreview(null);}}>
        {WIDGET_LOCALES.map(l => <option key={l} value={l}>{languageNameRu(l)}</option>)}
      </select>
      <button className="btn" type="button" disabled={dirty || busy} onClick={() => void show()}>{busy ? 'Готовим перевод…' : 'Показать / обновить перевод'}</button>
    </div>
    {dirty && <p className="hint">Сначала сохраните изменённые настройки. Предпросмотр использует сохранённый текст.</p>}
    {error && <p role="alert">{error}</p>}
    {preview && !dirty && <div style={{marginTop:12}}>
      <p role="status">{preview.localization.error || (preview.localization.status === 'source' ? 'Русский оригинал' : 'Перевод сохранён и готов к показу')} · Показываем: {languageNameRu(preview.localization.effectiveLanguage)}</p>
      <div style={{border:'1px solid #667085',borderRadius:12,overflow:'hidden',maxWidth:380}}>
        <div style={{background:preview.settings.primaryColor,color:'#fff',padding:16}}><strong>{preview.settings.title}</strong><div>{preview.settings.subtitle}</div></div>
        <div style={{padding:16}}><p>{preview.settings.greeting}</p><div className="hint">Сообщение клиенту при передаче оператору:</div><p>{preview.settings.handoffNotice}</p><div style={{borderTop:'1px solid #667085',paddingTop:12}}>{preview.strings.inputPlaceholder} <span style={{float:'right'}}>{preview.strings.send}</span></div></div>
      </div>
    </div>}
  </div>;
}
