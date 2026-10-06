import { WorkBacklog } from "@/components/workbench/backlog";
import { type Metadata } from "next";
export const metadata: Metadata = { title: "Backlog" };
export default function BacklogPage() {
  return <WorkBacklog />;
}
