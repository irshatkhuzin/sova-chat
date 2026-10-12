/**
 * База знаний продукта: статьи и FAQ + поиск релевантных фрагментов для ИИ.
 *
 * Первая версия использует полнотекстовый поиск MySQL с запасным вариантом
 * LIKE-поиска по ключевым словам. Векторный поиск можно добавить позже,
 * не меняя интерфейс findRelevantArticles.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { KnowledgeArticleDto } from "@sova/shared";
import { dateToIso, execute, idToString, query, queryOne, withTransaction } from "../../infra/db.js";
import { errors } from "../../infra/errors.js";
import { prepareKnowledgeSearch, rankDownloadArticles } from "./retrieval.js";

interface ArticleRow extends RowDataPacket {
  id: string;
  product_id: string;
  title: string;
  body: string;
  kind: "article" | "faq";
  lang: string;
  tags: string | null;
  is_published: number;
  created_at: Date;
  updated_at: Date;
}

function toDto(row: ArticleRow): KnowledgeArticleDto {
  return {
    id: idToString(row.id),
    productId: idToString(row.product_id),
    title: row.title,
    body: row.body,
    kind: row.kind,
    lang: row.lang,
    tags: (row.tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    isPublished: row.is_published === 1,
    createdAt: dateToIso(row.created_at) ?? "",
    updatedAt: dateToIso(row.updated_at) ?? "",
  };
}

export async function listArticles(
  productId: string,
  options: { search?: string } = {},
): Promise<KnowledgeArticleDto[]> {
  if (options.search && options.search.trim()) {
    const like = `%${options.search.trim()}%`;
    const rows = await query<ArticleRow>(
      `SELECT * FROM sova_knowledge_articles
        WHERE product_id = ? AND (title LIKE ? OR body LIKE ? OR tags LIKE ?)
        ORDER BY updated_at DESC LIMIT 200`,
      [productId, like, like, like],
    );
    return rows.map(toDto);
  }
  const rows = await query<ArticleRow>(
    "SELECT * FROM sova_knowledge_articles WHERE product_id = ? ORDER BY updated_at DESC LIMIT 500",
    [productId],
  );
  return rows.map(toDto);
}

export async function getArticle(id: string): Promise<KnowledgeArticleDto> {
  const row = await queryOne<ArticleRow>(
    "SELECT * FROM sova_knowledge_articles WHERE id = ? LIMIT 1",
    [id],
  );
  if (!row) throw errors.notFound("Статья не найдена");
  return toDto(row);
}

export interface ArticleInput {
  productId: string;
  title: string;
  body: string;
  kind?: "article" | "faq";
  lang?: string;
  tags?: string[];
  isPublished?: boolean;
}

export async function createArticle(input: ArticleInput): Promise<KnowledgeArticleDto> {
  const res = await execute(
    `INSERT INTO sova_knowledge_articles (product_id, title, body, kind, lang, tags, is_published)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.productId,
      input.title,
      input.body,
      input.kind ?? "article",
      input.lang ?? "ru",
      (input.tags ?? []).join(","),
      input.isPublished === false ? 0 : 1,
    ],
  );
  return getArticle(String(res.insertId));
}

export async function updateArticle(
  id: string,
  input: Partial<Omit<ArticleInput, "productId">>,
): Promise<KnowledgeArticleDto> {
  await withTransaction(async conn => {
  const [rows] = await conn.query<ArticleRow[]>("SELECT * FROM sova_knowledge_articles WHERE id=? FOR UPDATE", [id]);
  if (!rows[0]) throw errors.notFound("Статья не найдена");
  const current = toDto(rows[0]);
  await conn.execute("INSERT INTO sova_knowledge_versions (article_id,snapshot,reason) VALUES (?,?,?)", [id,JSON.stringify(rows[0]),"До ручного редактирования"]);
  await conn.execute(
    `UPDATE sova_knowledge_articles
        SET title = ?, body = ?, kind = ?, lang = ?, tags = ?, is_published = ?
      WHERE id = ?`,
    [
      input.title ?? current.title,
      input.body ?? current.body,
      input.kind ?? current.kind,
      input.lang ?? current.lang,
      (input.tags ?? current.tags).join(","),
      (input.isPublished ?? current.isPublished) ? 1 : 0,
      id,
    ],
  );
  });
  return getArticle(id);
}

export async function deleteArticle(id: string): Promise<void> {
  await execute("DELETE FROM sova_knowledge_articles WHERE id = ?", [id]);
}

export interface RelevantArticle {
  id: string;
  title: string;
  body: string;
  score: number;
}

/** Published articles are fetched afresh every turn, scoped to the Sova product. */
export async function findRelevantArticles(
  productId: string,
  text: string,
  limit = 4,
  history: Array<{role: string; text: string}> = [],
  channelName = '',
): Promise<RelevantArticle[]> {
  const search = prepareKnowledgeSearch(text, history, channelName);
  const { keywords } = search;
  if (!keywords.length) return [];
  const resultLimit = Math.min(Math.max(limit, 1), 10);
  const candidateLimit = search.download ? 40 : resultLimit;
  const booleanQuery = keywords.map(w => `${w}*`).join(' ');
  let rows: RowDataPacket[] = [];
  try {
    rows = await query<RowDataPacket>(
      `SELECT id,title,body,MATCH(title,body,tags) AGAINST (? IN BOOLEAN MODE) AS score
       FROM sova_knowledge_articles WHERE product_id=? AND is_published=1
       AND MATCH(title,body,tags) AGAINST (? IN BOOLEAN MODE)
       ORDER BY score DESC LIMIT ${candidateLimit}`,
      [booleanQuery,productId,booleanQuery],
    );
  } catch { /* Fall back when a FULLTEXT index is unavailable. */ }
  if (!rows.length) {
    const params: unknown[] = [productId];
    const conditions = keywords.map(word => {
      params.push(`%${word}%`,`%${word}%`,`%${word}%`);
      return '(title LIKE ? OR body LIKE ? OR tags LIKE ?)';
    }).join(' OR ');
    rows = await query<RowDataPacket>(
      `SELECT id,title,body,0 AS score FROM sova_knowledge_articles
       WHERE product_id=? AND is_published=1 AND (${conditions})
       ORDER BY updated_at DESC LIMIT ${candidateLimit}`,params,
    );
  }
  if (search.download) {
    // Always consider published installation articles, even when general articles dominate FULLTEXT.
    const links = await query<RowDataPacket>(
      `SELECT id,title,body,0 AS score FROM sova_knowledge_articles
       WHERE product_id=? AND is_published=1 AND body LIKE '%http%'
       AND (title LIKE '%ссыл%' OR title LIKE '%установ%' OR title LIKE '%download%' OR title LIKE '%install%')
       ORDER BY updated_at DESC LIMIT 40`,[productId],
    );
    const ids = new Set(rows.map(r => idToString(r.id)));
    rows.push(...links.filter(r => !ids.has(idToString(r.id))));
  }
  const articles = rows.map(row => ({id:idToString(row.id),title:String(row.title),body:String(row.body),score:Number(row.score??0)}));
  return rankDownloadArticles(articles,search).slice(0,resultLimit);
}
/** Small owner-approved templates: fetched every turn so foreign-language requests need no keyword match. */
export async function findInstallationTemplates(productId:string):Promise<RelevantArticle[]> {
  const rows=await query<RowDataPacket>(`SELECT id,title,body FROM sova_knowledge_articles
    WHERE product_id=? AND is_published=1 AND FIND_IN_SET('sova:installation-template',tags)>0
    ORDER BY id LIMIT 3`,[productId]);
  return rows.map(r=>({id:idToString(r.id),title:String(r.title),body:String(r.body),score:0}));
}

export async function countArticles(productId: string): Promise<number> {
  const row = await queryOne<RowDataPacket>(
    "SELECT COUNT(*) AS total FROM sova_knowledge_articles WHERE product_id = ? AND is_published = 1",
    [productId],
  );
  return Number(row?.total ?? 0);
}
