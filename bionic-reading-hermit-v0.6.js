// ==UserScript==
// @name         Bionic Reading (Auto)
// @namespace    bionic06
// @version      0.6
// @description  Bolds the first part of words (Bionic Reading). Auto-updates on SPA / infinite-scroll pages.
// @match        *://*/*
// ==/UserScript==

(function () {
  'use strict';

  if (window.__bionicV6) return;
  window.__bionicV6 = true;

  // ---------- Config ----------
  var BOLD_RATIO  = 0.4;
  var BOLD_CLASS  = '__bionic_hb_v6';
  var DEBOUNCE_MS = 200;

  var SKIP_TAGS = {
    SCRIPT:1, STYLE:1, NOSCRIPT:1, TEXTAREA:1, INPUT:1, SELECT:1,
    OPTION:1, CODE:1, PRE:1, KBD:1, SAMP:1, VAR:1, SVG:1, MATH:1,
    CANVAS:1, IFRAME:1, HEAD:1, TITLE:1, META:1, LINK:1, BUTTON:1
  };

  // ---------- Word-char test (ES5, no \p{L}) ----------
  function isWordChar(ch) {
    var c = ch.charCodeAt(0);
    if (c >= 48 && c <= 57) return true;
    if (c >= 65 && c <= 90) return true;
    if (c >= 97 && c <= 122) return true;
    if (c >= 192 && c <= 255) return true;
    return false;
  }

  function boldLengthFor(word) {
    var letters = 0;
    for (var i = 0; i < word.length; i++) {
      if (isWordChar(word.charAt(i))) letters++;
    }
    if (letters === 0) return 0;
    var n = Math.round(letters * BOLD_RATIO);
    if (n < 1) n = 1;
    if (n > 5) n = 5;
    if (n > word.length) n = word.length;
    return n;
  }

  function hasClass(el, name) {
    if (!el || el.nodeType !== 1) return false;
    var c = el.className;
    if (!c) return false;
    if (typeof c === 'string') return c.indexOf(name) !== -1;
    // SVGAnimatedString etc.
    if (typeof c.baseVal === 'string') return c.baseVal.indexOf(name) !== -1;
    return false;
  }

  // Has this text node already been produced by us? (its immediate previous
  // element sibling is one of our bold spans)
  function isAlreadyProcessed(node) {
    var prev = node.previousSibling;
    if (prev && prev.nodeType === 1 && hasClass(prev, BOLD_CLASS)) return true;
    return false;
  }

  function shouldProcess(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS[el.tagName]) return false;
    if (hasClass(el, BOLD_CLASS)) return false;
    if (el.isContentEditable) return false;
    return true;
  }

  // ---------- Process a single text node ----------
  function processTextNode(node) {
    var text = node.nodeValue;
    if (!text || !/\S/.test(text)) return;
    if (isAlreadyProcessed(node)) return;

    var frag = document.createDocumentFragment();
    var i = 0, len = text.length, buf = '';

    while (i < len) {
      var ch = text.charAt(i);
      if (isWordChar(ch)) {
        if (buf) { frag.appendChild(document.createTextNode(buf)); buf = ''; }
        var start = i;
        while (i < len && isWordChar(text.charAt(i))) i++;
        var word = text.substring(start, i);
        var n = boldLengthFor(word);
        if (n > 0 && n < word.length) {
          var sp = document.createElement('span');
          sp.className = BOLD_CLASS;
          sp.style.fontWeight = '700';
          sp.textContent = word.substring(0, n);
          frag.appendChild(sp);
          frag.appendChild(document.createTextNode(word.substring(n)));
        } else {
          frag.appendChild(document.createTextNode(word));
        }
      } else {
        buf += ch;
        i++;
      }
    }
    if (buf) frag.appendChild(document.createTextNode(buf));

    try {
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    } catch (e) {}
  }

  // ---------- Walk a subtree ----------
  function walk(root) {
    if (!root || !root.nodeType) return;
    var nodes = [];
    try {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
      var n;
      while ((n = walker.nextNode())) {
        var p = n.parentElement;
        if (p && shouldProcess(p) && n.nodeValue && /\S/.test(n.nodeValue) && !isAlreadyProcessed(n)) {
          nodes.push(n);
        }
      }
    } catch (e) { return; }
    for (var i = 0; i < nodes.length; i++) processTextNode(nodes[i]);
  }

  // ---------- Undo ----------
  function clearAll() {
    var spans = document.getElementsByClassName(BOLD_CLASS);
    var arr = [];
    var i;
    for (i = 0; i < spans.length; i++) arr.push(spans[i]);
    for (i = 0; i < arr.length; i++) {
      var sp = arr[i];
      var tn = document.createTextNode(sp.textContent);
      if (sp.parentNode) {
        try { sp.parentNode.replaceChild(tn, sp); } catch (e) {}
      }
    }
  }

  // ---------- Observer ----------
  var observer = null;
  var pendingRoots = null;
  var pendingTimer = null;

  function scheduleFlush() {
    if (pendingTimer) return;
    pendingTimer = setTimeout(flush, DEBOUNCE_MS);
  }

  function flush() {
    pendingTimer = null;
    var roots = pendingRoots;
    pendingRoots = null;
    if (!enabled || !roots) return;

    if (observer) observer.disconnect();
    try {
      for (var i = 0; i < roots.length; i++) {
        var r = roots[i];
        if (r && r.nodeType === 1 && document.body && document.body.contains(r)) {
          walk(r);
        }
      }
    } catch (e) {}
    if (observer && enabled && document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function startObserver() {
    if (observer || typeof MutationObserver === 'undefined' || !document.body) return;
    observer = new MutationObserver(function (mutations) {
      if (!enabled) return;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        for (var j = 0; j < m.addedNodes.length; j++) {
          var nd = m.addedNodes[j];
          if (!nd) continue;
          if (nd.nodeType === 1) {
            if (hasClass(nd, BOLD_CLASS)) continue;
            if (!pendingRoots) pendingRoots = [];
            pendingRoots.push(nd);
          } else if (nd.nodeType === 3) {
            var p = nd.parentElement;
            if (p && shouldProcess(p) && !isAlreadyProcessed(nd)) {
              if (!pendingRoots) pendingRoots = [];
              pendingRoots.push(p);
            }
          }
        }
      }
      if (pendingRoots && pendingRoots.length) scheduleFlush();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) { observer.disconnect(); observer = null; }
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    pendingRoots = null;
  }

  // ---------- Button ----------
  var enabled = true;
  var btn = null;

  function updateBtn() {
    if (!btn) return;
    btn.textContent = enabled ? 'B: ON' : 'B: OFF';
    btn.style.background = enabled ? '#4d6bfe' : '#888888';
  }

  function createBtn() {
    if (btn || !document.body) return;
    btn = document.createElement('div');
    btn.id = '__bionic_btn_v6';
    btn.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:2147483647;' +
      'background:#4d6bfe;color:#ffffff;padding:10px 14px;border-radius:20px;' +
      'font:bold 13px sans-serif;cursor:pointer;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.3);' +
      'user-select:none;-webkit-user-select:none;touch-action:manipulation;';
    btn.onclick = function (e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      enabled = !enabled;
      if (enabled) {
        walk(document.body);
        startObserver();
      } else {
        stopObserver();
        clearAll();
      }
      updateBtn();
    };
    document.body.appendChild(btn);
    updateBtn();
  }

  // ---------- Init ----------
  function init() {
    if (!document.body) { setTimeout(init, 100); return; }
    createBtn();
    if (enabled) {
      try {
        walk(document.body);
        startObserver();
      } catch (e) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
