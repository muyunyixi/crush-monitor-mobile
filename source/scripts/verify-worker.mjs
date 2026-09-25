// Run after deployment against the exact web and mini-program API domains.
// All probes are read-only or deliberately invalid: no WeChat login, OCR, model call, or quota reservation.
import { pathToFileURL } from 'node:url';

const WEB_ORIGIN = 'https://muyunyixi.github.io';

async function probe(base, path, options = {}, expectedStatus) {
  const response = await fetch(new URL(path, `${base.replace(/\/$/, '')}/`), {
    signal: AbortSignal.timeout(12000), ...options,
  });
  if (response.status !== expectedStatus)
    throw new Error(`${path}: expected HTTP ${expectedStatus}, received ${response.status}`);
  return response;
}

export async function verifyWorker(webBase, miniBase = webBase) {
  const webHeaders = { Origin: WEB_ORIGIN };
  const health = await probe(webBase, '/health', { headers: webHeaders }, 200);
  if ((await health.json()).service !== 'crush-monitor-api') throw new Error('web health response is not this Worker');
  const quota = await probe(webBase, '/api/quota', { headers: webHeaders }, 200);
  if (quota.headers.get('Access-Control-Allow-Origin') !== WEB_ORIGIN) throw new Error('web CORS origin mismatch');
  const webStatus = await quota.json();
  if (!Number.isInteger(webStatus.limit) || !Number.isInteger(webStatus.remaining) || webStatus.remaining < 0 || webStatus.remaining > webStatus.limit)
    throw new Error('web quota response invalid');
  await probe(webBase, '/api/quota', { headers: { Origin: 'https://untrusted.example' } }, 403);

  const post = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
  await probe(miniBase, '/api/mini/quota', post, 401);
  await probe(miniBase, '/api/mini/analyze', post, 400);
  await probe(miniBase, '/api/mini/ocr', { method: 'POST' }, 400);
  const upload = await probe(miniBase, '/api/mini/upload-check', { method: 'POST' }, 200);
  if ((await upload.json()).stage !== 'worker-reached') throw new Error('mini upload route response invalid');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , webBase, miniBase] = process.argv;
  if (!webBase) throw new Error('Usage: node scripts/verify-worker.mjs WEB_BASE [MINI_BASE]');
  await verifyWorker(webBase, miniBase);
  console.log('Web and mini-program API routing, quota configuration and legacy OCR checks passed.');
}
