# Agent Instructions

## Before Making Changes
- Review the README.md to understand the project purpose and structure
- This is a Tampermonkey userscript that runs on lmarena.ai

## Code Style
- Keep code as simple and readable as possible
- Prefer clarity over cleverness
- Use descriptive variable and function names
- Add comments only when the "why" isn't obvious from the code

## Architecture
- Single-file userscript - do not split into modules
- All configuration should be in the CONFIG object
- Follow the existing section structure (marked with `// ===` separators)

## Version Management
- Only commit when the developer explicitly asks (e.g., "git commit")
- Update version on each git commit
- Keep VERSION constant and @version in userscript header in sync
- Both are at the top of lmarena-judge.js
