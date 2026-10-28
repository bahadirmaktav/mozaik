import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { rust } from '@codemirror/lang-rust';
import { editorStates, getDocument, hasDocument, subscribe, updateDocument } from './documents';
import type { ViewProps } from '../contract';

function language(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['js', 'jsx', 'ts', 'tsx'].includes(ext ?? '')) return javascript({ typescript: ext === 'ts' || ext === 'tsx', jsx: ext === 'jsx' || ext === 'tsx' });
  return ext === 'json' ? json() : ext === 'md' ? markdown() : ext === 'css' ? css() : ext === 'html' ? html() : ext === 'rs' ? rust() : [];
}
const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#16191e', color: '#dce0e6', fontSize: '13px' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'Consolas, "Liberation Mono", monospace', lineHeight: '1.6' },
  '.cm-content': { caretColor: '#dce0e6', padding: '12px 0' },
  '.cm-gutters': { backgroundColor: '#16191e', color: '#626e7e', border: 'none' },
  '.cm-activeLine': { backgroundColor: '#ffffff04' },
  '.cm-cursor': { borderLeftColor: '#dce0e6' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#37564f !important' },
  '&.cm-focused': { outline: 'none' },
}, { dark: true });

export default function Editor({ instanceId }: ViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [goTo, setGoTo] = useState(false), [line, setLine] = useState('1');
  useEffect(() => {
    const doc = getDocument(instanceId);
    const state = editorStates.get(instanceId) ?? EditorState.create({ doc: doc.text, extensions: [
      lineNumbers(), drawSelection(), history(), indentOnInput(), highlightActiveLine(),
      EditorState.allowMultipleSelections.of(false),
      keymap.of([{ key: 'Mod-g', run: () => { setGoTo(true); return true; } }, ...defaultKeymap.filter(k => !k.key?.includes('Mod-Alt')), ...historyKeymap, indentWithTab]),
      syntaxHighlighting(defaultHighlightStyle), language(doc.name), theme,
      EditorView.contentAttributes.of({ 'aria-label': `Editor ${doc.name}`, spellcheck: 'false' }),
    ] });
    const view = new EditorView({ state, parent: host.current!, dispatch: transaction => {
      view.update([transaction]);
      editorStates.set(instanceId, view.state);
      if (transaction.docChanged) updateDocument(instanceId, { text: view.state.doc.toString() });
    } });
    const unsubscribe = subscribe(() => {
      if (!hasDocument(instanceId)) return;
      const current = getDocument(instanceId);
      if (current.text !== view.state.doc.toString()) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: current.text } });
      }
    });
    viewRef.current = view; view.focus();
    return () => { unsubscribe(); if (hasDocument(instanceId)) editorStates.set(instanceId, view.state); view.destroy(); viewRef.current = null; };
  }, [instanceId]);
  return <div className="editor-wrapper"><div className="editor-host" ref={host} />{goTo && <form className="goto" onSubmit={event => {
    event.preventDefault(); const view = viewRef.current; if (!view) return;
    const number = Math.max(1, Math.min(view.state.doc.lines, Number(line) || 1));
    view.dispatch({ selection: { anchor: view.state.doc.line(number).from }, scrollIntoView: true }); setGoTo(false); view.focus();
  }}><label>Go to line <input aria-label="Line number" type="number" min="1" autoFocus value={line} onChange={e => setLine(e.target.value)} /></label><button>Go</button><button type="button" onClick={() => setGoTo(false)}>Cancel</button></form>}</div>;
}
