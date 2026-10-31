// Bundled public lookbook; live catalogue fields override matching item codes.
async function loadCatalogue(sheetUrl) {
  const baseResponse = await fetch('/catalogue.json');
  if (!baseResponse.ok) throw new Error('Catalogue unavailable');
  const base = await baseResponse.json();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(sheetUrl, { signal: controller.signal });
    if (!response.ok) return base;
    const live = await response.json();
    if (!Array.isArray(live)) return base;
    const byCode = new Map(live.filter(x => x && typeof x.code === 'string').map(x => [x.code, x]));
    const merged = base.map(item => {
      const update = byCode.get(item.code);
      if (!update) return item;
      byCode.delete(item.code);
      const next = { ...item };
      for (const key of ['name', 'description', 'occasions', 'sizes', 'status']) {
        if (typeof update[key] === 'string' && update[key].trim()) next[key] = update[key];
      }
      return next;
    });
    // Unbundled rows need a valid image folder to be shown.
    return merged.concat([...byCode.values()].filter(x => /^[a-z0-9-]{1,100}$/.test(x.folder || '')));
  } catch { return base; }
  finally { clearTimeout(timer); }
}
