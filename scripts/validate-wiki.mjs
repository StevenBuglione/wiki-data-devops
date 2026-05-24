import { validateWiki } from "./wiki-builder.mjs";

const result = await validateWiki({ root: process.cwd() });
if (!result.ok) {
	for (const error of result.errors) console.error(error);
	process.exit(1);
}
for (const warning of result.warnings) console.warn(warning);
console.log(`wiki data validation ok (${result.pages.length} page(s))`);
