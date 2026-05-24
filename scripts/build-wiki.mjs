import { buildWiki } from "./wiki-builder.mjs";

const result = await buildWiki({ root: process.cwd() });
console.log(`wiki data build ok: ${result.outDir}`);
