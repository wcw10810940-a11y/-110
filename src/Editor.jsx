import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo } from 'react'
import { EditorState, TextSelection, Plugin, PluginKey } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, setBlockType, toggleMark } from 'prosemirror-commands'
import { DOMParser, Node } from 'prosemirror-model' 
import { InputRule, inputRules, textblockTypeInputRule } from 'prosemirror-inputrules'
import { scriptSchema } from './schema'

const tagMenuKey = new PluginKey('tagMenu')

function parseSceneText(rawText) {
  const text = rawText.replace(/^S\d+[\.\s]*/i, '').trim()
  let inOut = '', loc = text, time = '', tags = ''
  const tagMatch = loc.match(/(.*?)\s*\((.*?)\)$/)
  if (tagMatch) { loc = tagMatch[1]; tags = tagMatch[2] }
  const timeMatch = loc.match(/(.*?)(?:\s*-\s*(.*)|\s+(日|夜|晨|昏|DAY|NIGHT))$/i)
  if (timeMatch) { loc = timeMatch[1]; time = timeMatch[2] || timeMatch[3]; }
  const inOutMatch = loc.match(/^(內\.|外\.|內外\.|內\/外\.|INT\.|EXT\.|I\/E\.|內|外)\s*(.*)$/)
  if (inOutMatch) { inOut = inOutMatch[1]; loc = inOutMatch[2] }
  return { inOut: inOut.trim(), loc: loc.replace(/-$/, '').trim(), time: time.trim(), tags: tags.trim(), cleanText: text }
}

const autoNumberingPlugin = new Plugin({
  appendTransaction: (transactions, oldState, newState) => {
    if (!transactions.some(tr => tr.docChanged)) return null
    let idx = 1
    const updates = []
    newState.doc.descendants((node, pos) => {
      if (node.type.name === 'scene_heading') {
        const cleanText = node.textContent.replace(/^S\d+[\.\s]*/i, '').trimStart()
        const targetText = cleanText ? `S${idx}. ${cleanText}` : `S${idx}. `
        if (node.textContent !== targetText) updates.push({ pos, text: targetText, oldLen: node.textContent.length })
        idx++
      }
    })
    if (updates.length === 0) return null
    const tr = newState.tr
    for (let i = updates.length - 1; i >= 0; i--) tr.insertText(updates[i].text, updates[i].pos + 1, updates[i].pos + 1 + updates[i].oldLen)
    return tr
  }
})

const buildInputRules = () => {
  return inputRules({
    rules: [
      new InputRule(/^#\s$/, (state, match, start, end) => {
        const tr = state.tr
        const newHeading = scriptSchema.nodes.scene_heading.createAndFill()
        tr.replaceWith(start, end, newHeading)
        tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1)))
        return tr
      }),
      textblockTypeInputRule(/^@\s$/, scriptSchema.nodes.character),
      new InputRule(/(?:\*\*)([^*]+)(?:\*\*)$/, (state, match, start, end) => {
          return state.tr.addMark(start, end, scriptSchema.marks.bold.create())
      }),
      new InputRule(/(?:\*)([^*_]+)(?:\*)$/, (state, match, start, end) => {
          return state.tr.addMark(start, end, scriptSchema.marks.italic.create())
      })
    ]
  })
}

const backspaceCommand = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty) return false
  if ($from.parent.type.name === 'scene_heading') {
    const textContent = $from.parent.textContent
    const prefixMatch = textContent.match(/^S\d+[\.\s]*/)
    const prefixLen = prefixMatch ? prefixMatch[0].length : 0
    if ($from.parentOffset <= prefixLen) {
      if (dispatch) {
        const remainingText = textContent.substring(prefixLen)
        const newAction = scriptSchema.nodes.action.create(null, remainingText ? scriptSchema.text(remainingText) : null)
        dispatch(state.tr.replaceWith($from.before(), $from.after(), newAction).scrollIntoView())
      }
      return true
    }
  }
  return false
}

const Editor = forwardRef(({ onSceneContextChange }, ref) => {
  const editorDOMRef = useRef(null)
  const viewRef = useRef(null)
  const tagsDataRef = useRef({ locs: [], times: [], tags: [] })
  const [menuData, setMenuData] = useState({ active: false, coords: null, query: '', menuType: null, from: 0, to: 0 })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const pmMenuRef = useRef({ active: false, query: '', menuType: null, from: 0, to: 0, setSelectedIndex: null, insertTag: null, closeMenu: null })

  const options = useMemo(() => {
     if (!menuData.active) return []
     let all = []
     if (menuData.menuType === 'inOut') all = ['內.', '外.', '內/外.'].map(t => ({ text: t, type: 'inOut', label: '內/外' }))
     else if (menuData.menuType === 'loc') all = tagsDataRef.current.locs.map(t => ({ text: t, type: 'loc', label: '地點' }))
     else if (menuData.menuType === 'time') all = ['日', '夜', '晨', '昏', ...tagsDataRef.current.times].map(t => ({ text: t, type: 'time', label: '時間' }))
     else if (menuData.menuType === 'tag') all = tagsDataRef.current.tags.map(t => ({ text: t, type: 'tag', label: '標記' }))
     let filtered = all.filter(o => o.text.toLowerCase().includes(menuData.query.toLowerCase()))
     if (menuData.query.trim().length > 0) filtered.push({ text: menuData.query, type: 'new', label: '自訂' })
     return filtered.filter((v, i, a) => a.findIndex(t => (t.text === v.text)) === i)
  }, [menuData.query, menuData.active, menuData.menuType])

  useEffect(() => {
     pmMenuRef.current.setSelectedIndex = setSelectedIndex
     pmMenuRef.current.closeMenu = () => setMenuData(prev => ({ ...prev, active: false }))
     pmMenuRef.current.insertTag = () => {
        const sel = options[pmMenuRef.current.selectedIndex]
        if (sel && viewRef.current) {
           const view = viewRef.current
           let txt = sel.text;
           if (pmMenuRef.current.menuType === 'inOut' || pmMenuRef.current.menuType === 'loc') txt += ' ';
           if (pmMenuRef.current.menuType === 'time') txt = `- ${txt} `;
           if (pmMenuRef.current.menuType === 'tag') txt = `(${txt}) `;
           view.dispatch(view.state.tr.replaceWith(pmMenuRef.current.from, pmMenuRef.current.to, view.state.schema.text(txt)))
           setMenuData(prev => ({ ...prev, active: false }))
        }
     }
  }, [options])

  useImperativeHandle(ref, () => ({
    scrollToPos: (pos) => {
      if (viewRef.current) {
        const tr = viewRef.current.state.tr.setSelection(TextSelection.create(viewRef.current.state.doc, pos + 1))
        viewRef.current.dispatch(tr)
        viewRef.current.focus()
      }
    },
    moveSceneBlock: (oldIdx, newIdx) => {
      if (!viewRef.current) return
      const headings = []
      viewRef.current.state.doc.descendants((n, p) => { if (n.type.name === 'scene_heading') headings.push({ node: n, pos: p }) })
      const start = headings[oldIdx].pos, end = oldIdx + 1 < headings.length ? headings[oldIdx + 1].pos : viewRef.current.state.doc.content.size
      const slice = viewRef.current.state.doc.slice(start, end)
      let tr = viewRef.current.state.tr.delete(start, end)
      const insPos = newIdx >= headings.length - 1 && newIdx >= oldIdx ? tr.doc.content.size : tr.mapping.map(headings[newIdx > oldIdx ? newIdx + 1 : newIdx].pos)
      viewRef.current.dispatch(tr.insert(insPos, slice.content))
    },
    applyFormat: (type, attrs) => {
      if (!viewRef.current) return
      const { state, dispatch } = viewRef.current
      if (type === 'bold') toggleMark(scriptSchema.marks.bold)(state, dispatch)
      if (type === 'italic') toggleMark(scriptSchema.marks.italic)(state, dispatch)
      if (type === 'block') setBlockType(scriptSchema.nodes[attrs])(state, dispatch)
      viewRef.current.focus()
    }
  }))

  useEffect(() => {
    const saved = localStorage.getItem('script-studio-data')
    const state = EditorState.create({ 
      doc: saved ? Node.fromJSON(scriptSchema, JSON.parse(saved)) : DOMParser.fromSchema(scriptSchema).parse(Object.assign(document.createElement('div'), { innerHTML: `<h3 class="scene-heading">S1. 內. 工作室 - 日</h3><p class="action">歡迎使用！點選上方選單的「新手導覽」了解如何高效寫作。</p>` })),
      plugins: [ 
        autoNumberingPlugin, 
        new Plugin({
          key: tagMenuKey,
          props: {
            handleKeyDown(view, event) {
              if (!pmMenuRef.current.active) return false
              if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIndex(i => Math.min(i + 1, options.length - 1)); return true }
              if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); return true }
              if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); pmMenuRef.current.insertTag(); return true }
              if (event.key === 'Escape') { event.preventDefault(); pmMenuRef.current.closeMenu(); return true }
              return false
            }
          },
          view() {
            return {
              update(view) {
                const { $from, empty } = view.state.selection
                if (!empty || $from.parent.type.name !== 'scene_heading') { setMenuData(p => ({ ...p, active: false })); pmMenuRef.current.active = false; return }
                const textBefore = $from.parent.textBetween(0, $from.parentOffset)
                let q = null, mt = null, ml = 0
                const mIn = textBefore.match(/\/([^\s/]*)$/), mLoc = textBefore.match(/#([^\s#]*)$/), mTim = textBefore.match(/-([^\s-]*)$/), mTag = textBefore.match(/\(([^\s()]*)$/)
                if (mIn) { q = mIn[1]; mt = 'inOut'; ml = mIn[0].length }
                else if (mLoc) { q = mLoc[1]; mt = 'loc'; ml = mLoc[0].length }
                else if (mTim) { q = mTim[1]; mt = 'time'; ml = mTim[0].length }
                else if (mTag) { q = mTag[1]; mt = 'tag'; ml = mTag[0].length }
                if (mt) {
                  const coords = view.coordsAtPos($from.pos)
                  pmMenuRef.current = { ...pmMenuRef.current, active: true, query: q, menuType: mt, from: $from.pos - ml, to: $from.pos }
                  setMenuData({ active: true, query: q, menuType: mt, coords: { top: coords.bottom + 4, left: coords.left } })
                } else { setMenuData(p => ({ ...p, active: false })); pmMenuRef.current.active = false }
              }
            }
          }
        }),
        buildInputRules(),
        keymap({ "Tab": (s, d) => {
            const { $from } = s.selection; let nt;
            const ct = $from.parent.type.name;
            if (ct === 'action') nt = scriptSchema.nodes.character;
            else if (ct === 'character') nt = scriptSchema.nodes.dialogue;
            else if (ct === 'dialogue') nt = scriptSchema.nodes.scene_heading;
            else nt = scriptSchema.nodes.action;
            if (d) setBlockType(nt)(s, d); return true;
        }, "Enter": (s, d) => {
            const { $from } = s.selection; const ct = $from.parent.type.name;
            if (ct === 'character' && d) d(s.tr.insert($from.pos, scriptSchema.nodes.dialogue.createAndFill()).setSelection(TextSelection.near(s.tr.doc.resolve($from.pos + 1))).scrollIntoView());
            else if ((ct === 'dialogue' || ct === 'scene_heading') && d) d(s.tr.insert($from.pos, scriptSchema.nodes.action.createAndFill()).setSelection(TextSelection.near(s.tr.doc.resolve($from.pos + 1))).scrollIntoView());
            else if (ct === 'action' && $from.parent.textContent.trim() === "" && d) d(s.tr.replaceWith($from.before(), $from.after(), scriptSchema.nodes.scene_heading.createAndFill()).setSelection(TextSelection.near(s.tr.doc.resolve($from.before() + 1))).scrollIntoView());
            else return false; return true;
        }, "Backspace": backspaceCommand }),
        keymap(baseKeymap) 
      ] 
    })
    viewRef.current = new EditorView(editorDOMRef.current, {
      state, dispatchTransaction(tr) {
        const next = viewRef.current.state.apply(tr); viewRef.current.updateState(next)
        
        // 🌟 效能修復點：只有在「文件內容真正改變」時，才重新掃描大綱與更新全文，游標單純移動時絕對不執行！
        if (tr.docChanged) {
          const h = []; const locs = new Set(), times = new Set(), tags = new Set()
          let i = 1; next.doc.descendants((n, p) => { if (n.type.name === 'scene_heading') { const ps = parseSceneText(n.textContent); if (ps.loc) locs.add(ps.loc); if (ps.time) times.add(ps.time); if (ps.tags) tags.add(ps.tags); h.push({ id: `scene-${i}`, ...ps, num: `S${i++}`, pos: p }) } })
          tagsDataRef.current = { locs: Array.from(locs), times: Array.from(times), tags: Array.from(tags) }
          let ftext = ""; next.doc.descendants(n => { if (n.isBlock && n.textContent) { if (n.type.name === 'scene_heading' || n.type.name === 'character') ftext += `\n\n${n.textContent.toUpperCase()}\n`; else if (n.type.name === 'dialogue') ftext += `${n.textContent}\n`; else ftext += `\n${n.textContent}\n` } })
          onSceneContextChange({ headings: h, ftext: ftext.trim(), pages: Math.max(1, Math.ceil(editorDOMRef.current.clientHeight / 1131)) })
          localStorage.setItem('script-studio-data', JSON.stringify(next.doc.toJSON()))
        }
      }
    })
    return () => viewRef.current?.destroy()
  }, [])

  return (
    <>
      <div ref={editorDOMRef} className="prosemirror-editor-container" />
      {menuData.active && options.length > 0 && (
        <div className="tag-autocomplete-menu" style={{ top: menuData.coords.top, left: menuData.coords.left }}>
          {options.map((opt, i) => (
             <div key={i} className={`tag-option ${i === selectedIndex ? 'selected' : ''}`} onMouseDown={(e) => { e.preventDefault(); pmMenuRef.current.setSelectedIndex(i); setTimeout(() => pmMenuRef.current.insertTag(), 0) }}>
                <span className={`tag-badge type-${opt.type}`}>{opt.label}</span><span className="tag-text">{opt.text}</span>
             </div>
          ))}
        </div>
      )}
    </>
  )
})

export default Editor