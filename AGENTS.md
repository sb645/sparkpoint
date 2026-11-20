# AGENTS.md — Four-Person Hackathon Collaboration Rules

> This repository (`https://github.com/sb645/sparkpoint`) is a **4-person team workspace** for **CrossPointX 2026 Hackathon** (Nov 21–22, 2026; **submission deadline: Nov 22 13:00 CST**, internal code freeze: **11:00 CST**).
> All four teammates use AI coding agents in parallel. **Every agent working in this repository MUST follow these rules strictly.**

---

## 1. First-Step Context Check (Before Writing Any Code)

Before making edits in a new session:
1. Read `docs/TEAM_PLAN.md` to confirm:
   - Who your human user is, their assigned role, and their owned directory.
   - The locked MVP scope, non-goals, and agreed API/data contracts.
2. Run `git status` and `git branch --show-current` to verify which branch you are on.
3. If your human user has not yet been recorded in `docs/TEAM_PLAN.md`, ask them which role/directory they own before touching shared files.

---

## 2. Git & GitHub Workflow Rules (Hard Guardrails)

### Branching
- **`main` is protected by convention and MUST always stay runnable.**
- **NEVER commit or push directly to `main`** unless your user is explicitly performing an integration merge after verifying everything builds and runs.
- Each teammate/agent works on a dedicated branch created from latest `origin/main`:
  - Naming: `feat/<owner>-<short-topic>` or `fix/<owner>-<short-topic>` (e.g. `feat/alice-ui`, `feat/bob-api`).
- **Sync frequently (every 2–3 hours)**:
  ```bash
  git fetch origin
  git merge origin/main
  ```
  Prefer `git merge origin/main` over `git rebase` to avoid history rewrites and beginner Git traps.

### Strictly Forbidden Git Actions
- **NEVER** run `git push --force` or `git push --force-with-lease` on `main` (or any shared branch).
- **NEVER** run destructive commands like `git reset --hard`, `git clean -fd`, or delete another teammate's branch without explicit user confirmation.
- **NEVER** resolve merge conflicts in another teammate's owned directory by silently discarding their changes—stop, show the conflict to the user, and confirm.

### Commits & Pull Requests
- Make small, focused commits with clear prefixes: `feat:`, `fix:`, `docs:`, `chore:`.
- Before pushing or opening a PR to `main`, verify:
  1. Only intended files are staged (`git status`, `git diff --cached`).
  2. No secrets, `.env` files, or build artifacts/dependencies are included.
  3. The module you touched builds/starts without errors.
- If opening a PR (via `gh pr create` or GitHub UI), briefly state: **what changed**, **how to test**, and **whether any API contract or `.env.example` key changed**.

---

## 3. Public Repo Security Rules (CRITICAL)

This repository is currently **PUBLIC** on GitHub.
- **NEVER** hardcode API keys, tokens, passwords, cookies, or private credentials anywhere in code, tests, docs, or commit messages.
- Always load secrets from `.env` (already ignored by `.gitignore`).
- Whenever you introduce a new required environment variable, add **only the key name and a fake placeholder** to `.env.example` and explicitly remind your user to share the real value with teammates out-of-band (e.g., team chat), never via Git.
- Do not commit large binary files, raw datasets, or local caches (`node_modules/`, `.venv/`, `dist/`, `.DS_Store`, etc.).

---

## 4. Directory Ownership & Anti-Conflict Boundaries

To prevent four parallel agents from colliding on the same files, respect module ownership defined in `docs/TEAM_PLAN.md`:

```text
├── frontend/   # Frontend / UI owner
├── backend/    # Backend / AI / core logic owner
├── docs/       # Integrator / PM owner (contracts, plans, guides)
├── pitch/      # Pitch / Demo / PPT owner
├── README.md   # Shared — update only when agreed or during integration
└── .env.example # Shared — append-only for new env var names
```

- **Stay inside your owner's directory.** Do NOT "helpfully" refactor, reformat, or rename files in another teammate's directory.
- **Cross-module changes**: If frontend needs a backend endpoint change (or vice versa), **do NOT silently change the contract**. Update the contract section in `docs/TEAM_PLAN.md` (or `docs/API_CONTRACT.md` once created) and tell your user to sync with the teammate.
- **Avoid global formatting sweeps**: Never run repo-wide Prettier/Black/lint autofixes across files your user does not own.

---

## 5. Hackathon Execution Principles (MVP & Demo First)

Optimize for a **working, impressive live demo by Nov 22 13:00 CST**, not enterprise perfection:
1. **No Scope Creep**: Do NOT build login/registration, RBAC, complex databases, Docker/K8s setups, or unused abstractions unless explicitly listed in `docs/TEAM_PLAN.md`.
2. **Mock Early, Integrate Early**: Provide clean mock data/endpoints immediately so frontend and backend are never blocked waiting on each other.
3. **Keep Demo Resilient**: Handle API timeouts/errors gracefully with clear UI fallbacks so a live demo never crashes to a blank screen.
4. **Respect Feature Freeze (Nov 22 11:00 CST)**: After freeze time, only apply targeted bug fixes, demo polish, README updates, and pitch materials—no risky refactors.

---

## 6. Required Handoff Summary After Finishing a Task

Whenever you finish a meaningful change, report concisely to your user:
1. **Branch & Files**: Current branch name and key files added/modified.
2. **Verification**: Exact command run and result (pass/fail).
3. **Team Sync Needed?**: Explicitly flag if teammates need to:
   - Pull new dependencies (`npm install` / `pip install`),
   - Add a new key to their local `.env`, or
   - Adapt to an API/data schema change.
