import { z } from "zod";
import { richTextDocumentSchema } from "../domain/schema";
import { DomainError, type InlineNode, type RichTextDocument, type RichTextNode, type TextMark, type TextNode } from "../domain/types";

const nodeSchema: z.ZodType<EditorNode> = z.lazy(() => z.object({
  type: z.string(), text: z.string().optional(), format: z.union([z.number(), z.string()]).optional(),
  tag: z.string().optional(), listType: z.string().optional(), url: z.string().optional(), children: z.array(nodeSchema).optional(),
}).passthrough());
interface EditorNode { type: string; text?: string; format?: number | string; tag?: string; listType?: string; url?: string; children?: EditorNode[] }

/** Lexical JSON is confined to this transitional boundary; the repository stores owned rich text. */
export function editorDocument(serialized: string): RichTextDocument {
  const root = z.object({ root: nodeSchema }).parse(JSON.parse(serialized) as unknown).root;
  const inline = (nodes: EditorNode[], code = false): InlineNode[] => nodes.flatMap((node): InlineNode[] => {
    if (node.type === "linebreak") return [{ type: "text", text: "\n", marks: [] }];
    if (node.type === "text" || node.type === "code-highlight") {
      const bits = typeof node.format === "number" ? node.format : 0;
      const marks: TextMark[] = [];
      if (bits & 1) marks.push("bold"); if (bits & 2) marks.push("italic"); if (bits & 16 || code) marks.push("code");
      return [{ type: "text", text: node.text ?? "", marks }];
    }
    if (node.type === "link") {
      const children = inline(node.children ?? []);
      if (children.some((child) => child.type !== "text")) throw new DomainError("VALIDATION", "Nested links are unsupported");
      return [{ type: "link", url: node.url ?? "", children: children.filter((child): child is TextNode => child.type === "text") }];
    }
    throw new DomainError("VALIDATION", `Unsupported editor content: ${node.type}`);
  });
  const blocks = (root.children ?? []).map((node): RichTextNode => {
    if (node.type === "list") return { type: "list", ordered: node.listType === "number", children: (node.children ?? []).map((item) => {
      if (item.type !== "listitem") throw new DomainError("VALIDATION", "Unsupported list content");
      return { type: "list-item", children: inline(item.children ?? []) };
    }) };
    if (node.type === "heading") return node.tag === "h2" || node.tag === "h3"
      ? { type: "heading", level: node.tag === "h2" ? 2 : 3, children: inline(node.children ?? []) }
      : { type: "paragraph", children: inline(node.children ?? []) };
    if (node.type === "paragraph" || node.type === "quote") return { type: node.type, children: inline(node.children ?? []) };
    if (node.type === "code") return { type: "paragraph", children: inline(node.children ?? [], true) };
    throw new DomainError("VALIDATION", `Unsupported editor content: ${node.type}`);
  });
  const emptyPlaceholder = blocks.length === 1 && blocks[0]?.type === "paragraph" && blocks[0].children.length === 0;
  return richTextDocumentSchema.parse({ format: "nexus-rich-text", version: 1, root: { type: "root", children: emptyPlaceholder ? [] : blocks } });
}
