import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.resolve(__dirname, '../public/data');
const chunksDir = path.resolve(dataDir, 'chunks');

const sourceFile = path.join(dataDir, 'frames_quantized.bin');
const fallbackSource = path.join(dataDir, 'frames.bin');

let targetFile = sourceFile;
if (!fs.existsSync(sourceFile)) {
  if (fs.existsSync(fallbackSource)) {
    targetFile = fallbackSource;
  } else {
    console.error('Error: Neither frames_quantized.bin nor frames.bin was found in public/data/');
    console.error('Please run "node scripts/convert.js" first.');
    process.exit(1);
  }
}

if (!fs.existsSync(chunksDir)) {
  fs.mkdirSync(chunksDir, { recursive: true });
}

const stats = fs.statSync(targetFile);
const totalSize = stats.size;
const CHUNK_SIZE = 15 * 1024 * 1024; // 15 MB chunks (well below Cloudflare 25 MB limit)

console.log(`Chunking ${path.basename(targetFile)} (${(totalSize / 1024 / 1024).toFixed(2)} MB)...`);

const buffer = fs.readFileSync(targetFile);
const chunkFiles = [];
let offset = 0;
let index = 0;

while (offset < totalSize) {
  const end = Math.min(offset + CHUNK_SIZE, totalSize);
  const chunkBuffer = buffer.subarray(offset, end);
  const chunkFileName = `frame_chunk_${String(index).padStart(2, '0')}.bin`;
  const chunkPath = path.join(chunksDir, chunkFileName);
  
  fs.writeFileSync(chunkPath, chunkBuffer);
  chunkFiles.push({
    file: `/data/chunks/${chunkFileName}`,
    size: chunkBuffer.length,
  });
  
  console.log(`  Created ${chunkFileName}: ${(chunkBuffer.length / 1024 / 1024).toFixed(2)} MB`);
  offset = end;
  index++;
}

const manifestPath = path.join(chunksDir, 'manifest.json');
const manifest = {
  source: path.basename(targetFile),
  totalSize,
  chunkCount: chunkFiles.length,
  chunks: chunkFiles,
  generatedAt: new Date().toISOString(),
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Saved manifest.json (${chunkFiles.length} chunks). Chunking complete!`);
