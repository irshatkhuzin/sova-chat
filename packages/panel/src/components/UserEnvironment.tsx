import { useEffect, useState } from 'react';
import { request } from '../lib/api';
import { formatFull } from '../lib/format';
interface Environment {ip:string|null;browserLanguage:string|null;userAgent:string|null;browser:string|null;os:string|null;device:string|null;observedAt:string|null;lastSeenAt:string|null;location:{country:string|null;region:string|null;city:string|null;timezone:string|null;source:string}|null}
function countryName(code:string|null|undefined){if(!code)return 'Не определена';try{return new Intl.DisplayNames(['ru'],{type:'region'}).of(code)??code;}catch{return code;}}
export function UserEnvironment({conversationId}:{conversationId:string}) {
 const [data,setData]=useState<Environment|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[version,setVersion]=useState(0);
 useEffect(()=>{let active=true;setLoading(true);setError('');setData(null);
 void request<{environment:Environment|null}>(`/conversations/${conversationId}/environment`).then(r=>{if(active)setData(r.environment);}).catch(()=>{if(active)setError('Не удалось загрузить сведения');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[conversationId,version]);
 const rows=data?[
 ['IP',data.ip??'Не определён'],['Страна ≈',countryName(data.location?.country)],['Регион ≈',data.location?.region??'Не определён'],['Город ≈',data.location?.city??'Не определён'],['Часовой пояс по IP',data.location?.timezone??'Не определён'],['Язык браузера / приложения',data.browserLanguage?.split(',').map(x=>x.split(';')[0]).join(', ')??'Пока нет данных'],['Устройство',data.device??'Не определено'],['ОС',data.os??'Не определена'],['Браузер / приложение',data.browser??'Не определён'],['Данные получены',data.observedAt?formatFull(data.observedAt):'—'],['Активность сессии',data.lastSeenAt?formatFull(data.lastSeenAt):'—']]:[];
 return <div className="details-section"><h3>Данные подключения</h3>
 {loading?<p className="hint">Загрузка…</p>:error?<p className="hint" role="alert">{error}</p>:!data?<p className="hint">Данных сессии пока нет.</p>:<>
 {rows.map(([label,value])=><div className="detail-row" key={label}><span>{label}</span><span style={{overflowWrap:'anywhere',textAlign:'right'}}>{value}</span></div>)}
 <p className="hint">Последняя сессия пользователя в этом канале. География приблизительная: VPN и мобильная сеть могут изменить страну и город. Это не подтверждение блокировки сайта.</p>
 {data.userAgent&&<details><summary className="hint">Сведения браузера (User-Agent)</summary><p className="hint" style={{overflowWrap:'anywhere'}}>{data.userAgent}</p></details>}
 {data.location&&<p className="hint">Источник: <a href="https://www.maxmind.com" target="_blank" rel="noreferrer">MaxMind GeoLite2</a> · локальная база</p>}
 </>}
 <button type="button" className="btn btn-sm" disabled={loading} onClick={()=>setVersion(v=>v+1)}>Обновить данные</button>
 </div>;
}
