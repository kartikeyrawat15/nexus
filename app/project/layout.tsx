import { WorkbenchShell } from "@/components/workbench/shell";
export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkbenchShell>{children}</WorkbenchShell>;
}
