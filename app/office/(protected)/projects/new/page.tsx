import type { Metadata } from "next";
import { NewProjectForm } from "@/components/ai-office/dashboard/new-project-form";
import { isRemoteExecutionMode } from "@/lib/ai-office/remote/execution-mode";

export const metadata: Metadata = { title: "Start New Project" };

export default function NewProjectPage() {
  return <NewProjectForm remoteMode={isRemoteExecutionMode()} />;
}
