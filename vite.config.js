import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // 🌟 終極修復：強制打包工具合併所有 ProseMirror 套件，防止生產環境編輯器凍結
    dedupe: [
      'prosemirror-state',
      'prosemirror-view',
      'prosemirror-model',
      'prosemirror-transform',
      'prosemirror-commands',
      'prosemirror-keymap',
      'prosemirror-inputrules'
    ]
  }
})