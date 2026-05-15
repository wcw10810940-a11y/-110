import { useState, useEffect, useRef } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import './index.css'
import Editor from './Editor'

function SortableItem({ id, item, onJump }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 999 : 1 }
  return ( 
    <div ref={setNodeRef} style={style} className="outline-card" onClick={() => onJump(item.pos)}>
      <div className="outline-card-header">
        <div style={{ display: 'flex', alignItems: 'center' }}><span className="scene-num">{item.num}</span><span className="badge-inout">{item.inOut || '未定'}</span></div>
        <span className="badge-time">{item.time || '--'}</span>
        <div {...attributes} {...listeners} style={{ cursor: 'grab', color: 'var(--text-muted)', touchAction: 'none' }}>⣿</div>
      </div>
      <div className="outline-card-loc">{item.loc || '未命名地點'}</div>
      {item.tags && <span className="badge-tag">{item.tags}</span>}
    </div> 
  )
}

function App() {
  const [theme, setTheme] = useState('light')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isFlowMode, setIsFlowMode] = useState(false)
  const [isGuideOpen, setIsGuideOpen] = useState(false)
  const [sceneData, setSceneData] = useState({ headings: [], ftext: '', pages: 1 })
  const editorRef = useRef(null)
  const sensors = useSensors(useSensor(PointerSensor))

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => {
    const handleKeyDown = (e) => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); setIsFlowMode(prev => !prev) } }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleDragEnd = (event) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIdx = sceneData.headings.findIndex(i => i.id === active.id)
      const newIdx = sceneData.headings.findIndex(i => i.id === over.id)
      editorRef.current.moveSceneBlock(oldIdx, newIdx)
    }
  }

  // 🌟 效能修復：按下匯出時，才動態生成檔案並下載，避免每打一個字就吃資源
  const handleExportFountain = () => {
    const blob = new Blob([sceneData.ftext], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `劇本_${new Date().toISOString().slice(0, 10)}.fountain`
    a.click()
    URL.revokeObjectURL(url) // 下載完立刻清理記憶體
  }

  return (
    <>
      {!isFlowMode && (
        <nav className="menu-bar hide-on-print">
          <div className="menu-left">
            <div className="app-logo">劇本工作室 V9</div>
            <div className="menu-item">檔案
              <div className="dropdown">
                <div className="dropdown-item" onClick={handleExportFountain}><span>匯出 Fountain</span><span className="shortcut">⇧⌘E</span></div>
                <div className="dropdown-divider"></div>
                <div className="dropdown-item" onClick={() => window.print()}><span>列印 PDF</span><span className="shortcut">⌘P</span></div>
              </div>
            </div>
            <div className="menu-item">設定
              <div className="dropdown">
                <div className="dropdown-item" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>切換深/淺色</div>
                <div className="dropdown-item" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>切換側邊欄</div>
              </div>
            </div>
            <div className="menu-item">說明
              <div className="dropdown">
                <div className="dropdown-item" onClick={() => setIsGuideOpen(true)}>新手寫作導覽</div>
              </div>
            </div>
          </div>
          <div className="menu-right"><span style={{ color: 'var(--text-muted)' }}>共 {sceneData.pages} 頁</span></div>
        </nav>
      )}

      <div style={{ display: 'flex', height: isFlowMode ? '100vh' : 'calc(100vh - 40px)', overflow: 'hidden' }}>
        {!isFlowMode && isSidebarOpen && (
          <div className="hide-on-print" style={{ width: '280px', flexShrink: 0, background: 'var(--bg-sidebar)', padding: '20px', overflowY: 'auto', borderRight: '1px solid var(--border-color)' }}>
            <h4 style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '15px' }}>劇本大綱</h4>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sceneData.headings.map(i => i.id)} strategy={verticalListSortingStrategy}>
                {sceneData.headings.map(item => <SortableItem key={item.id} id={item.id} item={item} onJump={p => editorRef.current.scrollToPos(p)} />)}
              </SortableContext>
            </DndContext>
          </div>
        )}
        <div style={{ flex: 1, background: isFlowMode ? 'var(--bg-main)' : 'var(--bg-board)', overflowY: 'auto', padding: isFlowMode ? '10vh 0' : '50px 0' }}>
          <div className="paper-canvas" style={{ width: '100%', maxWidth: '800px', minHeight: '1131px', margin: '0 auto', background: 'var(--bg-main)', padding: '0 100px', border: isFlowMode ? 'none' : '1px solid var(--border-color)', boxShadow: isFlowMode ? 'none' : 'var(--page-shadow)' }}>
            <Editor ref={editorRef} onSceneContextChange={data => setSceneData(data)} />
          </div>
        </div>
      </div>

      {isGuideOpen && (
        <div className="modal-overlay" onClick={() => setIsGuideOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-close" onClick={() => setIsGuideOpen(false)}>×</div>
            <h2 style={{ marginTop: 0, marginBottom: '24px' }}>快速寫作導覽</h2>
            
            <div className="guide-step">
              <h4><span className="step-num">1</span> 建立場次標題</h4>
              <p>在空行按下 <kbd>Enter</kbd> 兩次，或輸入 <kbd>#</kbd> 加 <kbd>空白</kbd>，系統會自動生成場次編號並啟動標記模式。</p>
            </div>

            <div className="guide-step">
              <h4><span className="step-num">2</span> 智慧標籤選單</h4>
              <p>在標題中輸入以下符號觸發自動完成選單：<br/>
                 - <kbd>/</kbd> ：內 / 外景<br/>
                 - <kbd>#</kbd> ：地點 (會記憶歷史紀錄)<br/>
                 - <kbd>-</kbd> ：時間 (日、夜...)<br/>
                 - <kbd>(</kbd> ：通用標記
              </p>
            </div>

            <div className="guide-step">
              <h4><span className="step-num">3</span> 段落切換</h4>
              <p>使用 <kbd>Tab</kbd> 鍵在「動作 ➔ 角色 ➔ 對白 ➔ 場次」之間快速循環切換。或者輸入 <kbd>@</kbd> 加空白，快速變更為角色。</p>
            </div>

            <div className="guide-step">
              <h4><span className="step-num">4</span> 大綱排序與輸出</h4>
              <p>左側大綱可隨意拖拽，場次編號會自動更新。完成後從選單選擇「匯出 Fountain」或「列印 PDF」。</p>
            </div>

            <button onClick={() => setIsGuideOpen(false)} style={{ width: '100%', padding: '12px', background: 'var(--text-main)', color: 'var(--bg-main)', borderRadius: '6px', fontWeight: '600', marginTop: '12px' }}>開始寫作</button>
          </div>
        </div>
      )}
    </>
  )
}

export default App