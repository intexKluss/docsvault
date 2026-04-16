// Wandelt einen freien Namen in einen MCP-kompatiblen Tool-Prefix.
// Regeln: lowercase, non-[a-z0-9] zu _, mehrfache _ zu einem, trim leading/trailing _.
export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
