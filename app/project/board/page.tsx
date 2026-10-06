import { WorkBoard } from "@/components/workbench/board";
import { type Metadata } from "next";
export const metadata: Metadata = { title: "Board" };
export default function BoardPage() {
  return <WorkBoard />;
}
