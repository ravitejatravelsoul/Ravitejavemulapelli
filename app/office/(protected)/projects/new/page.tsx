import type { Metadata } from "next";
import { NewProjectForm } from "@/components/ai-office/dashboard/new-project-form";

export const metadata: Metadata = { title: "Start New Project" };

export default function NewProjectPage() {
  return <NewProjectForm />;
}
