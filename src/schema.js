import { Schema } from "prosemirror-model"

export const scriptSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    scene_heading: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "h3.scene-heading" }],
      toDOM() { return ["h3", { class: "scene-heading" }, 0] }
    },
    action: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p.action" }],
      toDOM() { return ["p", { class: "action" }, 0] }
    },
    character: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p.character" }],
      toDOM() { return ["p", { class: "character" }, 0] }
    },
    dialogue: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p.dialogue" }],
      toDOM() { return ["p", { class: "dialogue" }, 0] }
    }
  },
  marks: {
    // 🌟 粗體
    bold: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }],
      toDOM() { return ["strong", 0] }
    },
    // 🌟 斜體
    italic: {
      parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }],
      toDOM() { return ["em", 0] }
    },
    // 🌟 自訂樣式 (字體、大小、顏色)
    text_style: {
      attrs: {
        color: { default: null },
        fontSize: { default: null },
        fontFamily: { default: null }
      },
      parseDOM: [{
        tag: "span",
        getAttrs: dom => ({
          color: dom.style.color,
          fontSize: dom.style.fontSize,
          fontFamily: dom.style.fontFamily
        })
      }],
      toDOM(mark) {
        const { color, fontSize, fontFamily } = mark.attrs
        let style = ""
        if (color) style += `color: ${color};`
        if (fontSize) style += `font-size: ${fontSize};`
        if (fontFamily) style += `font-family: ${fontFamily};`
        return ["span", { style }, 0]
      }
    }
  }
})