# Meals: instructions for Claude Code

The owner is not a full-time developer. Keep explanations short and plain. Say what a command does before installing or deleting anything.

- **Never commit recipe content.** The cookbook is paid and its author asks that its contents aren't shared. Recipes live in `private/` (ignored) and reach the app through Import. No book text, photos or pack files in git, tests or commit messages.
- Prices in `data/ingredients.json` are estimates. Never present them as live; keep the "estimate" wording in the app.
- Macros: book values are the baseline, and changes are applied as a difference per ingredient (`viewRecipe`). Unchanged portions must equal the book exactly.
- Logic lives in `core.js` and needs tests in `tests/`. Run `npm test`.
- Each release: raise `CACHE` in `sw.js` and `BUILD` in `index.html` together.
- `dev` holds work; `main` is the live site and only gets changes with the owner's OK.
