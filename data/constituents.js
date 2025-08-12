import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadSectors() {
  const p = path.join(__dirname, 'sectors.json');
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw);
}
