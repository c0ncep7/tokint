export function renderJson(target: HTMLElement, text: string) {
  // Tokenize JSON, then insert text nodes only. Metadata is never HTML.
  const tokens = /"(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const fragment = document.createDocumentFragment();
  let offset = 0;
  let count = 0;
  for (const match of text.matchAll(tokens)) {
    // Bound DOM size for very large metadata; the remainder stays readable JSON.
    if (++count > 12000) break;
    fragment.append(document.createTextNode(text.slice(offset, match.index)));
    const token = match[0];
    const span = document.createElement('span');
    span.className = 'json-' + (token.startsWith('"') ? (token.endsWith(':') ? 'key' : 'string') : token === 'null' ? 'null' : /^(true|false)$/.test(token) ? 'boolean' : 'number');
    span.textContent = token;
    fragment.append(span);
    offset = match.index! + token.length;
  }
  fragment.append(document.createTextNode(text.slice(offset)));
  target.replaceChildren(fragment);
}
