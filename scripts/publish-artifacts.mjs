import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const source = path.join(root, ".wiki-build", "published");
const worktree = path.join(root, ".wiki-published-worktree");

async function git(args, options = {}) {
	return await exec("git", args, { cwd: options.cwd ?? root });
}

async function emptyWorktree(dir) {
	for (const entry of await readdir(dir)) {
		if (entry === ".git") continue;
		await rm(path.join(dir, entry), { recursive: true, force: true });
	}
}

await rm(worktree, { recursive: true, force: true });
await git(["fetch", "origin", "published"], { cwd: root }).catch(() => undefined);
await git(["worktree", "add", "-B", "published", worktree, "origin/published"]).catch(async () => {
	await git(["worktree", "add", "-B", "published", worktree]);
});
await emptyWorktree(worktree);
await cp(source, worktree, { recursive: true });
await git(["add", "-A"], { cwd: worktree });
const diff = await git(["status", "--porcelain"], { cwd: worktree });
if (!diff.stdout.trim()) {
	console.log("published branch already up to date");
	process.exit(0);
}
await git(["config", "user.name", "omg-wiki-bot"], { cwd: worktree });
await git(["config", "user.email", "omg-wiki-bot@users.noreply.github.com"], { cwd: worktree });
await git(["commit", "-m", "Publish wiki artifacts"], { cwd: worktree });
await git(["push", "origin", "published"], { cwd: worktree });
console.log("published wiki artifacts");
