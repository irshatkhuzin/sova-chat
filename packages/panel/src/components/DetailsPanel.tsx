/** Правая панель: пользователь, продукт, канал, язык, заметки, другие обращения. */
import { UserEnvironment } from "./UserEnvironment";
import { useState } from "react";
import {
  HANDOFF_REASON_RU,
  languageNameRu,
  languageOptions,
  type ConversationDetailDto,
  type ConversationListItemDto,
  type InternalNoteDto,
} from "@sova/shared";
import { channelTypeLabel, formatDateTime, formatFull, statusLabel } from "../lib/format";

interface Props {
  conversation: ConversationDetailDto;
  notes: InternalNoteDto[];
  otherConversations: ConversationListItemDto[];
  onLanguageChange: (language: string) => void;
  onBlockChange: (blocked:boolean,reason?:string)=>Promise<void>;
  onOpenConversation: (id: string) => void;
}

export function DetailsPanel(props: Props) {
  const { conversation } = props;
  const [changingLanguage, setChangingLanguage] = useState(false);
  const [blocking,setBlocking]=useState(false);

  return (
    <aside className="details">
      <div className="details-section">
        <h3>Обращение</h3>
        <div className="detail-row">
          <span>Состояние</span>
          <span>{statusLabel(conversation.status)}</span>
        </div>
        {conversation.handoffReason ? (
          <div className="detail-row">
            <span>Причина передачи</span>
            <span>{HANDOFF_REASON_RU[conversation.handoffReason]}</span>
          </div>
        ) : null}
        {conversation.handoffAt ? (
          <div className="detail-row">
            <span>Передано</span>
            <span>{formatDateTime(conversation.handoffAt)}</span>
          </div>
        ) : null}
        <div className="detail-row">
          <span>Создано</span>
          <span>{formatFull(conversation.createdAt)}</span>
        </div>
        {conversation.closedAt ? (
          <div className="detail-row">
            <span>Закрыто</span>
            <span>{formatFull(conversation.closedAt)}</span>
          </div>
        ) : null}
      </div>

      <UserEnvironment key={conversation.id} conversationId={conversation.id}/>

      {conversation.handoffSummaryRu ? (
        <div className="details-section">
          <h3>Краткое содержание</h3>
          <div className="card" style={{ fontSize: 13, padding: 12 }}>
            {conversation.handoffSummaryRu}
          </div>
        </div>
      ) : null}

      <div className="details-section">
        <h3>Пользователь</h3>
        {conversation.endUser.isBlocked?<div className="hint" style={{color:'#c0392b'}}>Заблокирован {conversation.endUser.blockedUntil?`до ${formatFull(conversation.endUser.blockedUntil)}`:'бессрочно'}. {conversation.endUser.blockedReason}</div>:null}
        <button type="button" className="btn btn-sm" disabled={blocking} style={{marginBottom:10,color:conversation.endUser.isBlocked?undefined:'#c0392b'}} onClick={async()=>{
          const blocked=!conversation.endUser.isBlocked;
          const reason=blocked?window.prompt('Причина блокировки пользователя во всех его диалогах этого продукта:','Спам / оскорбления'):undefined;
          if(blocked&&reason===null)return;
          setBlocking(true);try{await props.onBlockChange(blocked,reason?.trim()||undefined);}finally{setBlocking(false);}
        }}>{conversation.endUser.isBlocked?'Разблокировать':'Заблокировать'}</button>
        <div className="detail-row">
          <span>Имя</span>
          <span>{conversation.endUserName}</span>
        </div>
        <div className="detail-row">
          <span>Статус</span>
          <span>{conversation.endUserIsVerified ? "Подтверждён" : "Анонимный"}</span>
        </div>
        {conversation.endUser.externalId ? (
          <div className="detail-row">
            <span>Внешний ID</span>
            <span>{conversation.endUser.externalId}</span>
          </div>
        ) : null}
        {conversation.endUser.email ? (
          <div className="detail-row">
            <span>Email</span>
            <span>{conversation.endUser.email}</span>
          </div>
        ) : null}
        <div className="detail-row">
          <span>Первое обращение</span>
          <span>{formatDateTime(conversation.endUser.firstSeenAt)}</span>
        </div>
      </div>

      <div className="details-section">
        <h3>Язык переписки</h3>
        <div className="detail-row">
          <span>Определён</span>
          <span>{languageNameRu(conversation.language)}</span>
        </div>
        {changingLanguage ? (
          <select
            className="select"
            style={{ marginTop: 8 }}
            defaultValue={conversation.language ?? ""}
            onChange={(e) => {
              props.onLanguageChange(e.target.value);
              setChangingLanguage(false);
            }}
          >
            <option value="" disabled>
              Выберите язык
            </option>
            {languageOptions().map((option) => (
              <option key={option.code} value={option.code}>
                {option.nameRu} ({option.code})
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            className="btn btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => setChangingLanguage(true)}
          >
            Изменить вручную
          </button>
        )}
      </div>

      <div className="details-section">
        <h3>Подключение</h3>
        <div className="detail-row">
          <span>Продукт</span>
          <span>{conversation.productName}</span>
        </div>
        <div className="detail-row">
          <span>Канал</span>
          <span>{conversation.channelName}</span>
        </div>
        <div className="detail-row">
          <span>Тип</span>
          <span>{channelTypeLabel(conversation.channelType)}</span>
        </div>
      </div>

      <div className="details-section">
        <h3>Внутренние заметки</h3>
        {props.notes.length === 0 ? (
          <div className="hint">Заметок нет. Они видны только операторам.</div>
        ) : (
          props.notes.map((note) => (
            <div key={note.id} className="note-item">
              {note.body}
              <div className="note-meta">
                {note.operatorName} · {formatDateTime(note.createdAt)}
              </div>
            </div>
          ))
        )}
      </div>

      {props.otherConversations.length > 0 ? (
        <div className="details-section">
          <h3>Другие обращения</h3>
          {props.otherConversations.map((item) => (
            <button
              key={item.id}
              type="button"
              className="btn btn-sm"
              style={{ width: "100%", justifyContent: "space-between", marginBottom: 6 }}
              onClick={() => props.onOpenConversation(item.id)}
            >
              <span>{formatDateTime(item.createdAt)}</span>
              <span>{statusLabel(item.status)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
