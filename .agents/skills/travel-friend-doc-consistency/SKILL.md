---
name: travel-friend-doc-consistency
description: Use when creating, updating, or reviewing Travel Friend documentation to check source-of-truth alignment, historical/current wording, and related links.
---

# Travel Friend Documentation Consistency

Use this skill for documentation consistency work. The repository's Codex task protocol remains the source for task lifecycle, scope, checks, and review handoff; this skill does not replace or repeat it.

1. Use `AGENTS.md` to identify the authoritative source for each claim. Read only the relevant code, tests, migrations, or domain-specific documents.
2. Keep implemented behavior, approved design, product intent, plans, and historical records distinct. Do not infer implementation from design documents or rewrite historical facts as current status.
3. Compare changed documents with their authoritative sources and with directly related documents. Record out-of-scope conflicts as risks instead of expanding the change.
4. Check relative Markdown links and anchors when links change or when the task requests link validation.
5. Change only the documents approved by the task. Prefer a focused correction over adding parallel summaries or duplicate source-of-truth material.
