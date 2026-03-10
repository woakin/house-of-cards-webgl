import fs from 'fs';
import path from 'path';
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

const outStream = fs.createWriteStream(path.join(outDir, 'frames.bin'));

// Write number of frames (uint32)
const header = Buffer.alloc(4);
header.writeUInt32LE(files.length, 0);
outStream.write(header);

let totalPoints = 0;

for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const filePath = path.join(dataDir, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  const lines = content.trim().split('\n');
  const numPoints = lines.length;
  totalPoints += numPoints;
  
  // Create buffer for this frame
  // 4 bytes for numPoints + (16 bytes per point)
  const frameBuffer = Buffer.alloc(4 + numPoints * 16);
  frameBuffer.writeUInt32LE(numPoints, 0);
  
  let offset = 4;
  for (let j = 0; j < numPoints; j++) {
    const line = lines[j].trim();
    if (!line) continue;
    
    const parts = line.split(',');
    if (parts.length >= 4) {
      frameBuffer.writeFloatLE(parseFloat(parts[0]), offset);
      frameBuffer.writeFloatLE(parseFloat(parts[1]), offset + 4);
      frameBuffer.writeFloatLE(parseFloat(parts[2]), offset + 8);
      frameBuffer.writeFloatLE(parseFloat(parts[3]), offset + 12);
      offset += 16;
    }
  }
  
  outStream.write(frameBuffer.slice(0, offset));
  
  if (i % 100 === 0) {
    console.log(`Processed ${i} / ${files.length} frames...`);
  }
}

outStream.end();
console.log(`Finished converting ${files.length} frames with a total of ${totalPoints} points.`);
console.log(`Output saved to ${path.join(outDir, 'frames.bin')}`);
