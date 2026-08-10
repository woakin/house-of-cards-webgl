import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.resolve(__dirname, '../data');
const outDir = path.resolve(__dirname, '../public/data');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Find all CSVs for frames (1.csv to ...csv)
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv') && !Number.isNaN(parseInt(f.split('.')[0])));

files.sort((a, b) => {
  return parseInt(a.split('.')[0]) - parseInt(b.split('.')[0]);
});

console.log(`Found ${files.length} frame CSVs.`);
console.log('Generating Per-Frame Quantized Binary Dataset (frames_quantized.bin)...');

// Global Header: 8 bytes
// Magic 'HOCQ' (4B) + numFrames (4B)
const globalHeader = Buffer.alloc(8);
globalHeader.write('HOCQ', 0, 4, 'ascii');
globalHeader.writeUInt32LE(files.length, 4);

const outputFilePath = path.join(outDir, 'frames_quantized.bin');
const outStream = fs.createWriteStream(outputFilePath);
outStream.write(globalHeader);

let totalPoints = 0;

for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const filePath = path.join(dataDir, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  const lines = content.trim().split('\n');
  const framePoints = [];
  
  let frameMinX = Infinity, frameMaxX = -Infinity;
  let frameMinY = Infinity, frameMaxY = -Infinity;
  let frameMinZ = Infinity, frameMaxZ = -Infinity;
  
  for (let j = 0; j < lines.length; j++) {
    const line = lines[j].trim();
    if (!line) continue;
    
    const parts = line.split(',');
    if (parts.length >= 4) {
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      const z = parseFloat(parts[2]);
      const intensity = parseFloat(parts[3]);
      
      if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z) || Number.isNaN(intensity)) continue;
      
      if (x < frameMinX) frameMinX = x;
      if (x > frameMaxX) frameMaxX = x;
      if (y < frameMinY) frameMinY = y;
      if (y > frameMaxY) frameMaxY = y;
      if (z < frameMinZ) frameMinZ = z;
      if (z > frameMaxZ) frameMaxZ = z;
      
      framePoints.push(x, y, z, intensity);
    }
  }
  
  const numPoints = framePoints.length / 4;
  totalPoints += numPoints;
  
  const rangeX = frameMaxX - frameMinX || 1;
  const rangeY = frameMaxY - frameMinY || 1;
  const rangeZ = frameMaxZ - frameMinZ || 1;
  
  // Frame Header: 28 bytes
  // numPoints (4B) + frameMinX, frameMaxX, frameMinY, frameMaxY, frameMinZ, frameMaxZ (24B)
  const frameHeader = Buffer.alloc(28);
  frameHeader.writeUInt32LE(numPoints, 0);
  frameHeader.writeFloatLE(frameMinX, 4);
  frameHeader.writeFloatLE(frameMaxX, 8);
  frameHeader.writeFloatLE(frameMinY, 12);
  frameHeader.writeFloatLE(frameMaxY, 16);
  frameHeader.writeFloatLE(frameMinZ, 20);
  frameHeader.writeFloatLE(frameMaxZ, 24);
  
  // Frame Points: numPoints * 8 bytes
  const pointsBuffer = Buffer.alloc(numPoints * 8);
  
  let offset = 0;
  for (let j = 0; j < framePoints.length; j += 4) {
    const qX = Math.round(((framePoints[j] - frameMinX) / rangeX) * 65535);
    const qY = Math.round(((framePoints[j + 1] - frameMinY) / rangeY) * 65535);
    const qZ = Math.round(((framePoints[j + 2] - frameMinZ) / rangeZ) * 65535);
    const intensity = Math.min(255, Math.max(0, Math.round(framePoints[j + 3])));
    
    pointsBuffer.writeUInt16LE(Math.max(0, Math.min(65535, qX)), offset);
    pointsBuffer.writeUInt16LE(Math.max(0, Math.min(65535, qY)), offset + 2);
    pointsBuffer.writeUInt16LE(Math.max(0, Math.min(65535, qZ)), offset + 4);
    pointsBuffer.writeUInt8(intensity, offset + 6);
    pointsBuffer.writeUInt8(0, offset + 7);
    
    offset += 8;
  }
  
  outStream.write(Buffer.concat([frameHeader, pointsBuffer]));
  
  if (i % 500 === 0) {
    console.log(`Processed ${i} / ${files.length} frames...`);
  }
}

outStream.end();

outStream.on('finish', () => {
  const rawQuantizedSize = fs.statSync(outputFilePath).size;
  console.log(`Per-frame quantized binary generated: ${(rawQuantizedSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Total Points: ${totalPoints}`);
  
  console.log('Compressing with Brotli (frames_quantized.bin.br)...');
  const rawBuffer = fs.readFileSync(outputFilePath);
  const compressed = zlib.brotliCompressSync(rawBuffer, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    }
  });
  
  const compressedFilePath = path.join(outDir, 'frames_quantized.bin.br');
  fs.writeFileSync(compressedFilePath, compressed);
  const compressedSize = fs.statSync(compressedFilePath).size;
  
  console.log(`Brotli compressed binary saved: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
  console.log('Conversion complete!');
});
