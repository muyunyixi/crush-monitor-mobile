import { readFileSync, writeFileSync, rmSync } from 'node:fs';
// A self-contained production entry works both on Pages and when opened locally.
let html = readFileSync('dist/index.html', 'utf8');
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, path) => {
  const js = readFileSync(`dist/${path.replace(/^\.\//, '')}`, 'utf8');
  return `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, path) => `<style>${readFileSync(`dist/${path.replace(/^\.\//, '')}`, 'utf8')}</style>`);
writeFileSync('dist/index.html', html);
writeFileSync('dist/.nojekyll', '');
writeFileSync('dist/LICENSE', readFileSync('LICENSE'));
rmSync('dist/assets', {recursive: true, force: true});
