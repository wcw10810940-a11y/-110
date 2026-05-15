import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { EditorState, TextSelection, Plugin, PluginKey } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, setBlockType, toggleMark } from 'prosemirror-commands'
import { DOMParser, Node } from 'prosemirror-model' 
import { InputRule, inputRules, textblockTypeInputRule } from 'prosemirror-inputrules'
import { scriptSchema } from './schema'

const tagMenuKey = new PluginKey('tagMenu')

// 🌟 更聰明的解析器：就算沒有空格也能完美抓取歷史紀錄
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

function getMenuOptions(query, menuType, tagsData) {
  if (!menuType) return []
  let all = []
  if (menuType === 'inOut') all = ['內.', '外.', '內/外.'].map(t => ({ text: t, type: 'inOut', label: '內/外' }))
  else if (menuType === 'loc') all = tagsData.locs.map(t => ({ text: t, type: 'loc', label: '地點' }))
  else if (menuType === 'time') all = ['日', '夜', '晨', '昏', ...tagsData.times.filter(t => !['日','夜','晨','昏'].includes(t))].map(t => ({ text: t, type: 'time', label: '時間' }))
  else if (menuType === 'tag') all = tagsData.tags.map(t => ({ text: t, type: 'tag', label: '標記' }))
  
  let filtered = all.filter(o => o.text.toLowerCase().includes(query.toLowerCase()) || o.text.replace(/[-()]/g, '').toLowerCase().includes(query.toLowerCase()))
  filtered = filtered.filter((v, i, a) => a.findIndex(t => (t.text === v.text)) === i)
  
  // 保證永遠有選項，避免 Enter 抓空
  if (query.trim().length > 0 && !filtered.find(f => f.text === query)) {
      filtered.push({ text: query, type: 'new', label: '新增' })
  }
  return filtered
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

// 🌟 原生空白鍵自動排版：無延遲、絕不卡死
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
      // 輸入 /內 + 空白 -> 自動變 "內. "
      new InputRule(/\/([^\s/]+)\s$/, (state, match, start, end) => {
          let txt = match[1];
          if (['內', '外', '內外', '內/外'].includes(txt)) txt += '.';
          else if (!txt.endsWith('.')) txt += '.';
          return state.tr.replaceWith(start, end, state.schema.text(txt + ' '));
      }),
      // 輸入 #地點 + 空白 -> 自動變 "地點 "
      new InputRule(/#([^\s#]+)\s$/, (state, match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text(match[1] + ' '));
      }),
      // 輸入 -時間 + 空白 -> 自動變 "- 時間 "
      new InputRule(/-([^\s-]+)\s$/, (state, match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('- ' + match[1] + ' '));
      }),
      // 輸入 (標記 + 空白 -> 自動變 "(標記) "
      new InputRule(/\(([^\s()]+)\s$/, (state, match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('(' + match[1] + ') '));
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
  const menuScrollRef = useRef(null)
  
  const tagsDataRef = useRef({ locs: [], times: [], tags: [] })
  const [menuData, setMenuData] = useState({ active: false, coords: null, query: '', menuType: null, from: 0, to: 0 })
  const [selectedIndex, setSelectedIndex] = useState(0)
  
  const pmMenuRef = useRef({ active: false, query: '', menuType: null, from: 0, to: 0, selectedIndex: 0 })

  const options = menuData.active ? getMenuOptions(menuData.query, menuData.menuType, tagsDataRef.current) : []

  useEffect(() => {
    if (menuData.active && menuScrollRef.current) {
      const selectedEl = menuScrollRef.current.querySelector('.selected')
      if (selectedEl) selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, menuData.active])

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
    }
  }))

  useEffect(() => {
    const saved = localStorage.getItem('script-studio-data')
    const state = EditorState.create({ 
      doc: saved ? Node.fromJSON(scriptSchema, JSON.parse(saved)) : DOMParser.fromSchema(scriptSchema).parse(Object.assign(document.createElement('div'), { innerHTML: `<h3 class="scene-heading">S1. 內. 工作室 - 日</h3><p class="action">現在你可以隨心所欲地打字了！</p><p class="action">打完標籤按「空白鍵」瞬間排版，按「Enter」從選單挑選！</p>` })),
      plugins: [ 
        autoNumberingPlugin, 
        new Plugin({
          key: tagMenuKey,
          props: {
            handleKeyDown(view, event) {
              if (!pmMenuRef.current.active) return false
              
              const currentOptions = getMenuOptions(pmMenuRef.current.query, pmMenuRef.current.menuType, tagsDataRef.current)
              if (currentOptions.length === 0) return false; 
              
              // 🌟 安全的索引計算
              const safeIndex = Math.min(pmMenuRef.current.selectedIndex, currentOptions.length - 1)

              if (event.key === 'ArrowDown') { 
                  event.preventDefault()
                  pmMenuRef.current.selectedIndex = Math.min(safeIndex + 1, currentOptions.length - 1)
                  setSelectedIndex(pmMenuRef.current.selectedIndex)
                  return true 
              }
              if (event.key === 'ArrowUp') { 
                  event.preventDefault()
                  pmMenuRef.current.selectedIndex = Math.max(safeIndex - 1, 0)
                  setSelectedIndex(pmMenuRef.current.selectedIndex)
                  return true 
              }

              if (event.key === 'Enter' || event.key === 'Tab') { 
                  event.preventDefault()
                  const sel = currentOptions[Math.max(0, safeIndex)]
                  if (sel) {
                      let txt = sel.text
                      if (pmMenuRef.current.menuType === 'inOut' || pmMenuRef.current.menuType === 'loc') txt += ' '
                      if (pmMenuRef.current.menuType === 'time') txt = `- ${txt} `
                      if (pmMenuRef.current.menuType === 'tag') txt = `(${txt}) `
                      
                      view.dispatch(view.state.tr.replaceWith(pmMenuRef.current.from, pmMenuRef.current.to, view.state.schema.text(txt)))
                  }
                  setMenuData(p => ({ ...p, active: false }))
                  pmMenuRef.current.active = false
                  return true 
              }
              
              if (event.key === 'Escape') { 
                  event.preventDefault()
                  setMenuData(p => ({ ...p, active: false }))
                  pmMenuRef.current.active = false
                  return true 
              }
              return false
            }
          },
          view() {
            return {
              update(view) {
                const { $from, empty } = view.state.selection
                if (!empty || $from.parent.type.name !== 'scene_heading') { 
                    if (pmMenuRef.current.active) {
                        setMenuData(p => ({ ...p, active: false }))
                        pmMenuRef.current.active = false
                    }
                    return 
                }
                
                const textBefore = $from.parent.textBetween(0, $from.parentOffset)
                let q = null, mt = null, ml = 0
                const mIn = textBefore.match(/\/([^\s/]*)$/)
                const mLoc = textBefore.match(/#([^\s#]*)$/)
                const mTim = textBefore.match(/-([^\s-]*)$/)
                const mTag = textBefore.match(/\(([^\s()]*)$/)
                
                if (mIn) { q = mIn[1]; mt = 'inOut'; ml = mIn[0].length }
                else if (mLoc) { q = mLoc[1]; mt = 'loc'; ml = mLoc[0].length }
                else if (mTim) { q = mTim[1]; mt = 'time'; ml = mTim[0].length }
                else if (mTag) { q = mTag[1]; mt = 'tag'; ml = mTag[0].length }
                
                if (mt) {
                  const coords = view.coordsAtPos($from.pos)
                  const isNewTrigger = !pmMenuRef.current.active || pmMenuRef.current.menuType !== mt || pmMenuRef.current.query !== q
                  
                  pmMenuRef.current.active = true
                  pmMenuRef.current.query = q
                  pmMenuRef.current.menuType = mt
                  pmMenuRef.current.from = $from.pos - ml
                  pmMenuRef.current.to = $from.pos
                  
                  if (isNewTrigger) {
                      pmMenuRef.current.selectedIndex = 0
                      setSelectedIndex(0)
                  }
                  
                  setMenuData({ active: true, query: q, menuType: mt, coords: { top: coords.bottom + 4, left: coords.left } })
                } else { 
                  if (pmMenuRef.current.active) {
                      setMenuData(p => ({ ...p, active: false }))
                      pmMenuRef.current.active = false 
                  }
                }
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
        
        if (tr.docChanged) {
          const h = []; const locs = new Set(), times = new Set(), tags = new Set()
          let i = 1; next.doc.descendants((n, p) => { 
            if (n.type.name === 'scene_heading') { 
              const ps = parseSceneText(n.textContent); 
              if (ps.loc) locs.add(ps.loc); 
              if (ps.time) times.add(ps.time); 
              if (ps.tags) tags.add(ps.tags); 
              h.push({ id: `scene-${i}`, ...ps, num: `S${i++}`, pos: p }) 
            } 
          })
          tagsDataRef.current = { locs: Array.from(locs), times: Array.from(times), tags: Array.from(tags) }
          
          let ftext = ""; next.doc.descendants(n => { 
            if (n.isBlock && n.textContent) { 
              if (n.type.name === 'scene_heading' || n.type.name === 'character') ftext += `\n\n${n.textContent.toUpperCase()}\n`; 
              else if (n.type.name === 'dialogue') ftext += `${n.textContent}\n`; 
              else ftext += `\n${n.textContent}\n` 
            } 
          })
          onSceneContextChange({ headings: h, ftext: ftext.trim(), pages: Math.max(1, Math.ceil(editorDOMRef.current.clientHeight / 1131)) })
          localStorage.setItem('script-studio-data', JSON.stringify(next.doc.toJSON()))
        }
      }
    })
    
    const initLocs = new Set(), initTimes = new Set(), initTags = new Set()
    state.doc.descendants((n) => { 
      if (n.type.name === 'scene_heading') { 
        const ps = parseSceneText(n.textContent); 
        if (ps.loc) initLocs.add(ps.loc); if (ps.time) initTimes.add(ps.time); if (ps.tags) initTags.add(ps.tags);
      } 
    })
    tagsDataRef.current = { locs: Array.from(initLocs), times: Array.from(initTimes), tags: Array.from(initTags) }

    return () => viewRef.current?.destroy()
  }, [])

  return (
    <>
      <div ref={editorDOMRef} className="prosemirror-editor-container" />
      {menuData.active && options.length > 0 && (
        <div ref={menuScrollRef} className="tag-autocomplete-menu" style={{ top: menuData.coords.top, left: menuData.coords.left }}>
          {options.map((opt, i) => (
             <div key={i} className={`tag-option ${i === selectedIndex ? 'selected' : ''}`} onMouseDown={(e) => { 
                 e.preventDefault(); 
                 let txt = opt.text
                 if (menuData.menuType === 'inOut' || menuData.menuType === 'loc') txt += ' '
                 if (menuData.menuType === 'time') txt = `- ${txt} `
                 if (menuData.menuType === 'tag') txt = `(${txt}) `
                 viewRef.current.dispatch(viewRef.current.state.tr.replaceWith(pmMenuRef.current.from, pmMenuRef.current.to, viewRef.current.state.schema.text(txt)))
                 setMenuData(p => ({ ...p, active: false }))
                 pmMenuRef.current.active = false
                 viewRef.current.focus()
             }}>
                <span className={`tag-badge type-${opt.type}`}>{opt.label}</span><span className="tag-text">{opt.text}</span>
             </div>
          ))}
        </div>
      )}
    </>
  )
})

export default Editor