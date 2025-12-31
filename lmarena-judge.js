// ==UserScript==
// @name         LMArena Battle Judge
// @namespace    http://tampermonkey.net/
// @version      3.7
// @description  Extract LMArena battle responses and generate judge prompt. Simplified codebase, Dec 2025.
// @match        *://lmarena.ai/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

// NOTE: @grant none disables Tampermonkey's sandbox to allow navigator.clipboard API access.
// This is required for the copy-to-clipboard functionality. The script only runs on lmarena.ai.

(function() {
    'use strict';

    const VERSION = '3.7';
    const log = (...args) => console.log('[LMArena Judge v' + VERSION + ']', ...args);

    log('Script loading...');

    // Model name patterns for detection
    const MODEL_PATTERNS = [
        'claude', 'grok', 'gpt', 'gemini', 'llama', 'mistral', 'qwen',
        'deepseek', 'o1', 'o3', 'o4-mini', 'chatgpt', 'command', 'dbrx',
        'phi', 'yi', 'solar', 'palm', 'codestral', 'pixtral', 'nemotron'
    ];

    const MODEL_REGEX = new RegExp(
        `^((?:${MODEL_PATTERNS.join('|')})[\\w\\-\\.]*(?:-thinking)?(?:-\\d+k)?)`,
        'i'
    );

    // Selectors for thinking blocks to remove from response text
    const THINKING_BLOCK_SELECTORS = [
        'details',
        '[class*="thinking"]',
        '[class*="reasoning"]',
        '[class*="thought"]',
        '[aria-hidden="true"]',
        '[hidden]'
    ];

    // Selector for user prompt bubbles
    const USER_BUBBLE_SELECTOR = '[class*="bg-surface-secondary"][class*="max-w-prose"]';

    // Helper to safely get className as string (handles SVG elements)
    const getClassName = (el) => {
        if (!el) return 'none';
        const cn = el.className;
        if (typeof cn === 'string') return cn;
        if (cn && typeof cn.baseVal === 'string') return cn.baseVal; // SVGAnimatedString
        return 'none';
    };

    // Strip citation artifacts from search model outputs
    const stripCitations = (text) => {
        if (!text) return '';
        return text
            .replace(/\[\d+\]/g, '')                          // [1], [2], etc.
            .replace(/(\.\s*)\d+(\s|$)/g, '$1$2')             // trailing citation numbers
            .replace(/\n*Sources\s*\n[\s\S]*$/i, '')          // "Sources" section
            .replace(/\n\d+\s+https?:\/\/[^\n]+/g, '')        // numbered URL lines
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    };

    const LMArena = {
        isModelName: (text) => {
            if (!text) return false;
            const firstWord = text.trim().split(/\s/)[0].toLowerCase();
            // Also verify with regex for stricter matching
            return MODEL_PATTERNS.some(p => firstWord.startsWith(p)) && 
                   MODEL_REGEX.test(text.trim().split('\n')[0]);
        },

        isThoughtPrefix: (text) => {
            return /^thought for/i.test(text?.trim() || '');
        },

        /**
         * Get all response column pairs. DOM order is reverse-chronological,
         * so we reverse to get chronological order (oldest first).
         */
        getAllColumns: () => {
            log('getAllColumns: Searching for flex containers...');

            // Primary selector: response pair containers
            let containers = Array.from(document.querySelectorAll('[class*="flex"][class*="-ml-4"]'));
            log('getAllColumns: Found', containers.length, 'primary flex containers');

            // FALLBACK: If primary selector fails, try broader search
            if (containers.length === 0) {
                log('getAllColumns: Primary selector failed, attempting fallback...');
                const candidates = document.querySelectorAll('[class*="flex"]');
                containers = Array.from(candidates).filter(el => {
                    if (el.children.length < 1 || el.children.length > 2) return false;
                    const text = el.innerText || '';
                    // Must have substantial content and look like model responses
                    return text.length > 200 && (
                        LMArena.isModelName(text) || 
                        LMArena.isThoughtPrefix(text)
                    );
                });
                log('getAllColumns: Fallback found', containers.length, 'candidates');
            }

            // Collect all turn candidates with their DOM position
            const turnCandidates = [];

            for (let i = 0; i < containers.length; i++) {
                const container = containers[i];
                const children = Array.from(container.children);

                if (children.length === 0) continue;
                
                // FIX v3.5: Lower threshold to catch short refusals (was 20)
                if (!children.some(c => (c.innerText?.length || 0) > 5)) {
                    log('getAllColumns: Skipping container', i, '- text too short');
                    continue;
                }

                // Skip if children are user bubbles
                const hasUserBubble = children.some(c => {
                    try { return c.matches?.(USER_BUBBLE_SELECTOR); } 
                    catch (e) { return false; }
                });
                if (hasUserBubble) continue;

                const text0 = children[0]?.innerText?.slice(0, 150) || '';
                const isModel0 = LMArena.isModelName(text0) || LMArena.isThoughtPrefix(text0);

                if (children.length === 2) {
                    // Complete turn with both responses side-by-side
                    const text1 = children[1]?.innerText?.slice(0, 150) || '';
                    const isModel1 = LMArena.isModelName(text1) || LMArena.isThoughtPrefix(text1);
                    const len0 = children[0]?.innerText?.length || 0;
                    const len1 = children[1]?.innerText?.length || 0;

                    if (isModel0 || isModel1 || (len0 > 500 && len1 > 500)) {
                        log('getAllColumns: COMPLETE turn in container', i);
                        turnCandidates.push({
                            colA: children[0],
                            colB: children[1],
                            domIndex: i,
                            type: 'complete'
                        });
                    }
                } else if (children.length === 1) {
                    // Could be voted turn OR incomplete turn
                    const hasSpinner = container.querySelector(
                        '[class*="spinner"], [class*="loading"], [class*="generating"]'
                    );

                    if (isModel0 && !hasSpinner) {
                        log('getAllColumns: VOTED turn in container', i);
                        turnCandidates.push({
                            colA: children[0],
                            colB: null,
                            domIndex: i,
                            type: 'voted'
                        });
                    } else if (hasSpinner) {
                        log('getAllColumns: INCOMPLETE turn in container', i);
                        turnCandidates.push({
                            colA: children[0],
                            colB: null,
                            domIndex: i,
                            type: 'incomplete'
                        });
                    }
                }
            }

            // Sort by DOM index and reverse for chronological order
            turnCandidates.sort((a, b) => a.domIndex - b.domIndex);
            const chronologicalTurns = turnCandidates.reverse();
            chronologicalTurns.forEach((turn, i) => turn.chronIndex = i);

            log('getAllColumns:', chronologicalTurns.length, 'turns found');
            return chronologicalTurns;
        },

        getColumns: () => {
            const allTurns = LMArena.getAllColumns();
            if (allTurns.length === 0) return null;

            const completeTurns = allTurns.filter(t => t.type === 'complete');
            if (completeTurns.length === 0) return null;

            const last = completeTurns[completeTurns.length - 1];
            return {
                colA: last.colA,
                colB: last.colB,
                turnIndex: last.chronIndex,
                totalTurns: allTurns.length
            };
        },

        getModelName: (column) => {
            if (!column) return 'Unknown';

            const text = column.innerText?.trim() || '';
            const lines = text.split('\n');

            for (let i = 0; i < Math.min(5, lines.length); i++) {
                const line = lines[i].trim();
                if (!line || LMArena.isThoughtPrefix(line)) continue;
                const match = line.match(MODEL_REGEX);
                if (match) return match[1];
            }

            // Fallback: check if first non-empty line looks like a model name
            const firstLine = lines.find(l => l.trim() && !LMArena.isThoughtPrefix(l))?.trim() || '';
            if (/^[\w\-\.]+(-\d+k)?$/i.test(firstLine) && firstLine.length < 50) {
                if (MODEL_PATTERNS.some(p => firstLine.toLowerCase().startsWith(p))) {
                    return firstLine;
                }
            }

            return 'Unknown';
        },

        /**
         * Extract clean response text from a column, removing thinking blocks.
         * Uses clone-and-strip approach to avoid modifying the actual DOM.
         */
        getColumnText: (column) => {
            if (!column) return '';

            const clone = column.cloneNode(true);

            // Remove thinking blocks, user bubbles, and hidden elements
            const removeSelectors = [
                ...THINKING_BLOCK_SELECTORS,
                USER_BUBBLE_SELECTOR,
                '[style*="display: none"]', '[style*="display:none"]',
                '[style*="visibility: hidden"]', '[style*="visibility:hidden"]'
            ];
            
            for (const selector of removeSelectors) {
                try { clone.querySelectorAll(selector).forEach(el => el.remove()); } 
                catch (e) { /* invalid selector */ }
            }

            // Now extract text from prose elements in the cleaned clone
            const prose = clone.querySelectorAll('[class*="prose"]');

            if (prose.length > 0) {
                const texts = [];
                const seen = new Set();

                for (const el of prose) {
                    const text = el.innerText?.trim();
                    if (!text || text.length < 10 || seen.has(text)) continue;

                    // Check if this text is a substring of already captured text
                    let isSubstring = false;
                    for (const existing of texts) {
                        if (existing.includes(text)) {
                            isSubstring = true;
                            break;
                        }
                    }
                    if (isSubstring) continue;

                    // Remove any existing texts that are substrings of this new text
                    for (let i = texts.length - 1; i >= 0; i--) {
                        if (text.includes(texts[i])) {
                            seen.delete(texts[i]);
                            texts.splice(i, 1);
                        }
                    }

                    seen.add(text);
                    texts.push(text);
                }

                const result = texts.join('\n\n').trim();
                if (result) return stripCitations(result);
            }

            // Fallback: use full text from clone, skipping model name line
            const fullText = clone.innerText || '';
            const lines = fullText.split('\n');

            // Find first line that's not model name or thought prefix
            let startIndex = 0;
            for (let i = 0; i < Math.min(5, lines.length); i++) {
                const line = lines[i].trim();
                if (LMArena.isModelName(line) || LMArena.isThoughtPrefix(line) || !line) {
                    startIndex = i + 1;
                } else {
                    break;
                }
            }

            return stripCitations(lines.slice(startIndex).join('\n').trim());
        },

        getUserPrompts: () => {
            const prompts = [];
            const seen = new Set();
            const bubbles = document.querySelectorAll(USER_BUBBLE_SELECTOR);

            for (const bubble of bubbles) {
                const text = bubble.innerText?.trim();
                if (!text || text.length < 3 || seen.has(text)) continue;
                if (/^(Winner:|1\.\s*Winner|Vote|Regenerate)/i.test(text)) continue;
                if (text.split(/\s+/).length <= 2 && LMArena.isModelName(text)) continue;

                seen.add(text);
                prompts.push(text);
            }

            return prompts.reverse(); // DOM is reverse-chronological
        },

        getTurnCount: () => LMArena.getAllColumns().filter(t => t.type === 'complete').length
    };

    /** Generate the judge prompt with full conversation history */
    function generateJudgePrompt(prompts, responseA, responseB, modelA, modelB, turnIndex, allTurnsData) {
        log('generateJudgePrompt: turn', turnIndex + 1);

        const completeTurns = LMArena.getTurnCount();

        // Get the current prompt (the one being evaluated)
        const currentPrompt = prompts[turnIndex] || '[NO PROMPT DETECTED]';

        // Build FULL conversation history including responses from prior turns
        let historySection = '';
        if (turnIndex > 0 && allTurnsData && allTurnsData.length > 0) {
            const historyParts = [];

            for (let i = 0; i < turnIndex; i++) {
                const turnPrompt = prompts[i] || '[PROMPT NOT CAPTURED]';
                const turnData = allTurnsData[i];

                let turnSection = `### Turn ${i + 1} - User Prompt\n${turnPrompt}`;

                if (turnData) {
                    const isHiddenB = !turnData.responseB || turnData.responseB.includes('[HIDDEN');
                    
                    if (isHiddenB) {
                        turnSection += `\n\n[NOTE: This turn was already voted on. Model B's response is hidden.]`;
                    }

                    turnSection += `\n\n### Turn ${i + 1} - Model A (${turnData.modelA}) Response\n${turnData.responseA || '[NO RESPONSE]'}`;
                    turnSection += `\n\n### Turn ${i + 1} - Model B (${turnData.modelB}) Response\n${turnData.responseB || '[NO RESPONSE]'}`;
                }

                historyParts.push(turnSection);
            }

            if (historyParts.length > 0) {
                historySection = `## Full Conversation History\n"""\n${historyParts.join('\n\n---\n\n')}\n"""\n\n`;
            }
        }

        const turnLabel = turnIndex > 0
            ? `Current Turn Being Evaluated (Turn ${turnIndex + 1})`
            : 'User Prompt';

        // Enhanced incomplete turn note with actual pending prompt
        let incompleteNote = '';
        if (prompts.length > completeTurns) {
            const pendingCount = prompts.length - completeTurns;
            const nextPendingPrompt = prompts[completeTurns];
            const truncatedPrompt = nextPendingPrompt && nextPendingPrompt.length > 150
                ? nextPendingPrompt.slice(0, 150) + '...'
                : nextPendingPrompt || '[unknown]';
            incompleteNote = `\n\n_Note: Battle still in progress — ${pendingCount} additional prompt(s) awaiting responses. Next prompt: "${truncatedPrompt}"_\n`;
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

    // Cache for getColumnText results
    const columnTextCache = new WeakMap();

    function getCachedColumnText(column) {
        if (!column) return '';
        if (columnTextCache.has(column)) return columnTextCache.get(column);
        const text = LMArena.getColumnText(column);
        columnTextCache.set(column, text);
        return text;
    }

    function generateDebugOutput() {
        const allCols = LMArena.getAllColumns();
        const cols = LMArena.getColumns();
        const prompts = LMArena.getUserPrompts();

        // === RAW CONTAINER ANALYSIS ===
        const rawContainers = document.querySelectorAll('[class*="flex"][class*="-ml-4"]');
        const rawContainerInfo = Array.from(rawContainers).map((container, i) => {
            const children = Array.from(container.children);
            const thinkingBlockCounts = children.map(c => {
                let count = 0;
                for (const selector of THINKING_BLOCK_SELECTORS) {
                    try { count += c.querySelectorAll(selector).length; } catch(e) {}
                }
                return count;
            });

            return {
                index: i,
                childCount: children.length,
                childLengths: children.map(c => c.innerText?.length || 0),
                cleanedLengths: children.map(c => getCachedColumnText(c).length),
                thinkingBlockCounts: thinkingBlockCounts,
                firstChars: children.map(c => (c.innerText?.slice(0, 100) || '').replace(/\n/g, ' ')),
                containerClasses: getClassName(container).slice(0, 200),
                childClasses: children.map(c => getClassName(c).slice(0, 100)),
                isModelDetected: children.map(c => {
                    const text = c.innerText?.slice(0, 150) || '';
                    return LMArena.isModelName(text) || LMArena.isThoughtPrefix(text);
                })
            };
        });

        // === VALIDATED TURNS ===
        const allTurnsData = allCols.map((turn) => ({
            chronIndex: turn.chronIndex,
            domIndex: turn.domIndex,
            type: turn.type,
            modelA: LMArena.getModelName(turn.colA),
            modelB: turn.colB ? LMArena.getModelName(turn.colB) : '[HIDDEN]',
            responseALength: getCachedColumnText(turn.colA).length,
            responseBLength: turn.colB ? getCachedColumnText(turn.colB).length : 0,
            responseAPreview: getCachedColumnText(turn.colA).slice(0, 200),
            responseBPreview: turn.colB ? getCachedColumnText(turn.colB).slice(0, 200) : '[HIDDEN]'
        }));

        // === USER PROMPT BUBBLES ===
        const userBubbles = document.querySelectorAll(USER_BUBBLE_SELECTOR);
        const userBubbleInfo = Array.from(userBubbles).map((bubble, i) => ({
            index: i,
            length: bubble.innerText?.length || 0,
            preview: (bubble.innerText?.slice(0, 150) || '').replace(/\n/g, ' '),
            classes: getClassName(bubble).slice(0, 150)
        }));

        // === PROSE ELEMENTS (potential response content) ===
        const allProseElements = document.querySelectorAll('[class*="prose"]');
        const proseInfo = Array.from(allProseElements).slice(0, 30).map((el, i) => ({
            index: i,
            length: el.innerText?.length || 0,
            preview: (el.innerText?.slice(0, 150) || '').replace(/\n/g, ' '),
            classes: getClassName(el).slice(0, 100),
            parentClasses: getClassName(el.parentElement).slice(0, 100),
            grandparentClasses: getClassName(el.parentElement?.parentElement).slice(0, 100)
        }));

        // === DOM INSPECTION FOR HIDDEN/VOTED CONTENT ===
        const domInspection = {
            // Winner/voting related
            winnerElements: document.querySelectorAll('[class*="winner"]').length,
            votedElements: document.querySelectorAll('[class*="voted"]').length,
            selectedElements: document.querySelectorAll('[class*="selected"]').length,

            // Collapsed/hidden sections
            detailsElements: document.querySelectorAll('details').length,
            detailsOpen: document.querySelectorAll('details[open]').length,
            hiddenElements: document.querySelectorAll('[hidden]').length,
            ariaHiddenElements: document.querySelectorAll('[aria-hidden="true"]').length,
            collapsedElements: document.querySelectorAll('[class*="collapse"]').length,

            // History/archive sections
            historyElements: document.querySelectorAll('[class*="history"]').length,
            archiveElements: document.querySelectorAll('[class*="archive"]').length,
            pastElements: document.querySelectorAll('[class*="past"]').length,

            // Turn/round markers
            turnElements: document.querySelectorAll('[class*="turn"]').length,
            roundElements: document.querySelectorAll('[class*="round"]').length,

            // Message/chat structure
            messageElements: document.querySelectorAll('[class*="message"]').length,
            chatElements: document.querySelectorAll('[class*="chat"]').length,
            conversationElements: document.querySelectorAll('[class*="conversation"]').length,

            // Response containers
            responseElements: document.querySelectorAll('[class*="response"]').length,
            answerElements: document.querySelectorAll('[class*="answer"]').length,
            replyElements: document.querySelectorAll('[class*="reply"]').length,

            // Model mentions in page text (rough indicator of how many responses exist)
            modelMentionsInText: {
                claude: (document.body.innerText.match(/claude/gi) || []).length,
                gpt: (document.body.innerText.match(/gpt/gi) || []).length,
                gemini: (document.body.innerText.match(/gemini/gi) || []).length,
                grok: (document.body.innerText.match(/grok/gi) || []).length,
                llama: (document.body.innerText.match(/llama/gi) || []).length,
                mistral: (document.body.innerText.match(/mistral/gi) || []).length
            },

            // Page metrics
            totalPageTextLength: document.body.innerText.length,
            totalElementCount: document.querySelectorAll('*').length
        };

        // === SELECTOR COUNTS ===
        const selectors = {
            // Primary selectors
            flexMl4Containers: rawContainers.length,
            proseElements: allProseElements.length,
            userBubbles: userBubbles.length,

            // Thinking block selectors
            detailsElements: document.querySelectorAll('details').length,
            thinkingClassElements: document.querySelectorAll('[class*="thinking"]').length,
            reasoningClassElements: document.querySelectorAll('[class*="reasoning"]').length,
            thoughtClassElements: document.querySelectorAll('[class*="thought"]').length,

            // Alternative container patterns we've tried
            flexGapContainers: document.querySelectorAll('[class*="flex"][class*="gap"]').length,
            gridColContainers: document.querySelectorAll('[class*="grid"][class*="col"]').length,
            compareContainers: document.querySelectorAll('[class*="compare"]').length,
            battleContainers: document.querySelectorAll('[class*="battle"]').length
        };

        // === SAMPLE OF ALL FLEX CONTAINERS (to find new patterns) ===
        const allFlexContainers = document.querySelectorAll('[class*="flex"]');
        const flexContainerSample = Array.from(allFlexContainers)
            .filter(el => el.children.length === 2)
            .slice(0, 20)
            .map((el, i) => ({
                index: i,
                classes: getClassName(el).slice(0, 150),
                childCount: el.children.length,
                child0Length: el.children[0]?.innerText?.length || 0,
                child1Length: el.children[1]?.innerText?.length || 0,
                child0Preview: (el.children[0]?.innerText?.slice(0, 80) || '').replace(/\n/g, ' '),
                child1Preview: (el.children[1]?.innerText?.slice(0, 80) || '').replace(/\n/g, ' ')
            }));

        const completeTurnCount = allCols.filter(t => t.type === 'complete').length;
        const votedTurnCount = allCols.filter(t => t.type === 'voted').length;
        const incompleteTurnCount = allCols.filter(t => t.type === 'incomplete').length;

        return JSON.stringify({
            // Meta
            scriptVersion: VERSION,
            timestamp: new Date().toISOString(),
            url: window.location.href,

            // Summary
            turnCount: completeTurnCount,
            votedTurnCount: votedTurnCount,
            incompleteTurnCount: incompleteTurnCount,
            totalTurnsDetected: allCols.length,
            columnsFound: !!cols,
            promptsFound: prompts.length,
            promptResponseAlignment: prompts.length === completeTurnCount
                ? 'aligned'
                : `mismatch (${prompts.length} prompts, ${completeTurnCount} complete, ${votedTurnCount} voted, ${incompleteTurnCount} incomplete)`,

            // Current evaluation target
            currentTurnIndex: cols ? cols.turnIndex : null,
            modelA: cols ? LMArena.getModelName(cols.colA) : null,
            modelB: cols ? LMArena.getModelName(cols.colB) : null,
            responseALength: cols ? getCachedColumnText(cols.colA).length : 0,
            responseBLength: cols ? getCachedColumnText(cols.colB).length : 0,

            // Full data
            promptsFull: prompts,
            promptsPreview: prompts.map(p => p.slice(0, 200) + (p.length > 200 ? '...' : '')),
            allTurns: allTurnsData,

            // Raw DOM analysis
            rawContainers: rawContainerInfo,
            userBubbleInfo: userBubbleInfo,
            proseElementsDetail: proseInfo,
            flexContainerSample: flexContainerSample,

            // Counts and inspection
            selectors: selectors,
            domInspection: domInspection,

            // Config
            thinkingBlockSelectors: THINKING_BLOCK_SELECTORS,
            userBubbleSelector: USER_BUBBLE_SELECTOR
        }, null, 2);
    }

    // Debounced button creation
    let createButtonsTimeout = null;

    function createButtons() {
        if (document.getElementById('lmarena-judge-btn')) return;

        log('createButtons: Creating button container...');

        const container = document.createElement('div');
        container.id = 'lmarena-judge-btn';
        container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:10000;display:flex;gap:8px;';

        const judgeBtn = document.createElement('button');
        judgeBtn.textContent = 'Judge';
        judgeBtn.style.cssText = 'padding:8px 14px;font-size:13px;background:#6366f1;color:white;border:none;border-radius:4px;cursor:pointer;';

        judgeBtn.addEventListener('click', async () => {
            const cols = LMArena.getColumns();
            if (!cols) {
                alert('No battle responses found. Make sure both models have responded.');
                return;
            }

            const prompts = LMArena.getUserPrompts();
            const allPairs = LMArena.getAllColumns();

            const allTurnsData = allPairs.map((turn) => ({
                chronIndex: turn.chronIndex,
                modelA: LMArena.getModelName(turn.colA),
                modelB: turn.colB ? LMArena.getModelName(turn.colB) : '[HIDDEN]',
                responseA: getCachedColumnText(turn.colA),
                responseB: turn.colB ? getCachedColumnText(turn.colB) : '[HIDDEN - vote already cast]'
            }));

            const responseA = getCachedColumnText(cols.colA);
            const responseB = getCachedColumnText(cols.colB);
            const modelA = LMArena.getModelName(cols.colA);
            const modelB = LMArena.getModelName(cols.colB);

            log('Extraction:', prompts.length, 'prompts,', allTurnsData.length, 'turns');

            const judgePrompt = generateJudgePrompt(
                prompts, responseA, responseB, modelA, modelB, cols.turnIndex, allTurnsData
            );

            try {
                await navigator.clipboard.writeText(judgePrompt);
                judgeBtn.textContent = 'Copied!';
                judgeBtn.style.background = '#22c55e';
                setTimeout(() => {
                    judgeBtn.textContent = 'Judge';
                    judgeBtn.style.background = '#6366f1';
                }, 1500);
            } catch (e) {
                // Fallback: show textarea for manual copy
                const textarea = document.createElement('textarea');
                textarea.value = judgePrompt;
                textarea.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:80%;height:60%;z-index:10001;';
                document.body.appendChild(textarea);
                textarea.select();
                alert('Clipboard access denied. Text is selected in the textarea - press Ctrl+C to copy, then click outside to close.');
                textarea.addEventListener('blur', () => textarea.remove());
            }
        });

        const debugBtn = document.createElement('button');
        debugBtn.textContent = 'Debug';
        debugBtn.style.cssText = 'padding:8px 14px;font-size:13px;background:#666;color:white;border:none;border-radius:4px;cursor:pointer;';

        debugBtn.addEventListener('click', async () => {
            const debugOutput = generateDebugOutput();
            try {
                await navigator.clipboard.writeText(debugOutput);
                debugBtn.textContent = 'Copied!';
                debugBtn.style.background = '#22c55e';
                setTimeout(() => {
                    debugBtn.textContent = 'Debug';
                    debugBtn.style.background = '#666';
                }, 1500);
            } catch (e) {
                console.log(debugOutput);
                alert('Debug output logged to console (clipboard unavailable)');
            }
        });

        container.appendChild(judgeBtn);
        container.appendChild(debugBtn);
        document.body.appendChild(container);
    }

    function debouncedCreateButtons() {
        if (createButtonsTimeout) {
            clearTimeout(createButtonsTimeout);
        }
        createButtonsTimeout = setTimeout(createButtons, 500);
    }

    // Initialize
    createButtons();
    const observer = new MutationObserver(debouncedCreateButtons);
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Cleanup on page unload to prevent memory leaks in SPA navigation
    window.addEventListener('unload', () => {
        observer.disconnect();
        if (createButtonsTimeout) clearTimeout(createButtonsTimeout);
    });

    log('Initialized');
})();