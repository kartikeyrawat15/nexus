"use client";
import { Droppable, type DroppableProps } from "react-beautiful-dnd";
import { useStrictModeDroppable } from "@/hooks/use-strictmode-droppable";

/** Mount lists after their drag context survives React's StrictMode effect replay. */
export function DropZone(props: DroppableProps) {
  const [enabled] = useStrictModeDroppable();
  return enabled ? <Droppable {...props} /> : null;
}
