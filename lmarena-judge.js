// ==UserScript==
// @name         LMArena Battle Judge
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Extract LMArena battle responses and generate judge prompt.
// @match        *://lmarena.ai/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

// NOTE: @grant none disables Tampermonkey's sandbox to allow navigator.clipboard API access.
// This is required for the copy-to-clipboard functionality. The script only runs on lmarena.ai.

(function () {
    'use strict';

    // =============================================================================
    // CONFIGURATION
    // =============================================================================

    const VERSION = '4.0';

    const CONFIG = {
        // Model name prefixes for detection
        modelPrefixes: [
            'claude', 'grok', 'gpt', 'gemini', 'llama', 'mistral', 'qwen',
            'deepseek', 'o1', 'o3', 'o4-mini', 'chatgpt', 'command', 'dbrx',
            'phi', 'yi', 'solar', 'palm', 'codestral', 'pixtral', 'nemotron'
        ],

        // CSS selectors
        selectors: {
            responseContainer: '[class*="flex"][class*="-ml-4"]',
            userBubble: '[class*="bg-surface-secondary"][class*="max-w-prose"]',
            prose: '[class*="prose"]',
            spinner: '[class*="spinner"], [class*="loading"], [class*="generating"]',
            hidden: '[style*="display: none"], [style*="display:none"], [style*="visibility: hidden"], [style*="visibility:hidden"]'
        },

        // Elements to strip from response text
        stripSelectors: [
            'details',
            '[class*="thinking"]',
            '[class*="reasoning"]',
            '[class*="thought"]',
            '[aria-hidden="true"]',
            '[hidden]'
        ],

        // UI
        buttonContainerId: 'lmarena-judge-btn',
        debounceMs: 500
    };

    // Build model regex from prefixes
    const MODEL_REGEX = new RegExp(
        `^((?:${CONFIG.modelPrefixes.join('|')})[\\w\\-\\.]*(?:-thinking)?(?:-\\d+k)?)`,
        'i'
    );

    // =============================================================================
    // UTILITIES
    // =============================================================================

    const log = (...args) => console.log(`[LMArena Judge v${VERSION}]`, ...args);

    /** Strip citation artifacts from search model outputs */
    function stripCitations(text) {
        if (!text) return '';
        return text
            .replace(/\[\d+\]/g, '')                       // [1], [2], etc.
            .replace(/(\.\s*)\d+(\s|$)/g, '$1$2')          // trailing citation numbers
            .replace(/\n*Sources\s*\n[\s\S]*$/i, '')       // "Sources" section
            .replace(/\n\d+\s+https?:\/\/[^\n]+/g, '')     // numbered URL lines
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /** Copy text to clipboard with fallback */
    async function copyToClipboard(text, button, originalText, originalColor) {
        try {
            await navigator.clipboard.writeText(text);
            button.textContent = 'Copied!';
            button.style.background = '#22c55e';
            setTimeout(() => {
                button.textContent = originalText;
                button.style.background = originalColor;
            }, 1500);
        } catch {
            // Fallback: show textarea for manual copy
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:80%;height:60%;z-index:10001;font-family:monospace;';
            document.body.appendChild(textarea);
            textarea.select();
            alert('Clipboard unavailable. Text selected - press Ctrl+C to copy, click outside to close.');
            textarea.addEventListener('blur', () => textarea.remove());
        }
    }

    /** Deduplicate text fragments, keeping longest non-overlapping */
    function deduplicateTexts(texts) {
        const result = [];
        for (const text of texts) {
            if (text.length < 10) continue;

            // Skip if substring of existing
            if (result.some(r => r.includes(text))) continue;

            // Remove existing texts that are substrings of this one
            for (let i = result.length - 1; i >= 0; i--) {
                if (text.includes(result[i])) result.splice(i, 1);
            }
            result.push(text);
        }
        return result;
    }

    // =============================================================================
    // MODEL DETECTION
    // =============================================================================

    function isModelName(text) {
        if (!text) return false;
        const firstWord = text.trim().split(/\s/)[0].toLowerCase();
        const firstLine = text.trim().split('\n')[0];
        return CONFIG.modelPrefixes.some(p => firstWord.startsWith(p)) && MODEL_REGEX.test(firstLine);
    }

    function isThoughtPrefix(text) {
        return /^thought for/i.test(text?.trim() || '');
    }

    function extractModelName(column) {
        if (!column) return 'Unknown';

        const lines = (column.innerText?.trim() || '').split('\n');

        // Check first 5 lines for model name
        for (let i = 0; i < Math.min(5, lines.length); i++) {
            const line = lines[i].trim();
            if (!line || isThoughtPrefix(line)) continue;
            const match = line.match(MODEL_REGEX);
            if (match) return match[1];
        }

        // Fallback: check if first meaningful line looks like a model name
        const firstLine = lines.find(l => l.trim() && !isThoughtPrefix(l))?.trim() || '';
        if (/^[\w\-\.]+(-\d+k)?$/i.test(firstLine) && firstLine.length < 50) {
            if (CONFIG.modelPrefixes.some(p => firstLine.toLowerCase().startsWith(p))) {
                return firstLine;
            }
        }

        return 'Unknown';
    }

    // =============================================================================
    // DOM EXTRACTION
    // =============================================================================

    /** Extract clean response text from a column element */
    function extractColumnText(column) {
        if (!column) return '';

        const clone = column.cloneNode(true);

        // Remove thinking blocks, user bubbles, and hidden elements
        const removeSelectors = [
            ...CONFIG.stripSelectors,
            CONFIG.selectors.userBubble,
            CONFIG.selectors.hidden
        ];

        for (const selector of removeSelectors) {
            try {
                clone.querySelectorAll(selector).forEach(el => el.remove());
            } catch { /* invalid selector */ }
        }

        // Extract from prose elements
        const proseElements = clone.querySelectorAll(CONFIG.selectors.prose);
        if (proseElements.length > 0) {
            const texts = Array.from(proseElements)
                .map(el => el.innerText?.trim())
                .filter(Boolean);

            const deduplicated = deduplicateTexts(texts);
            if (deduplicated.length > 0) {
                return stripCitations(deduplicated.join('\n\n'));
            }
        }

        // Fallback: use full text, skipping model name lines
        const lines = (clone.innerText || '').split('\n');
        let startIndex = 0;
        for (let i = 0; i < Math.min(5, lines.length); i++) {
            const line = lines[i].trim();
            if (isModelName(line) || isThoughtPrefix(line) || !line) {
                startIndex = i + 1;
            } else {
                break;
            }
        }

        return stripCitations(lines.slice(startIndex).join('\n').trim());
    }

    // Cache for extracted column text
    const textCache = new WeakMap();

    function getCachedText(column) {
        if (!column) return '';
        if (!textCache.has(column)) {
            textCache.set(column, extractColumnText(column));
        }
        return textCache.get(column);
    }

    /** Extract user prompts from the page */
    function extractUserPrompts() {
        const seen = new Set();
        const prompts = [];

        for (const bubble of document.querySelectorAll(CONFIG.selectors.userBubble)) {
            const text = bubble.innerText?.trim();
            if (!text || text.length < 3 || seen.has(text)) continue;
            if (/^(Winner:|1\.\s*Winner|Vote|Regenerate)/i.test(text)) continue;
            if (text.split(/\s+/).length <= 2 && isModelName(text)) continue;

            seen.add(text);
            prompts.push(text);
        }

        return prompts.reverse(); // DOM is reverse-chronological
    }

    // =============================================================================
    // TURN DETECTION
    // =============================================================================

    /**
     * Find all response turn containers.
     * Returns array of { colA, colB, domIndex, chronIndex, type }
     * Type: 'complete' | 'voted' | 'incomplete'
     */
    function findAllTurns() {
        let containers = Array.from(document.querySelectorAll(CONFIG.selectors.responseContainer));

        // Fallback if primary selector fails
        if (containers.length === 0) {
            log('Primary selector failed, trying fallback...');
            containers = Array.from(document.querySelectorAll('[class*="flex"]')).filter(el => {
                if (el.children.length < 1 || el.children.length > 2) return false;
                const text = el.innerText || '';
                return text.length > 200 && (isModelName(text) || isThoughtPrefix(text));
            });
        }

        const turns = [];

        for (let i = 0; i < containers.length; i++) {
            const container = containers[i];
            const children = Array.from(container.children);

            if (children.length === 0) continue;
            if (!children.some(c => (c.innerText?.length || 0) > 5)) continue;

            // Skip user bubbles
            const hasUserBubble = children.some(c => {
                try { return c.matches?.(CONFIG.selectors.userBubble); }
                catch { return false; }
            });
            if (hasUserBubble) continue;

            const text0 = children[0]?.innerText?.slice(0, 150) || '';
            const isModel0 = isModelName(text0) || isThoughtPrefix(text0);

            if (children.length === 2) {
                const text1 = children[1]?.innerText?.slice(0, 150) || '';
                const isModel1 = isModelName(text1) || isThoughtPrefix(text1);
                const len0 = children[0]?.innerText?.length || 0;
                const len1 = children[1]?.innerText?.length || 0;

                if (isModel0 || isModel1 || (len0 > 500 && len1 > 500)) {
                    turns.push({ colA: children[0], colB: children[1], domIndex: i, type: 'complete' });
                }
            } else if (children.length === 1) {
                const hasSpinner = container.querySelector(CONFIG.selectors.spinner);

                if (isModel0 && !hasSpinner) {
                    turns.push({ colA: children[0], colB: null, domIndex: i, type: 'voted' });
                } else if (hasSpinner) {
                    turns.push({ colA: children[0], colB: null, domIndex: i, type: 'incomplete' });
                }
            }
        }

        // Sort by DOM order then reverse for chronological (oldest first)
        turns.sort((a, b) => a.domIndex - b.domIndex);
        turns.reverse();
        turns.forEach((turn, i) => { turn.chronIndex = i; });

        return turns;
    }

    /** Get the last complete turn for evaluation */
    function getLastCompleteTurn() {
        const allTurns = findAllTurns();
        const complete = allTurns.filter(t => t.type === 'complete');

        if (complete.length === 0) return null;

        const last = complete[complete.length - 1];
        return {
            ...last,
            totalTurns: allTurns.length,
            turnIndex: last.chronIndex
        };
    }

    // =============================================================================
    // JUDGE PROMPT GENERATION
    // =============================================================================

    function generateJudgePrompt(prompts, responseA, responseB, modelA, modelB, turnIndex, allTurnsData) {
        const completeTurns = findAllTurns().filter(t => t.type === 'complete').length;
        const currentPrompt = prompts[turnIndex] || '[NO PROMPT DETECTED]';

        // Build conversation history for multi-turn
        let historySection = '';
        if (turnIndex > 0 && allTurnsData?.length > 0) {
            const parts = [];

            for (let i = 0; i < turnIndex; i++) {
                const prompt = prompts[i] || '[PROMPT NOT CAPTURED]';
                const turn = allTurnsData[i];

                let section = `### Turn ${i + 1} - User Prompt\n${prompt}`;

                if (turn) {
                    const isHiddenB = !turn.responseB || turn.responseB.includes('[HIDDEN');
                    if (isHiddenB) {
                        section += `\n\n[NOTE: This turn was already voted on. Model B's response is hidden.]`;
                    }
                    section += `\n\n### Turn ${i + 1} - Model A (${turn.modelA}) Response\n${turn.responseA || '[NO RESPONSE]'}`;
                    section += `\n\n### Turn ${i + 1} - Model B (${turn.modelB}) Response\n${turn.responseB || '[NO RESPONSE]'}`;
                }
                parts.push(section);
            }

            if (parts.length > 0) {
                historySection = `## Full Conversation History\n"""\n${parts.join('\n\n---\n\n')}\n"""\n\n`;
            }
        }

        const turnLabel = turnIndex > 0 ? `Current Turn Being Evaluated (Turn ${turnIndex + 1})` : 'User Prompt';

        // Note about incomplete turns
        let incompleteNote = '';
        if (prompts.length > completeTurns) {
            const pending = prompts.length - completeTurns;
            const nextPrompt = prompts[completeTurns];
            const truncated = nextPrompt?.length > 150 ? nextPrompt.slice(0, 150) + '...' : nextPrompt || '[unknown]';
            incompleteNote = `\n\n_Note: Battle still in progress — ${pending} additional prompt(s) awaiting responses. Next prompt: "${truncated}"_\n`;
        }

        return `You are an extremely critical, world-class evaluator of LLM outputs. Be precise and unsparing.

${historySection}## ${turnLabel}
"""
${currentPrompt}
"""

## Model A (${modelA}) Response
"""
${responseA || '[NO RESPONSE]'}
"""

## Model B (${modelB}) Response
"""
${responseB || '[NO RESPONSE]'}
"""${incompleteNote}

## Your Evaluation Task

**Winner**: State "A" or "B" or "Tie" (ties should be rare)

**Critical Analysis**: Explain precisely why, identifying:
- Factual errors or hallucinations in either response
- Logical flaws or gaps in reasoning
- Missing information the prompt requested
- Unnecessary verbosity or filler
- Tone/style/formatting issues

**Deeper Comparison**:
- Which showed deeper reasoning vs. surface-level response?
- Which had more original insight vs. generic answers?
- Which was better structured and clearer?

**Prompt Improvement**: Rewrite the original prompt to be 5-10x more effective at getting the superior behavior you observed. Explain your changes.`;
    }

    // =============================================================================
    // DEBUG OUTPUT
    // =============================================================================

    function generateDebugOutput() {
        const allTurns = findAllTurns();
        const currentTurn = getLastCompleteTurn();
        const prompts = extractUserPrompts();
        const containers = document.querySelectorAll(CONFIG.selectors.responseContainer);

        const completeTurns = allTurns.filter(t => t.type === 'complete');
        const votedTurns = allTurns.filter(t => t.type === 'voted');
        const incompleteTurns = allTurns.filter(t => t.type === 'incomplete');

        return JSON.stringify({
            meta: {
                version: VERSION,
                timestamp: new Date().toISOString(),
                url: window.location.href
            },

            summary: {
                completeTurns: completeTurns.length,
                votedTurns: votedTurns.length,
                incompleteTurns: incompleteTurns.length,
                promptsFound: prompts.length,
                aligned: prompts.length === completeTurns.length
            },

            currentEval: currentTurn ? {
                turnIndex: currentTurn.turnIndex,
                modelA: extractModelName(currentTurn.colA),
                modelB: extractModelName(currentTurn.colB),
                responseALength: getCachedText(currentTurn.colA).length,
                responseBLength: getCachedText(currentTurn.colB).length
            } : null,

            prompts: prompts.map(p => p.slice(0, 200) + (p.length > 200 ? '...' : '')),

            turns: allTurns.map(t => ({
                chronIndex: t.chronIndex,
                domIndex: t.domIndex,
                type: t.type,
                modelA: extractModelName(t.colA),
                modelB: t.colB ? extractModelName(t.colB) : '[HIDDEN]',
                responseALength: getCachedText(t.colA).length,
                responseBLength: t.colB ? getCachedText(t.colB).length : 0,
                preview: getCachedText(t.colA).slice(0, 100)
            })),

            containers: Array.from(containers).slice(0, 10).map((c, i) => ({
                index: i,
                childCount: c.children.length,
                childLengths: Array.from(c.children).map(el => el.innerText?.length || 0),
                firstChars: Array.from(c.children).map(el => (el.innerText?.slice(0, 80) || '').replace(/\n/g, ' '))
            })),

            config: {
                selectors: CONFIG.selectors,
                stripSelectors: CONFIG.stripSelectors
            }
        }, null, 2);
    }

    // =============================================================================
    // UI
    // =============================================================================

    function createButtons() {
        if (document.getElementById(CONFIG.buttonContainerId)) return;

        log('Creating buttons...');

        const container = document.createElement('div');
        container.id = CONFIG.buttonContainerId;
        container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:10000;display:flex;gap:8px;';

        const buttonStyle = 'padding:8px 14px;font-size:13px;color:white;border:none;border-radius:4px;cursor:pointer;';

        // Judge button
        const judgeBtn = document.createElement('button');
        judgeBtn.textContent = 'Judge';
        judgeBtn.style.cssText = buttonStyle + 'background:#6366f1;';

        judgeBtn.addEventListener('click', () => {
            const turn = getLastCompleteTurn();
            if (!turn) {
                alert('No battle responses found. Make sure both models have responded.');
                return;
            }

            const prompts = extractUserPrompts();
            const allTurns = findAllTurns();

            const turnsData = allTurns.map(t => ({
                modelA: extractModelName(t.colA),
                modelB: t.colB ? extractModelName(t.colB) : '[HIDDEN]',
                responseA: getCachedText(t.colA),
                responseB: t.colB ? getCachedText(t.colB) : '[HIDDEN - vote already cast]'
            }));

            const judgePrompt = generateJudgePrompt(
                prompts,
                getCachedText(turn.colA),
                getCachedText(turn.colB),
                extractModelName(turn.colA),
                extractModelName(turn.colB),
                turn.turnIndex,
                turnsData
            );

            copyToClipboard(judgePrompt, judgeBtn, 'Judge', '#6366f1');
        });

        // Debug button
        const debugBtn = document.createElement('button');
        debugBtn.textContent = 'Debug';
        debugBtn.style.cssText = buttonStyle + 'background:#666;';

        debugBtn.addEventListener('click', () => {
            const output = generateDebugOutput();
            copyToClipboard(output, debugBtn, 'Debug', '#666');
        });

        container.appendChild(judgeBtn);
        container.appendChild(debugBtn);
        document.body.appendChild(container);
    }

    // =============================================================================
    // INITIALIZATION
    // =============================================================================

    let debounceTimeout = null;

    function debouncedCreateButtons() {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(createButtons, CONFIG.debounceMs);
    }

    // Initial setup
    log('Initializing...');
    createButtons();

    const observer = new MutationObserver(debouncedCreateButtons);
    observer.observe(document.body, { childList: true, subtree: true });

    // Cleanup on page unload
    window.addEventListener('unload', () => {
        observer.disconnect();
        clearTimeout(debounceTimeout);
    });

    log('Ready');
})();
