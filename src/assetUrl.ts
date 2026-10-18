/** Resolve assets copied from public/ for both a root build and a Pages build. */
export function assetUrl(path: string): string {
  let base = '/';
  try { base = import.meta.env.BASE_URL; } catch { /* Node runs the source directly in tests. */ }
  return `${base.replace(/\/?$/, '/')}${path.replace(/^\/+/, '')}`;
}
