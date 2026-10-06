"use client";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { FORMAT_TEXT_COMMAND, UNDO_COMMAND, REDO_COMMAND } from "lexical";
import {
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
} from "@lexical/list";
import {
  FiBold,
  FiItalic,
  FiCode,
  FiList,
  FiRotateCcw,
  FiRotateCw,
} from "react-icons/fi";
export function WorkbenchEditorToolbar() {
  const [editor] = useLexicalComposerContext();
  return (
    <div
      className="nx-editor-toolbar"
      role="toolbar"
      aria-label="Text formatting"
    >
      <button
        type="button"
        aria-label="Bold"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
      >
        <FiBold />
      </button>
      <button
        type="button"
        aria-label="Italic"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
      >
        <FiItalic />
      </button>
      <button
        type="button"
        aria-label="Inline code"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")}
      >
        <FiCode />
      </button>
      <span />
      <button
        type="button"
        aria-label="Bulleted list"
        onClick={() =>
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
        }
      >
        <FiList />
      </button>
      <button
        type="button"
        aria-label="Numbered list"
        onClick={() =>
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
        }
      >
        1.
      </button>
      <span />
      <button
        type="button"
        aria-label="Undo text edit"
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
      >
        <FiRotateCcw />
      </button>
      <button
        type="button"
        aria-label="Redo text edit"
        onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
      >
        <FiRotateCw />
      </button>
    </div>
  );
}
