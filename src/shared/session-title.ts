export const SESSION_TITLE_LIMIT = 36;
/** Compact fallback for session names when the model omits a title. */
export function sessionTitle(text: string): string {
  const words = text
    .replace(/\$\{[^}]*\}|\b\S*\d\S*\b/g, ' ')
    .replace(
      /(?:s['’]il\s+(?:te|vous)\s+pla[îi]t|est[- ]ce que|tu peux|vous pouvez|peux[- ]tu|pouvez[- ]vous|can you|could you|please)/gi,
      ' ',
    )
    .replace(/[^\p{L}\p{M}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(
      (w) =>
        w &&
        !/^(je|j|tu|vous|veux|voudrais|souhaite|créer|creer|crée|cree|nouveau|nouvelle|un|une|le|la|les|de|des|du|d|l|à|a|au|aux|avec|pour|dans|et|en|mon|ma|mes|ce|cette|application|appli|scénario|scenario|i|want|to|create|new|an|the|with|for|in|and|app)$/i.test(
          w,
        ),
    )
    .slice(0, 5);
  let title = '';
  for (const w of words) {
    if ((title ? title.length + 1 : 0) + w.length > SESSION_TITLE_LIMIT) break;
    title += (title ? ' ' : '') + w;
  }
  return title ? title[0].toUpperCase() + title.slice(1) : 'Session';
}
