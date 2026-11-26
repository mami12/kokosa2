/**
 * The provider's dictionary includes template variables that only acquire a
 * value on a specific quote. They remain unchanged in the native policy key;
 * this formatter is only for the administrator's readable catalog label.
 */
const decodeNumericHtml = (value: string): string => value.replace(/&#(?:x([\da-f]+)|(\d+));?/gi, (match, hex, decimal) => {
  const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
  return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : match;
});

export function adminMarketCatalogTitle(rawName: string): string {
  const decoded = decodeNumericHtml(String(rawName ?? '')).trim();
  const scope = decoded.match(/^\[\s*(live|prematch|pre-match)\s*\]\s*/i)?.[1];
  const raw = decoded.replace(/^\[\s*(?:live|prematch|pre-match)\s*\]\s*/i, '').trim();
  const normalized = raw.replace(/\s+/g, ' ').trim();
  let title: string;

  if (/^\{p1_r\}\s+set\s*-\s*\{p2_r\}\s+aces?$/i.test(normalized)) {
    title = 'Set range — Aces';
  } else if (/^\{p1_r\}\s+set\s*-\s*game\s+\{p2_r\}\s*-\s*aces?$/i.test(normalized)) {
    title = 'Set game range — Aces';
  } else if (/^\{p1_r\}\s*-\s*frame\s*-\s*any player with a break 50\+$/i.test(normalized)) {
    title = 'Frame — Any player to make a break of 50+';
  } else if (/^\{p1_r\}\s+day session\s+\{p2_r\}\s*-\s*total$/i.test(normalized)) {
    title = 'Day session range — Total';
  } else {
    title = normalized
      .replace(/\{p1_r\}|\{p2_r\}/gi, 'range')
      .replace(/\{p1\}/gi, 'first value')
      .replace(/\{p2\}/gi, 'second value')
      .replace(/\{pl\}/gi, 'player')
      .replace(/\{score\}/gi, 'score')
      .replace(/\{window\}/gi, 'time range')
      .replace(/\{number\}/gi, 'number')
      .replace(/\{[^}]+\}/g, 'value');
  }

  const scopeLabel = /^live$/i.test(scope ?? '') ? 'Live' : /pre/i.test(scope ?? '') ? 'Pre-match' : '';
  return scopeLabel ? `${scopeLabel} · ${title}` : title;
}
