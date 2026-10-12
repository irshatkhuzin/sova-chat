import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AppContext } from "../App";
import { request } from "../lib/api";
import { AgentInstructions } from "./AgentInstructions";

type Role="shared"|"filter"|"support"|"translation"|"learning";
interface Agent {role:Role;enabled:boolean;useShared:boolean;baseUrl:string;model:string;hasKey:boolean;effectiveKeyAvailable?:boolean;configured?:boolean;inputPrice:number;outputPrice:number;sendTemperature:boolean;tokenParameter:string}
interface Proposal {feedback_id?:string|null;id:string;product_id:string;product_name:string;conversation_id:string;title:string;body:string;evidence:string;status:string;duplicate_article_id:string|null;article_id:string|null}
interface Rejected {message_id:string;conversation_id:string;original_text:string;reason:string;source:string;product_name:string}
interface Job {feedback_id?:string|null;id:string;conversation_id:string;user_name:string;status:string;reason:string|null}
interface Version {id:string;reason:string;created_at:string;snapshot:string}
const names:Record<Role,string>={shared:"Общее подключение",filter:"Фильтр сообщений",support:"Основной агент",translation:"Переводчик",learning:"Пополнение знаний"};
const hints:Record<Role,string>={shared:"Один ключ и адрес API можно использовать для нескольких агентов.",filter:"Короткая классификация. Очевидные повторы проверяются бесплатно. При сбое модели обращение пропускается.",support:"Отвечает по базе знаний, скриншотам и кадрам видео. Для вложений нужна модель с поддержкой изображений (Vision). Уточняет вопрос или передаёт диалог человеку. Модель в настройках продукта, если задана, имеет приоритет.",translation:"Переводит сообщения клиента и оператора; работает независимо от основного агента.",learning:"Предлагает знания после закрытия диалога или по оценке ответа ИИ оператором. Публикация только после вашего одобрения."};
const api=<T,>(path:string,body?:unknown,method="POST")=>request<T>(`/admin/agents${path}`,body===undefined?{}:{method,body:JSON.stringify(body)});

function AgentCard({initial,onSaved,notify}:{initial:Agent;onSaved:()=>void;notify:(s:string)=>void}) {
  const [value,setValue]=useState(initial);const [key,setKey]=useState("");const [remove,setRemove]=useState(false);const [busy,setBusy]=useState(false);const [dirty,setDirty]=useState(false);
  useEffect(()=>{setValue(initial);setKey("");setRemove(false);setDirty(false);},[initial]);
  const change=(patch:Partial<Agent>)=>{setValue(v=>({...v,...patch}));setDirty(true);};
  async function save(){setBusy(true);try{await api(`/settings/${value.role}`,{...value,apiKey:key||undefined,deleteKey:remove},"PUT");setKey("");setDirty(false);notify("Настройки сохранены. Новые запросы используют их без перезапуска.");onSaved();}catch(e){notify(String(e));}finally{setBusy(false);}}
  async function test(){setBusy(true);try{const r=await api<{model:string}>(`/settings/${value.role}/test`,{});notify(`Подключение работает. Модель: ${r.model}`);}catch(e){notify(String(e));}finally{setBusy(false);}}
  return <section className="card agent-card"><div className="row" style={{justifyContent:"space-between"}}><h2>{names[value.role]}</h2>{value.role!=="shared"&&<label><input type="checkbox" checked={value.enabled} onChange={e=>change({enabled:e.target.checked})}/> Включён</label>}</div>
    <p className="hint">{hints[value.role]}</p>
    {value.role!=="shared"&&<label className="field"><span><input type="checkbox" checked={value.useShared} onChange={e=>change({useShared:e.target.checked})}/> Использовать общий ключ и адрес API</span></label>}
    {(!value.useShared||value.role==="shared")&&<>
      <label className="field"><span className="label">Адрес API (OpenAI-совместимый)</span><input className="input" value={value.baseUrl} onChange={e=>change({baseUrl:e.target.value})} placeholder="https://api.example.com/v1"/></label>
      <label className="field"><span className="label">API-ключ · {value.hasKey?"сохранён":"не задан"}</span><input className="input" type="password" autoComplete="new-password" value={key} onChange={e=>{setKey(e.target.value);setDirty(true);setRemove(false);}} placeholder={value.hasKey?"Оставьте пустым, чтобы сохранить ключ":"Введите ключ"}/></label>
      {value.hasKey&&<label className="field"><span><input type="checkbox" checked={remove} onChange={e=>{setRemove(e.target.checked);setDirty(true);}}/> Удалить сохранённый ключ</span></label>}
    </>}
    {value.role!=="shared"&&<>
      <label className="field"><span className="label">Название модели</span><input className="input" value={value.model} onChange={e=>change({model:e.target.value})} placeholder="Точное имя модели у провайдера"/></label>
      <details><summary>Совместимость и учёт стоимости</summary><p className="hint">Цены в USD за миллион токенов. Укажите цены вашего провайдера для расчёта расходов и лимитов. Ноль означает, что стоимость этой части не учитывается.</p><div className="grid-2">
        <label className="field"><span className="label">Входящие токены, $ / 1 млн</span><input className="input" type="number" min="0" step="0.01" value={value.inputPrice} onChange={e=>change({inputPrice:Number(e.target.value)})}/></label>
        <label className="field"><span className="label">Исходящие токены, $ / 1 млн</span><input className="input" type="number" min="0" step="0.01" value={value.outputPrice} onChange={e=>change({outputPrice:Number(e.target.value)})}/></label>
      </div><label className="field"><span className="label">Параметр ограничения ответа</span><select className="input" value={value.tokenParameter} onChange={e=>change({tokenParameter:e.target.value})}><option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens</option></select></label>
      <label><input type="checkbox" checked={value.sendTemperature} onChange={e=>change({sendTemperature:e.target.checked})}/> Передавать temperature (отключите, если модель не поддерживает)</label></details>
      <p className="hint">{value.configured?"Готов к запросам · доступ к провайдеру проверяется кнопкой ниже":"Выключен либо не заполнены ключ и модель"}</p>
    </>}
    <div className="row"><button className="btn btn-primary" disabled={busy||!dirty} onClick={()=>void save()}>Сохранить</button>{value.role!=="shared"&&<button className="btn" disabled={busy||dirty||!value.configured} onClick={()=>void test()}>Проверить подключение</button>}</div>
    {value.role!=="shared"&&<p className="hint">Проверка выполняет небольшой платный запрос с сохранёнными настройками.</p>}
  </section>;
}

function ProposalCard({proposal,onDone,notify}:{proposal:Proposal;onDone:()=>void;notify:(s:string)=>void}) {
  const [title,setTitle]=useState(proposal.title);const [body,setBody]=useState(proposal.body);const [target,setTarget]=useState("");const [busy,setBusy]=useState(false);
  const [articles,setArticles]=useState<Array<{id:string;title:string}>>([]);
  useEffect(()=>{void request<{articles:Array<{id:string;title:string}>}>(`/admin/knowledge?productId=${proposal.product_id}`).then(r=>setArticles(r.articles)).catch(()=>{});},[proposal.product_id]);
  const review=async(action:string)=>{setBusy(true);try{await api(`/proposals/${proposal.id}/review`,{action,title,body,articleId:target||undefined});notify(action==='approve'?"Знания опубликованы; предыдущая версия сохранена.":"Предложение отклонено.");onDone();}catch(e){notify(String(e));}finally{setBusy(false);}};
  return <section className="card"><div className="row"><strong>{proposal.product_name}</strong><span className="badge">{proposal.status}</span><Link to={`/conversations/${proposal.conversation_id}`}>Исходный диалог</Link></div>
    <p className="hint">{proposal.feedback_id?"По оценке ответа ИИ. ":""}Основание: {proposal.evidence}</p>{proposal.duplicate_article_id&&<p>Возможный дубль статьи №{proposal.duplicate_article_id}. Проверьте перед публикацией.</p>}
    <label className="field"><span className="label">Заголовок предложения</span><input className="input" value={title} disabled={proposal.status!=='draft'} onChange={e=>setTitle(e.target.value)}/></label>
    <label className="field"><span className="label">Текст знания</span><textarea className="input" rows={7} value={body} disabled={proposal.status!=='draft'} onChange={e=>setBody(e.target.value)}/></label>
    {proposal.status==='draft'&&<><p className="hint">Проверьте точность, удалите личные данные и разовые исключения. Основная инструкция агента не меняется.</p>
    <label className="field"><span className="label">Куда опубликовать</span><select className="input" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Создать новую FAQ-статью</option>{articles.map(a=><option key={a.id} value={a.id}>Заменить: {a.title}</option>)}</select></label>
    <div className="row"><button className="btn btn-primary" disabled={busy||!title.trim()||!body.trim()} onClick={()=>void review('approve')}>Одобрить и опубликовать</button><button className="btn" disabled={busy} onClick={()=>void review('reject')}>Отклонить</button></div></>}
  </section>;
}

export function AgentsPage({ctx}:{ctx:AppContext}) {
  const [searchParams]=useSearchParams();
  const [tab,setTab]=useState(searchParams.get("tab")==="proposals"?"proposals":"settings");const [message,setMessage]=useState("");
  const [settings,setSettings]=useState<{shared:Agent;agents:Agent[]}|null>(null);
  const [rejected,setRejected]=useState<Rejected[]>([]);const [proposals,setProposals]=useState<Proposal[]>([]);const [jobs,setJobs]=useState<Job[]>([]);
  const [usage,setUsage]=useState<Array<{role:Role;calls:number;costUsd:number}>>([]);
  const [product,setProduct]=useState("");const [articles,setArticles]=useState<Array<{id:string;title:string}>>([]);const [article,setArticle]=useState("");const [versions,setVersions]=useState<Version[]>([]);
  const load=async()=>{try{if(tab==='settings'){setSettings(await api('/settings'));setUsage((await api<{rows:typeof usage}>('/usage')).rows);}if(tab==='filter')setRejected((await api<{rows:Rejected[]}>('/screening')).rows);if(tab==='proposals'){const r=await api<{rows:Proposal[];jobs:Job[]}>('/proposals');setProposals(r.rows);setJobs(r.jobs);}}catch(e){setMessage(String(e));}};
  useEffect(()=>{if(ctx.operator.role==='admin')void load();},[tab,ctx.operator.role]);
  useEffect(()=>{setArticle("");setVersions([]);if(product)void request<{articles:typeof articles}>(`/admin/knowledge?productId=${product}`).then(r=>setArticles(r.articles)).catch(e=>setMessage(String(e)));},[product]);
  const loadVersions=async(id:string)=>{setVersions((await api<{rows:Version[]}>(`/versions/${id}`)).rows);};
  const act=async(path:string,method="POST")=>{try{await api(path,{},method);setMessage("Готово");await load();}catch(e){setMessage(String(e));}};
  if(ctx.operator.role!=='admin')return <div className="empty">Настройки агентов доступны администратору.</div>;
  return <div className="page"><div className="page-scroll"><h1 className="page-title">AI-агенты</h1><div className="row agent-tabs">{[['settings','Модели и ключи'],['instructions','Инструкции'],['filter','Журнал фильтра'],['proposals','Предложенные знания'],['versions','История версий']].map(([id,label])=><button key={id} className={`btn ${tab===id?'btn-primary':''}`} onClick={()=>{setTab(id!);setMessage("");}}>{label}</button>)}<button className="btn" onClick={()=>void load()}>Обновить</button></div>
    {message&&<div className="card" role="status" style={{marginBottom:16}}>{message}</div>}
    {tab==='settings'&&<><p className="hint">Ключи зашифрованы на сервере и не возвращаются в браузер. Каждая роль выбирает свою модель.</p>{settings?<><AgentCard initial={settings.shared} onSaved={()=>void load()} notify={setMessage}/><div className="grid-2">{settings.agents.map(a=><AgentCard key={a.role} initial={a} onSaved={()=>void load()} notify={setMessage}/>)}</div></>:<p>Загрузка…</p>}<section className="card"><h2>Использование сегодня (UTC)</h2>{usage.length?usage.map(r=><p key={r.role}>{names[r.role]}: {r.calls} запросов · ${Number(r.costUsd).toFixed(4)}</p>):<p className="hint">Вызовов моделей пока нет.</p>}</section></>}
    {tab==='instructions'&&<AgentInstructions products={ctx.products}/>}
    {tab==='filter'&&<><p className="hint">Здесь сообщения, остановленные до перевода и основного агента. Ничего не удаляется. При восстановлении сообщение снова поступит в обработку.</p>{!rejected.length&&<div className="card">Отклонённых сообщений нет.</div>}{rejected.map(r=><section className="card" key={r.message_id}><strong>{r.product_name}</strong><p style={{whiteSpace:'pre-wrap'}}>{r.original_text}</p><p className="hint">{r.reason} · {r.source}</p><button className="btn" onClick={()=>void act(`/screening/${r.message_id}/release`)}>Восстановить сообщение</button></section>)}</>}
    {tab==='proposals'&&<><p className="hint">Черновики появляются после закрытия диалога с ответом оператора или анализа его оценки ответа ИИ. Проверяйте их перед публикацией.</p>{!proposals.length&&<div className="card">Новых предложений пока нет. Оцените ответ ИИ или закройте решённый диалог. Агент «Пополнение знаний» должен быть включён.</div>}{proposals.map(p=><ProposalCard key={p.id} proposal={p} onDone={()=>void load()} notify={setMessage}/>)}<section className="card"><h2>Последние задания</h2><p className="hint">Удаление задания удаляет и его черновик. Переписка и опубликованные статьи сохраняются.</p>{jobs.map(j=><div key={j.id} className="agent-job"><Link to={`/conversations/${j.conversation_id}`}>{j.user_name} · Диалог №{j.conversation_id}</Link>{j.feedback_id&&<span className="badge">Оценка ответа ИИ</span>} · {j.status} {j.reason&&<span className="hint"> — {j.reason}</span>}{['skipped','failed'].includes(j.status)&&<button className="btn" onClick={()=>void act(`/learning/${j.id}/retry`)}>Повторить анализ</button>}<button className="btn" disabled={j.status==="processing"} title={j.status==="processing"?"Дождитесь завершения анализа":"Удалить задание и его черновик"} onClick={()=>void act(`/learning/${j.id}`,"DELETE")}>Удалить</button></div>)}</section></>}
    {tab==='versions'&&<section className="card"><h2>Восстановление статьи</h2><p className="hint">Откат сохраняет текущую версию. Для новой статьи версия «До публикации» снимает её с публикации.</p><label className="field"><span className="label">Продукт</span><select className="input" value={product} onChange={e=>setProduct(e.target.value)}><option value="">Выберите продукт</option>{ctx.products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field"><span className="label">Статья</span><select className="input" value={article} onChange={e=>{setArticle(e.target.value);if(e.target.value)void loadVersions(e.target.value);else setVersions([]);}}><option value="">Выберите статью</option>{articles.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label>{versions.map(v=><details key={v.id} className="agent-job"><summary>{v.reason} · {new Date(v.created_at).toLocaleString('ru')}</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.parse(v.snapshot).body}</pre><button className="btn" onClick={()=>void act(`/versions/${article}/${v.id}/restore`).then(()=>loadVersions(article))}>Восстановить эту версию</button></details>)}{article&&!versions.length&&<p>Сохранённых версий пока нет.</p>}</section>}
  </div></div>;
}
