import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDataDir = path.resolve(__dirname, '../dist/data');

if (fs.existsSync(distDataDir)) {
  const files = fs.readdirSync(distDataDir);
  for (const file of files) {
    const filePath = path.join(distDataDir, file);
    if (fs.statSync(filePath).isFile() && (file.endsWith('.bin') || file.endsWith('.br'))) {
      fs.unlinkSync(filePath);
      console.log(`Cleaned unchunked binary from dist: ${file}`);
    }
  }
}
