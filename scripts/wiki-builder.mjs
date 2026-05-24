import crypto from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const OWNER = "StevenBuglione";

function posixPath(value) {
	return value.split(path.sep).join("/");
}

function slugify(value) {
	return value
		.toLowerCase()
		.replace(/`([^`]+)`/g, "$1")
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function parseScalar(value) {
	const trimmed = value.trim();
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (/^\d+$/.test(trimmed)) return Number(trimmed);
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		return trimmed
			.slice(1, -1)
			.split(",")
			.map(item => item.trim().replace(/^['"]|['"]$/g, ""))
			.filter(Boolean);
	}
	return trimmed;
}

function parseFrontmatter(markdown) {
	if (!markdown.startsWith("---\n")) return { data: {}, content: markdown };
	const end = markdown.indexOf("\n---", 4);
	if (end === -1) return { data: {}, content: markdown };
	const raw = markdown.slice(4, end).replace(/\r/g, "");
	const content = markdown.slice(markdown.indexOf("\n", end + 4) + 1);
	const data = {};
	let currentKey = "";
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		const list = line.match(/^\s+-\s+(.*)$/);
		if (list && currentKey) {
			if (!Array.isArray(data[currentKey])) data[currentKey] = [];
			data[currentKey].push(parseScalar(list[1]));
			continue;
		}
		const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!match) throw new Error(`invalid frontmatter line: ${line}`);
		currentKey = match[1];
		data[currentKey] = match[2] ? parseScalar(match[2]) : [];
	}
	return { data, content };
}

async function listMarkdown(root) {
	const files = [];
	async function walk(dir) {
		for (const entry of await readdir(dir)) {
			const full = path.join(dir, entry);
			const details = await stat(full);
			if (details.isDirectory()) await walk(full);
			if (details.isFile() && entry.endsWith(".md")) files.push(full);
		}
	}
	await walk(root);
	return files.sort();
}

function extractHeadings(markdown) {
	const seen = new Map();
	const headings = [];
	for (const line of markdown.split(/\r?\n/)) {
		const match = line.match(/^(#{1,6})\s+(.+)$/);
		if (!match) continue;
		const text = match[2].replace(/\s+#*$/, "").trim();
		const base = slugify(text) || "heading";
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		headings.push({
			depth: match[1].length,
			text,
			anchor: count ? `${base}-${count}` : base,
		});
	}
	return headings;
}

function markdownText(markdown) {
	return markdown
		.replace(/^---[\s\S]*?---\s*/m, "")
		.replace(/```[\s\S]*?```/g, "")
		.replace(/!\[[^\]]*\]\([^)]+\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/[#>*_`~-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function checksum(value) {
	return `sha256-${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function extractMarkdownLinks(markdown) {
	const links = [];
	const pattern = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
	for (const match of markdown.matchAll(pattern)) {
		const target = match[3].trim();
		if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
		links.push({ image: Boolean(match[1]), text: match[2], target });
	}
	return links;
}

function resolvePageSlug(fromFile, target) {
	const withoutHash = target.split("#")[0];
	const joined = posixPath(path.normalize(path.join(path.posix.dirname(fromFile), withoutHash)));
	return joined.replace(/\.md$/, "").replace(/^docs\//, "");
}

async function gitCommit(root) {
	try {
		const result = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
		return result.stdout.trim();
	} catch {
		return "local";
	}
}

async function loadPages(root, sourceConfig) {
	const docsRoot = path.join(root, sourceConfig.contentRoot);
	const markdownFiles = await listMarkdown(docsRoot);
	const pages = [];
	const errors = [];
	const warnings = [];
	for (const absolute of markdownFiles) {
		const relative = posixPath(path.relative(docsRoot, absolute));
		const raw = await readFile(absolute, "utf8");
		let parsed;
		try {
			parsed = parseFrontmatter(raw);
		} catch (error) {
			errors.push(`${relative}: ${error.message}`);
			continue;
		}
		const slug = relative.replace(/\.md$/, "");
		const pageId = `${sourceConfig.id}:${slug}`;
		const headings = extractHeadings(parsed.content);
		if (!parsed.data.title) errors.push(`${relative}: missing title`);
		if (!/^#\s+/m.test(parsed.content)) errors.push(`${relative}: missing H1`);
		if (/<(script|iframe|object|embed|style)\b/i.test(parsed.content) || /\son[a-z]+\s*=/i.test(parsed.content)) {
			errors.push(`${relative}: unsafe raw HTML`);
		}
		if (!parsed.data.review_status) warnings.push(`${relative}: missing review_status`);
		if (!parsed.data.last_verified) warnings.push(`${relative}: missing last_verified`);
		const tags = Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [];
		pages.push({
			id: pageId,
			sourceId: sourceConfig.id,
			title: String(parsed.data.title ?? slug),
			description: String(parsed.data.description ?? ""),
			slug,
			file: relative,
			tags,
			facets: {
				area: String(parsed.data.area ?? "general"),
				status: String(parsed.data.status ?? "draft"),
				difficulty: String(parsed.data.difficulty ?? "beginner"),
			},
			review: {
				review_status: String(parsed.data.review_status ?? "ai_draft"),
				human_reviewed: Boolean(parsed.data.human_reviewed ?? false),
				last_verified: String(parsed.data.last_verified ?? ""),
				confidence: String(parsed.data.confidence ?? "medium"),
			},
			aliases: Array.isArray(parsed.data.aliases) ? parsed.data.aliases.map(String) : [],
			updatedAt: new Date().toISOString(),
			editUrl: `${sourceConfig.editBaseUrl}/${relative}`,
			headings,
			_markdown: parsed.content,
			_links: extractMarkdownLinks(parsed.content),
		});
	}
	return { pages, errors, warnings };
}

function validatePages(sourceConfig, pages, errors) {
	const slugs = new Set();
	const aliases = new Set();
	const files = new Set(pages.map(page => page.file));
	for (const page of pages) {
		if (slugs.has(page.slug)) errors.push(`${page.file}: duplicate slug ${page.slug}`);
		slugs.add(page.slug);
		for (const alias of page.aliases) {
			if (aliases.has(alias)) errors.push(`${page.file}: duplicate alias ${alias}`);
			aliases.add(alias);
		}
		for (const link of page._links) {
			const target = link.target.split("#")[0];
			if (link.image) continue;
			if (target.endsWith(".md")) {
				const resolvedSlug = resolvePageSlug(page.file, target);
				if (!files.has(`${resolvedSlug}.md`)) errors.push(`${page.file}: broken internal link ${link.target}`);
			}
		}
		for (const [facet, allowed] of Object.entries(sourceConfig.facets ?? {})) {
			const value = page.facets[facet];
			if (value && Array.isArray(allowed) && !allowed.includes(value)) {
				errors.push(`${page.file}: invalid ${facet} facet ${value}`);
			}
		}
	}
}

function sidebarFromPages(sourceConfig, pages) {
	return [
		{
			type: "category",
			label: sourceConfig.label,
			items: pages.map(page => page.id),
		},
	];
}

function buildGraph(pages) {
	const pageByFile = new Map(pages.map(page => [page.file, page]));
	const links = [];
	const backlinks = {};
	for (const page of pages) {
		for (const link of page._links) {
			if (link.image || !link.target.endsWith(".md")) continue;
			const targetSlug = resolvePageSlug(page.file, link.target);
			const target = pageByFile.get(`${targetSlug}.md`);
			if (!target) continue;
			const item = { from: page.id, to: target.id, text: link.text };
			links.push(item);
			backlinks[target.id] ??= [];
			backlinks[target.id].push({ from: page.id, text: link.text });
		}
	}
	return { links, backlinks };
}

function chunkPages(sourceConfig, sourceCommit, pages) {
	return pages.map(page => {
		const text = markdownText(page._markdown);
		return {
			chunkId: `${page.id}#page`,
			pageId: page.id,
			sourceId: sourceConfig.id,
			title: page.title,
			headingPath: [page.title],
			slug: page.slug,
			url: `/wiki/?s=${sourceConfig.id}&p=${page.slug}`,
			tags: page.tags,
			facets: page.facets,
			review: page.review,
			text,
			tokenCount: Math.ceil(text.length / 4),
			updatedAt: page.updatedAt,
			sourceCommit,
			checksum: checksum(text),
		};
	});
}

function publicPage(page) {
	const { _markdown, _links, ...clean } = page;
	return clean;
}

export async function validateWiki({ root }) {
	const errors = [];
	const warnings = [];
	let sourceConfig;
	try {
		sourceConfig = JSON.parse(await readFile(path.join(root, "wiki.source.json"), "utf8"));
	} catch {
		return { ok: false, errors: ["invalid wiki.source.json"], warnings, pages: [] };
	}
	for (const field of ["schemaVersion", "id", "label", "contentRoot", "assetsRoot", "defaultPage", "repoUrl", "editBaseUrl"]) {
		if (!sourceConfig[field]) errors.push(`wiki.source.json: missing ${field}`);
	}
	if (!/^wiki-data-[a-z0-9-]+$/.test(path.basename(root))) warnings.push("repository name should be wiki-data-<source>");
	const loaded = await loadPages(root, sourceConfig);
	errors.push(...loaded.errors);
	warnings.push(...loaded.warnings);
	validatePages(sourceConfig, loaded.pages, errors);
	return { ok: errors.length === 0, errors, warnings, pages: loaded.pages, sourceConfig };
}

export async function buildWiki({ root }) {
	const validation = await validateWiki({ root });
	if (!validation.ok) throw new Error(`wiki validation failed:\n${validation.errors.join("\n")}`);
	const { sourceConfig } = validation;
	const sourceCommit = await gitCommit(root);
	const generatedAt = new Date().toISOString();
	const repo = path.basename(root);
	const artifactBaseUrl = `https://cdn.jsdelivr.net/gh/${OWNER}/${repo}@published/dist/${sourceCommit}/`;
	const contentBaseUrl = `https://cdn.jsdelivr.net/gh/${OWNER}/${repo}@${sourceCommit}/${sourceConfig.contentRoot}/`;
	const assetsBaseUrl = `https://cdn.jsdelivr.net/gh/${OWNER}/${repo}@${sourceCommit}/${sourceConfig.assetsRoot}/`;
	const pages = validation.pages;
	const publicPages = pages.map(publicPage);
	const graph = buildGraph(pages);
	const chunks = chunkPages(sourceConfig, sourceCommit, pages);
	const tagMap = new Map();
	for (const page of pages) {
		for (const tag of page.tags) {
			tagMap.set(tag, [...(tagMap.get(tag) ?? []), page.id]);
		}
	}
	const latest = {
		schemaVersion: "steve-wiki-latest/v1",
		sourceId: sourceConfig.id,
		sourceCommit,
		generatedAt,
		artifactBaseUrl,
		manifestUrl: `${artifactBaseUrl}wiki-manifest.json`,
		catalogUrl: `${artifactBaseUrl}wiki-catalog.json`,
		tagsUrl: `${artifactBaseUrl}wiki-tags.json`,
		graphUrl: `${artifactBaseUrl}wiki-graph.json`,
		healthUrl: `${artifactBaseUrl}wiki-health.json`,
		pagefindBundleUrl: `${artifactBaseUrl}pagefind/`,
		agentManifestUrl: `${artifactBaseUrl}agent/agent-manifest.json`,
		contentBaseUrl,
		assetsBaseUrl,
	};
	const manifest = {
		schemaVersion: "steve-wiki-manifest/v1",
		source: { id: sourceConfig.id, label: sourceConfig.label, sourceCommit },
		contentBaseUrl,
		assetsBaseUrl,
		pages: publicPages,
		sidebar: sidebarFromPages(sourceConfig, publicPages),
	};
	const catalog = {
		schemaVersion: "steve-wiki-catalog/v1",
		source: { id: sourceConfig.id, label: sourceConfig.label, description: sourceConfig.description },
		counts: { pages: pages.length, tags: tagMap.size, assets: 0 },
		topLevelNavigation: publicPages.map(page => ({ label: page.title, slug: page.slug, count: 1 })),
		recentlyUpdated: publicPages.map(page => ({ pageId: page.id, title: page.title, updatedAt: page.updatedAt })),
	};
	const tags = {
		schemaVersion: "steve-wiki-tags/v1",
		sourceId: sourceConfig.id,
		tags: [...tagMap.entries()].sort().map(([tag, ids]) => ({ tag, count: ids.length, pages: ids })),
	};
	const health = {
		schemaVersion: "steve-wiki-health/v1",
		sourceId: sourceConfig.id,
		status: validation.warnings.length ? "warning" : "ok",
		summary: {
			pages: pages.length,
			brokenInternalLinks: 0,
			missingTitles: 0,
			duplicateSlugs: 0,
			orphanPages: 0,
			largeAssets: 0,
			aiDrafts: pages.filter(page => page.review.review_status === "ai_draft").length,
			stalePages: 0,
		},
		issues: validation.warnings.map(message => ({ severity: "warning", type: "content-warning", message })),
	};
	const agentManifest = {
		schemaVersion: "steve-wiki-agent-manifest/v1",
		sourceId: sourceConfig.id,
		sourceCommit,
		generatedAt,
		catalogUrl: `${artifactBaseUrl}agent/agent-catalog.json`,
		chunksIndexUrl: `${artifactBaseUrl}agent/agent-chunks.index.json`,
		llmsSourceUrl: `${artifactBaseUrl}agent/llms-source.txt`,
		capabilities: ["search", "get_page", "get_section", "context_pack"],
	};
	const agentCatalog = {
		schemaVersion: "steve-wiki-agent-catalog/v1",
		source: catalog.source,
		pages: publicPages.map(page => ({
			id: page.id,
			title: page.title,
			slug: page.slug,
			tags: page.tags,
			review: page.review,
		})),
	};
	const chunksIndex = {
		schemaVersion: "steve-wiki-agent-chunks-index/v1",
		sourceId: sourceConfig.id,
		sourceCommit,
		shards: [{ path: "chunks/chunks-0001.jsonl", count: chunks.length }],
	};
	const latestAgent = {
		schemaVersion: "steve-wiki-latest-agent/v1",
		sourceId: sourceConfig.id,
		sourceCommit,
		generatedAt,
		agentManifestUrl: latest.agentManifestUrl,
		chunksIndexUrl: agentManifest.chunksIndexUrl,
		llmsSourceUrl: agentManifest.llmsSourceUrl,
	};
	const outDir = path.join(root, ".wiki-build", "published");
	const dist = path.join(outDir, "dist", sourceCommit);
	await rm(outDir, { recursive: true, force: true });
	await mkdir(path.join(dist, "agent", "chunks"), { recursive: true });
	await mkdir(path.join(dist, "pagefind"), { recursive: true });
	const writeJson = async (target, value) => writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
	await writeJson(path.join(outDir, "latest.json"), latest);
	await writeJson(path.join(outDir, "latest-agent.json"), latestAgent);
	await writeJson(path.join(dist, "wiki-manifest.json"), manifest);
	await writeJson(path.join(dist, "wiki-catalog.json"), catalog);
	await writeJson(path.join(dist, "wiki-tags.json"), tags);
	await writeJson(path.join(dist, "wiki-graph.json"), { schemaVersion: "steve-wiki-graph/v1", sourceId: sourceConfig.id, ...graph });
	await writeJson(path.join(dist, "wiki-health.json"), health);
	await writeJson(path.join(dist, "agent", "agent-manifest.json"), agentManifest);
	await writeJson(path.join(dist, "agent", "agent-catalog.json"), agentCatalog);
	await writeJson(path.join(dist, "agent", "agent-chunks.index.json"), chunksIndex);
	await writeFile(path.join(dist, "agent", "chunks", "chunks-0001.jsonl"), `${chunks.map(chunk => JSON.stringify(chunk)).join("\n")}\n`);
	await writeFile(
		path.join(dist, "agent", "llms-source.txt"),
		[`# ${sourceConfig.label}`, "", `> ${sourceConfig.description}`, "", "## Pages", ...publicPages.map(page => `- [${page.title}](/wiki/?s=${sourceConfig.id}&p=${page.slug})`), ""].join("\n"),
	);
	await writeJson(path.join(dist, "pagefind", "pagefind-entry.json"), {
		schemaVersion: "steve-wiki-pagefind-ready/v1",
		sourceId: sourceConfig.id,
		note: "Pagefind-ready metadata placeholder for V1; full index generation is wired next.",
		pages: publicPages.map(page => ({ id: page.id, title: page.title, filters: { source: sourceConfig.id, ...page.facets, tags: page.tags } })),
	});
	return { outDir, sourceCommit };
}
