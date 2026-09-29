// Crea elementos sin innerHTML (compatible con la CSP y sin riesgo de inyección).
// Las props que empiezan por `on` se registran como listeners; `class` va a className.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el[k] = v;
  }
  for (const c of children.flat(Infinity)) {
    if (c !== null && c !== undefined && c !== false) el.append(c);
  }
  return el;
}
