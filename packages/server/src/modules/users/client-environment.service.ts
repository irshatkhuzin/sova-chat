import { isIP } from 'node:net';
import type { RowDataPacket } from 'mysql2/promise';
import { dateToIso, execute, queryOne } from '../../infra/db.js';

export function normalizeIp(value: string|null|undefined): string|null {
 const ip=(value??'').trim().replace(/^::ffff:/i,'');
 return isIP(ip)?ip:null;
}
export function locateIp(value: string|null) {
 const ip=normalizeIp(value);
 if(!ip || /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip) || /^(?:::1$|::$|f[cd]|fe[89ab])/i.test(ip)) return null;
 try {
  // Bundled local database; no user IP is sent to an external API.
  const geo=require('geoip-lite').lookup(ip);
  return geo ? {country:geo.country||null,region:geo.region||null,city:geo.city||null,timezone:geo.timezone||null,source:'GeoLite2 / geoip-lite 1.4.10'} : null;
 } catch {return null;}
}
export function describeDevice(ua: string|null) {
 const s=ua??'';
 const browser=[[/Edg(?:A|iOS)?\/([\d.]+)/,'Edge'],[/OPR\/([\d.]+)/,'Opera'],[/SamsungBrowser\/([\d.]+)/,'Samsung Internet'],[/(?:Firefox|FxiOS)\/([\d.]+)/,'Firefox'],[/(?:Chrome|CriOS)\/([\d.]+)/,'Chrome'],[/Version\/([\d.]+).*Safari/,'Safari'],[/okhttp\/([\d.]+)/i,'Android-приложение (OkHttp)']] as const;
 const found=browser.find(([re])=>re.test(s));
 const os=/Android/i.test(s)?'Android':/iPhone|iPad|iPod/i.test(s)?'iOS / iPadOS':/Windows/i.test(s)?'Windows':/Mac OS X/i.test(s)?'macOS':/Linux/i.test(s)?'Linux':null;
 return {browser:found?found[1]+' '+s.match(found[0])![1]:null,os,device:/iPad|Tablet/i.test(s)||(/Android/i.test(s)&&!/Mobile|okhttp/i.test(s))?'Планшет':/Mobile|iPhone|iPod|okhttp/i.test(s)?'Телефон / приложение':os?'Компьютер':null};
}
export async function saveEnvironment(sessionId:string, language?:string|null) {
 const value=language?.trim().slice(0,255)||null;
 await execute(`INSERT INTO sova_client_environment (session_id,browser_language) VALUES (?,?)
 ON DUPLICATE KEY UPDATE browser_language=COALESCE(VALUES(browser_language),browser_language),observed_at=UTC_TIMESTAMP(3)`,[sessionId,value]);
}
export async function readEnvironment(endUserId:string,channelId:string) {
 const s=await queryOne<RowDataPacket>(`SELECT s.ip,s.user_agent,s.created_at,s.last_seen_at,e.browser_language,e.observed_at
 FROM sova_end_user_sessions s LEFT JOIN sova_client_environment e ON e.session_id=s.id
 WHERE s.end_user_id=? AND s.channel_id=? ORDER BY s.last_seen_at DESC,s.created_at DESC LIMIT 1`,[endUserId,channelId]);
 if(!s)return null;
 const ip=normalizeIp(s.ip);
 return {ip,browserLanguage:s.browser_language??null,userAgent:s.user_agent??null,...describeDevice(s.user_agent),location:locateIp(ip),observedAt:dateToIso(s.observed_at??s.created_at),lastSeenAt:dateToIso(s.last_seen_at)};
}
