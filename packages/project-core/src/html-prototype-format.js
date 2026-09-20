const SCRIPT_BLOCK_PATTERN = /<script\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/script>/gi;

export function extractEmbeddedScript(source, scriptId) {
  const expectedId = String(scriptId || '').trim();
  if (!expectedId) return null;
  const html = String(source || '');
  const pattern = new RegExp(SCRIPT_BLOCK_PATTERN.source, 'gi');
  let match = pattern.exec(html);
  while (match) {
    if (match[1] === expectedId) return match[2];
    match = pattern.exec(html);
  }
  return null;
}

export function readPrototypeManifest(source) {
  const content = extractEmbeddedScript(source, 'prototype-page-manifest');
  if (content === null) return null;
  try {
    const manifest = JSON.parse(content.trim());
    return manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

export function isTemplatePrototypeHtml(source) {
  return readPrototypeManifest(source)?.templateVersion === 1;
}

export function isHtmlPrototypeContentSource(source) {
  return isTemplatePrototypeHtml(source);
}
