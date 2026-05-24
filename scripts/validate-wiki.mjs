import { readFileSync } from 'node:fs';
JSON.parse(readFileSync('wiki.source.json', 'utf8'));
JSON.parse(readFileSync('package.json', 'utf8'));
console.log('wiki data validation ok');
