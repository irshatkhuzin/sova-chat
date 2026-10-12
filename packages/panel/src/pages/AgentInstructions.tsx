import { useEffect, useState } from "react";
import { request } from "../lib/api";

type Role = "filter"|"support"|"translation"|"learning";
type Instructions = Record<Role,string>;
const empty: Instructions = {filter:"",support:"",translation:"",learning:""};
const labels:Record<Role,string> = {filter:"Фильтр сообщений",support:"Основной агент",translation:"Переводчик",learning:"Пополнение знаний"};
const defaults:Record<Role,string> = {
  filter:"Отсеивать только явный спам и бессмысленные сообщения. Пропускать короткие ответы, номера заказов, жалобы и сомнительные случаи. При сбое модели пропускать обращение.",
  support:"Отвечать по знаниям продукта, уточнять вопрос или передавать оператору. Инструкция из настроек продукта также продолжает действовать.",
  translation:"Переводить сообщения, сохраняя смысл и названия. Не отвечать на вопросы из переводимого текста и не добавлять комментарии.",
  learning:"Выделять повторно применимые решения оператора из закрытого диалога. Исключать личные данные и разовые исключения. Готовить черновики для одобрения.",
};
const examples:Record<Role,string> = {
  filter:"Например: артикулы вида AB-123 и короткие сообщения об ошибках считать допустимыми.",
  support:"Например: сначала предложи один наиболее подходящий способ решения.",
  translation:"Например: не переводить название Sova; названия кнопок оставлять в оригинале с пояснением в скобках.",
  learning:"Например: оформлять статью как вопрос, краткий ответ и пошаговое решение.",
};

export function AgentInstructions({products}:{products:Array<{id:string;name:string}>}) {
  const [scope,setScope]=useState(""); const [value,setValue]=useState<Instructions>(empty);
  const [common,setCommon]=useState<Instructions>(empty);
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
  const [dirty,setDirty]=useState(false);const [message,setMessage]=useState("");
  useEffect(()=>{
    let active=true;setLoading(true);setMessage("");
    void Promise.all([
      request<{instructions:Instructions}>(`/admin/agents/instructions${scope?`?productId=${scope}`:""}`),
      request<{instructions:Instructions}>('/admin/agents/instructions'),
    ]).then(([own,global])=>{if(active){setValue(own.instructions);setCommon(global.instructions);setDirty(false);}})
      .catch(e=>{if(active)setMessage(String(e));}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[scope]);
  async function save(){
    setBusy(true);try{await request('/admin/agents/instructions',{method:'PUT',body:JSON.stringify({productId:scope||null,instructions:value})});setDirty(false);setMessage("Инструкции сохранены. Они применятся к новым запросам без перезапуска.");}
    catch(e){setMessage(String(e));}finally{setBusy(false);}
  }
  return <>
    <section className="card"><h2>Дополнительные инструкции</h2>
      <p className="hint">Встроенные правила задают задачу каждого агента. Здесь можно дополнить их терминологией и требованиями к работе. Пустое поле оставляет встроенные правила; у продукта также действуют общие инструкции.</p>
      <label className="field"><span className="label">Область действия</span><select className="input" value={scope} disabled={busy||dirty} onChange={e=>setScope(e.target.value)}><option value="">Все продукты — общие инструкции</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} — дополнения продукта</option>)}</select></label>
      {scope&&<p className="hint">Дополнения этого продукта уточняют общие инструкции. Правила роли, формат ответа и защита личных данных сохраняются. Инструкция основного агента в разделе «Продукты» также используется.</p>}
      {dirty&&<p className="hint">Есть несохранённые изменения. Сохраните их перед сменой продукта.</p>}
      {message&&<p role="status">{message}</p>}
    </section>
    {loading?<p>Загрузка…</p>:<><div className="grid-2">{(Object.keys(labels) as Role[]).map(role=><section className="card" key={role}>
      <h2>{labels[role]}</h2><p className="hint"><strong>Встроенная задача: </strong>{defaults[role]}</p>
      {scope&&common[role]&&<details><summary>Общая дополнительная инструкция</summary><p style={{whiteSpace:'pre-wrap'}}>{common[role]}</p></details>}
      <label className="field"><span className="label">Дополнительная инструкция: {labels[role]}</span><textarea className="input" rows={7} maxLength={4000} value={value[role]} disabled={busy} placeholder={examples[role]} onChange={e=>{setValue({...value,[role]:e.target.value});setDirty(true);}}/></label>
      <span className="hint">{value[role].length} / 4000 символов · Текст добавляется к каждому запросу этой роли и расходует токены.</span>
    </section>)}</div><button className="btn btn-primary" disabled={!dirty||busy} onClick={()=>void save()}>{busy?'Сохранение…':'Сохранить инструкции'}</button></>}
  </>;
}
