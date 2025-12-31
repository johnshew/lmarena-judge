# LMArena Battle Judge

**Version:** 3.7  
**Last Updated:** December 2025

A Tampermonkey userscript that extracts side-by-side LLM battle responses from [lmarena.ai](https://lmarena.ai) and generates a formatted "judge prompt" for evaluation by another LLM.

## What It Does

1. **Detects battle mode** - Identifies when two models are responding side-by-side
2. **Extracts user prompts** - Captures all prompts including multi-turn conversation history
3. **Extracts model responses** - Gets clean response text, stripping thinking blocks and citations
4. **Identifies model names** - Detects model identifiers (claude, gpt, grok, gemini, etc.)
5. **Generates judge prompt** - Creates a formatted evaluation prompt with full context
6. **Copies to clipboard** - One click to copy, ready to paste into your preferred judge LLM

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Create a new script and paste the contents of `lmarena-battle-judge.user.js`
3. Save and ensure the script is enabled
4. Navigate to any battle on lmarena.ai

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

## Core Selectors (December 2025)

| Element | Selector | Notes |
|---------|----------|-------|
| Response containers | `[class*="flex"][class*="-ml-4"]` | Contains 2 children when complete |
| Response text | `[class*="prose"]` | Rendered markdown content |
| User prompts | `[class*="bg-surface-secondary"][class*="max-w-prose"]` | Chat bubble style |
| Model names | First line of column text | Regex: `/^(model-pattern)[\w-.]*(-thinking)?(-\d+k)?/i` |

## Key Logic

### Turn Detection
```
DOM Order (reverse-chronological)     Chronological Order (after processing)
├─ Container 0 (newest/Turn 3)   →    chronIndex 2
├─ Container 1 (Turn 2)          →    chronIndex 1  
└─ Container 2 (oldest/Turn 1)   →    chronIndex 0
```

- DOM order is **reverse-chronological** (newest first)
- Script reverses to get **chronological order** (oldest first)
- Each turn gets both `domIndex` (position in DOM) and `chronIndex` (position in time)

### Turn Types
| Type | Children | Description |
|------|----------|-------------|
| `complete` | 2 | Both models have responded - can be evaluated |
| `voted` | 1 | Already voted, losing response hidden |
| `incomplete` | 1 | Still generating (has spinner) |

### Text Extraction

The script cleans response text by removing:
- **Thinking blocks**: `<details>`, `[class*="thinking"]`, `[class*="reasoning"]`, `[aria-hidden="true"]`
- **Citation artifacts**: `[1]`, `[2]`, trailing numbers, "Sources" sections, URL lists
- **Hidden elements**: `[style*="display: none"]`, `[hidden]`
- **User bubbles**: Prevents prompt text from leaking into responses

## Debug Output Structure

```json
{
  "scriptVersion": "3.7",
  "timestamp": "...",
  "url": "...",
  
  "turnCount": 2,
  "votedTurnCount": 1,
  "incompleteTurnCount": 0,
  "promptsFound": 3,
  "promptResponseAlignment": "aligned | mismatch (...)",
  
  "currentTurnIndex": 2,
  "modelA": "grok-4-search",
  "modelB": "gpt-5.2-search",
  
  "allTurns": [
    { "chronIndex": 0, "domIndex": 2, "type": "complete", "modelA": "...", "modelB": "..." }
  ],
  
  "rawContainers": [
    { "index": 0, "childCount": 2, "childLengths": [4433, 3664], "firstChars": ["model-name..."] }
  ],
  
  "selectors": { "flexMl4Containers": 3, "proseElements": 12, "userBubbles": 3 },
  "domInspection": { "detailsElements": 0, "hiddenElements": 1, ... }
}
```

### What to Check When Debugging

| Symptom | Check | Likely Cause |
|---------|-------|--------------|
| No turns detected | `rawContainers[].childCount` | Selector changed, or page not loaded |
| Wrong turn order | `chronIndex` vs `domIndex` | Ordering logic issue |
| Missing response text | `cleanedLengths` vs `childLengths` | Over-aggressive stripping |
| Model name "Unknown" | `firstChars` | Model name not in first 5 lines |
| Prompts misaligned | `promptsFound` vs `turnCount` | DOM order assumption wrong |

## Key Learnings

### LMArena DOM Structure
- Built with **Next.js/React + Tailwind CSS**
- Class names are dynamic but contain **stable fragments** (`flex`, `-ml-4`, `prose`, `bg-surface-secondary`)
- Side-by-side responses are **siblings in a flex container**
- Model name appears as **first line** of each column's text
- "Thought for X seconds" prefix appears on thinking models - must skip when finding model name

### Selector Strategy
- **Never use exact class matches** - Tailwind classes change frequently
- Use **partial attribute selectors**: `[class*="fragment"]`
- LMArena updates DOM structure periodically - debug output is essential for adaptation
- Fallback selectors exist but primary selector has been stable since Dec 2025

### Prose Element Deduplication
- Multiple `[class*="prose"]` elements exist per column (nested structure)
- Script tracks seen text and **skips substrings** of already-captured content
- Joins unique text blocks with double newlines

### Chronological Ordering (Critical)
- DOM order is **reverse-chronological** (newest at top)
- Must sort by `domIndex` then reverse to get chronological
- Both prompts and responses need this treatment
- `chronIndex` = position in time, `domIndex` = position in DOM

### Citation Stripping (Search Models)
- Models like `grok-4-search` and `gpt-5.2-search` include inline citations
- Script removes `[1]`, `[2]`, trailing citation numbers
- Removes "Sources" sections and numbered URL lists
- Essential for clean judge prompts

## Design Principles

1. **Keep it simple** - No fancy UI, emojis, or unnecessary features
2. **Debug button always present** - Essential for diagnosing selector issues
3. **Comprehensive debug output** - JSON with everything needed to diagnose problems
4. **Graceful degradation** - Fallbacks for model detection and text extraction
5. **Minimal logging** - Only essential console messages
6. **No external dependencies** - Pure vanilla JS

## Version History

| Version | Changes |
|---------|---------|
| 3.7 | Simplified codebase (~17% smaller), removed redundant functions |
| 3.6 | Added citation stripping for search models |
| 3.5 | Fixed chronological ordering bug, added `chronIndex`/`domIndex`, improved thinking block removal |
| 3.4 | Added comprehensive debug output, voted turn detection |
| 2.5 | Prompt/response alignment, incomplete turn detection |

## Future Debugging Workflow

1. Click **Debug** button on lmarena.ai
2. Paste JSON into conversation with Claude (or other LLM)
3. Analyze `rawContainers` to see actual DOM structure
4. Check `firstChars` to verify model detection
5. Compare `childLengths` vs `cleanedLengths` for extraction issues
6. Adjust selectors based on findings
7. Test with **Judge** button
8. Repeat until working

## Files

- `lmarena-battle-judge.user.js` - The Tampermonkey script (v3.7)
- `LMARENA-JUDGE-README.md` - This documentation

## License

MIT - Use freely, modify as needed.