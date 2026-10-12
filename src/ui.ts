// A few lines instead of a UI library: elements with attributes, handlers and children.

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | boolean | number | ((e: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(name.replace(/^on/, ""), value as EventListener);
    else if (name === "hidden") el.hidden = Boolean(value);
    else if (value === true) el.setAttribute(name, "");
    else el.setAttribute(name, String(value));
  }
  for (const child of children) if (child) el.append(child);
  return el;
}
