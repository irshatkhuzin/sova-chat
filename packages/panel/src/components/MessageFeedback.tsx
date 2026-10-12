import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../lib/api';

export interface Feedback {
  message_id: string; rating: 'good'|'bad'; comment: string; correction: string;
  status: string|null; reason: string|null;
}
export function MessageFeedback({conversationId,messageId,initial,onSaved}:{conversationId:string;messageId:string;initial:Feedback|null|undefined;onSaved:(rows:Feedback[])=>void}) {
  const [editing,setEditing]=useState(false);
  const [rating,setRating]=useState<'good'|'bad'>('bad');
  const [comment,setComment]=useState('');
  const [correction,setCorrection]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  useEffect(()=>{if(!editing){setRating(initial?.rating??'bad');setComment(initial?.comment??'');setCorrection(initial?.correction??'');}},[initial,editing]);
  const locked=busy||initial===undefined;
  function open(value:'good'|'bad') {setRating(value);setComment(initial?.comment??'');setCorrection(initial?.correction??'');setNotice('');setEditing(true);}
  async function save(value=rating,reason=comment,answer=correction) {
    setBusy(true);setNotice('');
    try {
      const res=await request<{rows:Feedback[]}>(`/conversations/${conversationId}/messages/${messageId}/feedback`,{method:'PUT',body:JSON.stringify({rating:value,comment:reason,correction:answer})});
      onSaved(res.rows);setEditing(false);
      const saved=res.rows.find(f=>String(f.message_id)===messageId);
      setNotice(saved?.reason??'Оценка сохранена. Результат анализа появится в «Предложенных знаниях».');
    } catch(e) {setNotice(e instanceof Error?e.message:'Не удалось сохранить оценку');}
    finally {setBusy(false);}
  }
  return <div className="message-feedback">
    <div className="row">
      <button type="button" className={`btn btn-sm ${initial?.rating==='good'?'btn-primary':''}`} aria-label="Хороший ответ ИИ" aria-pressed={initial?.rating==='good'} disabled={locked} onClick={()=>initial?.rating==='good'?open('good'):void save('good','','')}>👍</button>
      <button type="button" className={`btn btn-sm ${initial?.rating==='bad'?'btn-primary':''}`} aria-label="Плохой ответ ИИ" aria-pressed={initial?.rating==='bad'} disabled={locked} onClick={()=>open('bad')}>👎</button>
      {initial&&<button type="button" className="original-toggle" disabled={locked} onClick={()=>open(initial.rating)}>Изменить оценку</button>}
      <span className="hint">Оценка оператора</span>
    </div>
    {editing&&<div className="feedback-editor">
      <label className="field"><span className="label">{rating==='bad'?'Что не так с ответом?':'Что особенно полезно в ответе?'}</span><textarea className="input" rows={2} maxLength={2000} value={comment} disabled={busy} onChange={e=>setComment(e.target.value)}/></label>
      <label className="field"><span className="label">Правильный ответ или уточнение (необязательно)</span><textarea className="input" rows={3} maxLength={4000} value={correction} disabled={busy} onChange={e=>setCorrection(e.target.value)}/></label>
      <p className="hint">Комментарий виден только операторам. Без пояснения дизлайк сохранится, но черновик не будет создан. Новые знания публикуются после одобрения.</p>
      <div className="row"><button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={()=>void save()}>{busy?'Сохраняем…':'Сохранить оценку'}</button><button type="button" className="btn btn-sm" disabled={busy} onClick={()=>setEditing(false)}>Отмена</button></div>
    </div>}
    {notice&&<p className="hint" role="status">{notice}</p>}
    {initial&&<Link className="original-toggle" to="/agents?tab=proposals">Предложенные знания</Link>}
  </div>;
}
