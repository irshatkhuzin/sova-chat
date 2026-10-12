import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { errors } from "../../infra/errors.js";

const exec = promisify(execFile);
export const VIDEO_MAX_BYTES = 32 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 60;
export interface PreparedMedia { width:number; height:number; duration:number|null; frames:Array<{seconds:number;dataUrl:string}> }
let tail:Promise<void> = Promise.resolve();
let queued=0;

/** Bound CPU/memory use on the shared VPS. Never pass upload names to a shell. */
export async function prepareMedia(buffer:Buffer,mime:string):Promise<PreparedMedia> {
  if(queued>=4)throw errors.rateLimited("Обработка файлов занята. Повторите загрузку чуть позже.");
  queued++;
  const previous=tail;let release!:()=>void;tail=new Promise<void>(r=>{release=r;});
  await previous;
  let dir:string|undefined;
  try {
    dir=await fs.mkdtemp(path.join(os.tmpdir(),'sova-media-'));
    const ext:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm'};
    if(!ext[mime])throw errors.unsupportedMedia();
    const input=path.join(dir,'input.'+ext[mime]);await fs.writeFile(input,buffer,{mode:0o600});
    const unprivileged=process.platform==='linux'&&process.getuid?.()===0;
    if(unprivileged){await fs.chown(dir,65534,65534);await fs.chown(input,65534,65534);}
    const processOptions={timeout:20000,maxBuffer:65536,windowsHide:true,
      ...(unprivileged?{uid:65534,gid:65534}:{}),
      env:{PATH:process.env.PATH,LANG:'C',SystemRoot:process.env.SystemRoot}};
    const safe=['-protocol_whitelist','file,pipe','-format_whitelist','png_pipe,jpeg_pipe,webp_pipe,gif,mov,matroska,webm,image2'];
    const probe=await exec(process.env.FFPROBE_PATH||'ffprobe',['-v','error',...safe,'-show_entries','stream=codec_type,width,height:format=duration','-of','json',input],{...processOptions,timeout:15000});
    const info=JSON.parse(probe.stdout);const stream=info.streams?.find((s:{codec_type:string})=>s.codec_type==='video');
    const width=Number(stream?.width),height=Number(stream?.height),video=mime.startsWith('video/');
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width*height>(video?8_400_000:20_000_000)||Math.max(width,height)>12000)
      throw errors.validation("Изображение слишком большое или файл не содержит читаемых кадров (максимум 20 Мп для фото, 4K для видео)");
    const duration=video?Number(info.format?.duration):null;
    if(video&&(!Number.isFinite(duration)||duration!<=0||duration!>VIDEO_MAX_SECONDS))throw errors.validation("Видео должно быть не длиннее 60 секунд и иметь определённую длительность");
    const times=video?[0,duration!/2,duration!*0.8]:[0];
    const frames:PreparedMedia['frames']=[];
    for(let index=0;index<times.length;index++) {
      let seconds=times[index]!;const output=path.join(dir,`frame-${index}.jpg`);
      const decode=async()=>exec(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-nostdin','-threads','1','-max_alloc','67108864',...safe,...(video?['-ss',seconds.toFixed(3)]:[]),'-i',input,'-map','0:v:0','-map_metadata','-1','-frames:v','1','-an','-sn','-filter_threads','1','-vf',"scale=w='min(1600,iw)':h='min(1600,ih)':force_original_aspect_ratio=decrease",'-threads','1','-q:v','3',output],processOptions);
      await decode();
      if(video && !(await fs.stat(output).catch(()=>null))){seconds=0;await decode();}
      const frame=await fs.readFile(output);if(frame.length>3*1024*1024)throw errors.validation("Кадр слишком большой для анализа");
      frames.push({seconds,dataUrl:'data:image/jpeg;base64,'+frame.toString('base64')});
    }
    return {width,height,duration,frames};
  } catch(err) {
    if(err && typeof err==='object' && 'status' in err)throw err;
    throw errors.validation("Не удалось прочитать изображение или видео. Используйте PNG, JPEG, WebP, GIF, MP4 или WebM; попробуйте пересохранить файл.");
  } finally {if(dir)await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});queued--;release();}
}
