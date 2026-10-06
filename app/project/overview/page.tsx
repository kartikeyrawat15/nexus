import { WorkOverview } from "@/components/workbench/overview";
import { type Metadata } from "next";
export const metadata: Metadata = { title: "Overview" };
export default function OverviewPage() {
  return <WorkOverview />;
}
