# LMArena Battle Judge

**Version:** 4.6  
**License:** MIT

A Tampermonkey userscript that extracts side-by-side LLM battle responses from [lmarena.ai](https://lmarena.ai) and generates a structured evaluation prompt for rigorous comparison.

## Why This Is Useful

LMArena lets you compare AI models side-by-side, but the built-in voting is limited to a quick subjective choice. This script enables **deeper analysis**:

- **Rigorous evaluation** — Generate a structured prompt that asks an external LLM to analyze both responses for factual accuracy, reasoning quality, and completeness
- **Document your comparisons** — The judge prompt captures the full context (prompts + responses) for reproducible evaluations
- **Multi-turn support** — Full conversation history is included, so the judge LLM has complete context
- **Clean extraction** — Automatically strips thinking blocks, citations from search models, and other artifacts that would clutter the evaluation

### Example Workflow

1. Run a battle on LMArena between two models
2. Click **Judge** to copy the evaluation prompt
3. Paste the prompt into LMArena (to have two models assess the result) or paste into your preferred Claude, Gemini, OpenAI, or other model as your preferred judge LLM
4. Get a detailed comparison with factual analysis, not just a gut vote

## Installation

### Option 1: Install from GreasyFork (Recommended)

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Visit the script page on GreasyFork: **[LMArena Battle Judge](https://greasyfork.org/en/scripts/TODO)**
3. Click **Install this script**
4. Navigate to [lmarena.ai](https://lmarena.ai) — you'll see the Judge button

### Option 2: Manual Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser
2. Click the Tampermonkey icon → **Create a new script**
3. Delete the template code and paste the contents of [`lmarena-judge.js`](lmarena-judge.js)
4. Press **Ctrl+S** (or Cmd+S) to save
5. Navigate to [lmarena.ai](https://lmarena.ai) — you'll see the Judge button

## Usage

Two buttons appear in the bottom-right corner of any LMArena battle page:

| Button | Action |
|--------|--------|
| **Judge** | Extracts the current turn and copies a formatted judge prompt to clipboard |
| **Debug** | Copies detailed diagnostic JSON to clipboard for troubleshooting |

### Multi-Turn Conversations

The script automatically:
- Includes full conversation history in the judge prompt
- Evaluates only the **last complete turn** (where both models have responded)
- Notes any incomplete turns still awaiting responses
- Handles voted turns where one response is hidden

## What Gets Extracted

The script cleans response text by removing:
- **Thinking blocks** — `<details>`, reasoning traces, thought sections
- **Citation artifacts** — `[1]`, `[2]`, "Sources" sections, URL lists (from search models)
- **Hidden elements** — Collapsed or display:none content
- **User bubbles** — Prevents prompt text from leaking into responses

## Troubleshooting

If the script doesn't detect responses:

1. Click **Debug** to copy diagnostic JSON
2. Check that both models have finished responding (no spinners)
3. LMArena occasionally updates their DOM structure — debug output helps identify selector changes

## Technical Details

<details>
<summary>DOM Structure & Selectors</summary>

LMArena is built with Next.js/React + Tailwind CSS. The script uses partial attribute selectors to handle dynamic class names:

| Element | Selector |
|---------|----------|
| Response containers | `[class*="flex"][class*="-ml-4"]` |
| Response text | `[class*="prose"]` |
| User prompts | `[class*="bg-surface-secondary"][class*="max-w-prose"]` |

</details>

<details>
<summary>Turn Detection Logic</summary>

- DOM order is **reverse-chronological** (newest first)
- Script reverses to get **chronological order** (oldest first)
- Turn types: `complete` (2 responses), `voted` (1 visible), `incomplete` (still generating)

</details>

<details>
<summary>Debug Output Structure</summary>

```json
{
  "meta": { "version": "4.6", "timestamp": "...", "url": "..." },
  "summary": { "completeTurns": 2, "votedTurns": 0, "promptsFound": 2 },
  "currentEval": { "turnIndex": 1, "modelA": "claude-3.5-sonnet", "modelB": "gpt-4o" },
  "prompts": ["User prompt 1...", "User prompt 2..."],
  "turns": [{ "chronIndex": 0, "type": "complete", "modelA": "...", "modelB": "..." }]
}
```

</details>

## Files

| File | Description |
|------|-------------|
| `lmarena-judge.js` | The Tampermonkey userscript |
| `README.md` | This documentation |
| `LICENSE.md` | MIT License |

## Contributing

Issues and pull requests welcome. The script is intentionally simple — a single file with no dependencies.

## License

[MIT](LICENSE.md) — Use freely, modify as needed.