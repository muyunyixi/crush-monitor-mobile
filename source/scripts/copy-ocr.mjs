import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';
mkdirSync('dist/ocr', {recursive: true});
copyFileSync('node_modules/tesseract.js/dist/worker.min.js', 'dist/ocr/worker.min.js');
for (const file of readdirSync('node_modules/tesseract.js-core')) {
  if (file.endsWith('.wasm.js') || file.endsWith('.wasm')) copyFileSync(`node_modules/tesseract.js-core/${file}`, `dist/ocr/${file}`);
}
for (const lang of ['chi_sim', 'eng']) copyFileSync(`node_modules/@tesseract.js-data/${lang}/4.0.0/${lang}.traineddata.gz`, `dist/ocr/${lang}.traineddata.gz`);

copyFileSync('node_modules/tesseract.js/LICENSE.md', 'dist/ocr/LICENSE-tesseract.txt');
copyFileSync('node_modules/tesseract.js-core/LICENSE', 'dist/ocr/LICENSE-core.txt');
