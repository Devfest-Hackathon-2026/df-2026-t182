// Japanese line breaking at phrase boundaries (文節), so words never split across lines.
// Uses Intl.Segmenter (Safari 14.1+, Chrome 87+). Text nodes are replaced by inline-block
// spans, one per phrase; the browser then wraps only between them. Runs on any text added later too.
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
const SKIP = 'script,style,input,textarea,select,canvas,svg,code,pre,h1.glitch-text,.no-phrase,.ph,#column,#phone';
const CLOSE = /^[、。，．」』）\]｝〕〉》!?！？…‥：；:;,.・ー〜～]/;
const OPEN = /[「『（(\[｛〔〈《]$/;
const END = /[。！？!?」』]$/;
const KANA = /^[぀-ゟ]+$/;
const KANJI = /^[\u4e00-\u9fff]+$/;

export function phrases(text) {
  if (!seg || !/[぀-ヿ一-鿿]/.test(text)) return [text];
  const out = [];
  for (const { segment, isWordLike } of seg.segment(text)) {
    const i = out.length - 1; const prev = out[i];
    if (prev === undefined) { out.push(segment); continue; }
    const glue = !isWordLike                                   // punctuation, spaces
      || CLOSE.test(segment) || OPEN.test(prev)                // closing marks stay, opening marks pull the next word
      || (KANJI.test(segment) && /[\u4e00-\u9fff]$/.test(prev) && prev.length < 9) // compound nouns: 制御+盤, 津波+警報
      || (KANA.test(segment) && segment.length <= 4 && !END.test(prev) && prev.length < 9); // particles / auxiliaries
    if (glue) out[i] += segment; else out.push(segment);
  }
  return out;
}

function fragment(text) {
  const frag = document.createDocumentFragment();
  text.split('\n').forEach((line, n) => {
    if (n) frag.append(document.createElement('br'));
    for (const p of phrases(line)) { if (!p) continue; const s = document.createElement('span'); s.className = 'ph'; s.textContent = p; frag.append(s); }
  });
  return frag;
}

function process(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement; if (!parent || parent.closest(SKIP)) return;
    const text = node.data; if (!text.trim() || !/[぀-ヿ一-鿿]/.test(text)) return;
    parent.replaceChild(fragment(text), node);
  } else if (node.nodeType === Node.ELEMENT_NODE && !node.matches(SKIP)) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const nodes = []; let t; while ((t = walker.nextNode())) nodes.push(t);
    nodes.forEach(process);
  }
}

export function watch(root = document.body) {
  if (!seg) return;
  process(root);
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'characterData') process(r.target);
      else r.addedNodes.forEach(process);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => watch());
else watch();
