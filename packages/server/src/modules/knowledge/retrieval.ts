/** Product-neutral retrieval. Product facts and links come only from stored articles. */
const STOP = new Set("как что где это для почему когда если или при без из на не но мне моя мой его их вы мы меня нужна нужен нужно есть дай дайте хочу привет пожалуйста the a an is are to of and or for how what why when my me i you it do does can could would please hello hi".split(" "));
export function normalizeSearch(text: string): string {
  return text.toLowerCase().replace(/https?:\/\/\S+/g, " ");
}
const downloadsIn = (text: string) => /скач|установ|ссыл|download|install|\blink\b/.test(text);
export function prepareKnowledgeSearch(text: string, history: Array<{role: string; text: string}> = [], _channelName = "") {
  const current = normalizeSearch(text);
  const previous = history.filter(item => item.role === "user").slice(-3).map(item => normalizeSearch(item.text));
  const shortFollowup = current.trim().split(/\s+/).length <= 6;
  const download = downloadsIn(current) || (shortFollowup && previous.some(downloadsIn));
  const words = current.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/)
    .filter(word => word.length >= 3 && !STOP.has(word));
  const keywords = [...new Set([...words, ...(download ? ["download", "install", "установ", "ссыл"] : [])])].slice(0, 16);
  return { keywords, download };
}
export function rankDownloadArticles<T extends {id: string; title: string; body: string; score: number}>(
  articles: T[], search: ReturnType<typeof prepareKnowledgeSearch>,
): T[] {
  if (!search.download) return articles;
  return articles.map(article => {
    const title = normalizeSearch(article.title);
    const installation = downloadsIn(title) && /https?:\/\//.test(article.body);
    const matches = search.keywords.filter(word => title.includes(word)).length;
    return { ...article, score: Math.log1p(Math.max(0, article.score)) + (installation ? 40 : 0) + matches * 5 };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}