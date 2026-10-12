/**
 * Вложения. В первой версии — изображения (скриншоты ошибок).
 *
 * Тип файла определяется по «магическим байтам», а не по расширению или
 * заголовку Content-Type, поэтому переименованный файл не пройдёт проверку.
 * Файлы отдаются только участникам соответствующего диалога.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import type { AttachmentDto } from "@sova/shared";
import { config } from "../../config.js";
import { execute, idToString, queryOne } from "../../infra/db.js";
import { errors } from "../../infra/errors.js";
import { uuid } from "../../infra/crypto.js";
import { moduleLogger } from "../../infra/logger.js";
import { prepareMedia, VIDEO_MAX_BYTES, type PreparedMedia } from "./media.processor.js";

const log = moduleLogger("files");

export interface AttachmentRow extends RowDataPacket {
  id: string;
  conversation_id: string;
  message_id: string | null;
  uploaded_by: "user" | "operator";
  storage_key: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
}

interface Signature {
  mime: string;
  ext: string;
  test: (buf: Buffer) => boolean;
}

const SIGNATURES: Signature[] = [
  {mime:"video/mp4",ext:"mp4",test:b=>b.length>12&&b.subarray(4,8).toString('ascii')==='ftyp'&&/^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(b.subarray(8,12).toString('ascii'))},
  {mime:"video/webm",ext:"webm",test:b=>b.length>32&&b.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))&&b.subarray(0,256).includes(Buffer.from('webm'))},
  {
    mime: "image/png",
    ext: "png",
    test: (b) =>
      b.length > 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: "image/jpeg",
    ext: "jpg",
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/gif",
    ext: "gif",
    test: (b) => b.length > 6 && b.subarray(0, 6).toString("ascii").startsWith("GIF8"),
  },
  {
    mime: "image/webp",
    ext: "webp",
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

export function detectImageType(buffer: Buffer): { mime: string; ext: string } | null {
  for (const sig of SIGNATURES) {
    if (sig.test(buffer)) return { mime: sig.mime, ext: sig.ext };
  }
  return null;
}

/** Размеры PNG и JPEG — без внешних библиотек, чтобы не тянуть нативные зависимости. */
export function imageSize(buffer: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && buffer.length > 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mime === "image/jpeg") {
      let offset = 2;
      while (offset < buffer.length - 9) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1] as number;
        const length = buffer.readUInt16BE(offset + 2);
        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
          };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function storageRoot(): string {
  return path.resolve(process.cwd(), config.storage.localDir);
}

export interface SaveAttachmentInput {
  conversationId: string;
  buffer: Buffer;
  fileName: string;
  uploadedBy: "user" | "operator";
  uploaderId: string | null;
}

export async function saveAttachment(input: SaveAttachmentInput): Promise<AttachmentDto> {
  if (input.buffer.length === 0) throw errors.validation("Пустой файл");
  const detected = detectImageType(input.buffer);
  const video=detected?.mime.startsWith('video/');
  const maxBytes=video?VIDEO_MAX_BYTES:config.storage.maxUploadBytes;
  if (input.buffer.length > maxBytes) {
    throw errors.tooLarge(
      `Файл больше ${(maxBytes / 1024 / 1024).toFixed(1)} МБ`,
    );
  }

  if (!detected || (!video && !config.storage.allowedMime.includes(detected.mime))) {
    throw errors.unsupportedMedia("Поддерживаются PNG, JPEG, GIF, WebP, MP4 и WebM");
  }
  const prepared=await prepareMedia(input.buffer,detected.mime);

  const id = uuid();
  const now = new Date();
  const relativeDir = path.join(
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
  );
  const storageKey = path.join(relativeDir, `${id}.${detected.ext}`);
  const absolutePath = path.join(storageRoot(), storageKey);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, input.buffer,{mode:0o600});
  await fs.writeFile(absolutePath+'.frames.json',JSON.stringify(prepared),{mode:0o600});

  const size = prepared;
  const safeName = sanitizeFileName(input.fileName) || `image.${detected.ext}`;

  await execute(
    `INSERT INTO sova_attachments
       (id, conversation_id, uploaded_by, uploader_id, storage_key, file_name, mime, size_bytes, width, height)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.conversationId,
      input.uploadedBy,
      input.uploaderId,
      storageKey.split(path.sep).join("/"),
      safeName,
      detected.mime,
      input.buffer.length,
      size?.width ?? null,
      size?.height ?? null,
    ],
  );

  log.info({ id, conversationId: input.conversationId, bytes: input.buffer.length }, "Вложение сохранено");

  return {
    id,
    fileName: safeName,
    mime: detected.mime,
    sizeBytes: input.buffer.length,
    url: `${config.publicUrl}/api/v1/files/${id}`,
    width: size?.width ?? null,
    height: size?.height ?? null,
  };
}

export async function getAttachmentRow(id: string): Promise<AttachmentRow | null> {
  return queryOne<AttachmentRow>("SELECT * FROM sova_attachments WHERE id = ? LIMIT 1", [id]);
}

export async function readAttachment(
  row: AttachmentRow,
): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
  const absolutePath = path.join(storageRoot(), row.storage_key);
  // Защита от выхода за пределы каталога хранения.
  if (!absolutePath.startsWith(storageRoot()+path.sep)) {
    throw errors.forbidden("Некорректный путь к файлу");
  }
  try {
    const buffer = await fs.readFile(absolutePath);
    return { buffer, mime: row.mime, fileName: row.file_name };
  } catch {
    throw errors.notFound("Файл не найден в хранилище");
  }
}

export async function preparedAttachment(row:AttachmentRow):Promise<PreparedMedia> {
  const absolutePath=path.resolve(storageRoot(),row.storage_key);
  if(!absolutePath.startsWith(storageRoot()+path.sep))throw errors.forbidden();
  try{return JSON.parse(await fs.readFile(absolutePath+'.frames.json','utf8')) as PreparedMedia;}catch{
    const original=await readAttachment(row);const prepared=await prepareMedia(original.buffer,original.mime);
    await fs.writeFile(absolutePath+'.frames.json',JSON.stringify(prepared),{mode:0o600});return prepared;
  }
}

export function attachmentToDto(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: Number(row.size_bytes),
    url: `${config.publicUrl}/api/v1/files/${row.id}`,
    width: row.width,
    height: row.height,
  };
}

export function attachmentConversationId(row: AttachmentRow): string {
  return idToString(row.conversation_id);
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>| -]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
