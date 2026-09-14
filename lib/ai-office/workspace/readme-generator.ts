import "server-only";

/**
 * Platform-hardening phase, Part 5B — every deliverable workspace must
 * have a README, but it must describe the ACTUAL generated project, not
 * generic boilerplate, and it must never cost a real AI call (a static,
 * deterministic derivation from the project's own real metadata and
 * real file list). Generated fresh on every read (workspace UI render,
 * ZIP download) rather than written once and risking drift from the
 * real current files — see zip-route/workspace UI call sites.
 */

export interface ReadmeInput {
  projectTitle: string;
  ideaText: string;
  files: string[];
}

interface ProjectKind {
  label: string;
  prerequisites: string[];
  installSteps: string[];
  runSteps: string[];
  testCommand: string | null;
  buildCommand: string | null;
}

function detectProjectKind(files: string[]): ProjectKind {
  const hasPackageJson = files.includes("package.json");
  const hasIndexHtml = files.some((f) => f === "index.html" || f.endsWith("/index.html"));

  if (hasPackageJson) {
    return {
      label: "Node.js project",
      prerequisites: ["Node.js (a recent LTS version) and npm"],
      installSteps: ["npm install"],
      runSteps: ["npm run dev  # or: npm start, if this project has no dev script"],
      testCommand: "npm test",
      buildCommand: "npm run build",
    };
  }

  if (hasIndexHtml) {
    return {
      label: "Static web app (plain HTML/CSS/JavaScript, no build step, no framework)",
      prerequisites: ["Any modern web browser. No runtime, package manager, or build tool is required."],
      installSteps: ["None — there are no dependencies to install."],
      runSteps: [
        "Double-click index.html to open it directly in your browser, OR",
        "Serve it locally (recommended if the app uses fetch/modules): npx serve .   (or: python3 -m http.server)",
      ],
      testCommand: null,
      buildCommand: null,
    };
  }

  return {
    label: "Generated project",
    prerequisites: ["See the file list below to determine what's needed to run this project."],
    installSteps: ["No standard package manifest was found in this workspace."],
    runSteps: ["Open the files below to determine how to run this project."],
    testCommand: null,
    buildCommand: null,
  };
}

function describeFile(path: string): string {
  const lower = path.toLowerCase();
  if (lower === "index.html") return "index.html — the application's entry point, open this to run it";
  if (lower === "style.css" || lower === "styles.css") return `${path} — stylesheet`;
  if (lower === "script.js") return `${path} — application logic`;
  if (lower === "package.json") return "package.json — dependencies and npm scripts";
  if (lower === "readme.md") return "README.md — this file";
  return path;
}

/** One or two sentences describing what the project does, derived from its own real submitted idea text — never invented, never generic. */
function summarize(ideaText: string): string {
  const trimmed = ideaText.trim();
  if (!trimmed) return "(No description was recorded for this project.)";
  return trimmed.length > 500 ? `${trimmed.slice(0, 499)}…` : trimmed;
}

export function generateReadme(input: ReadmeInput): string {
  const kind = detectProjectKind(input.files);
  const sortedFiles = [...input.files].sort();
  const extSummary = [...new Set(sortedFiles.map((f) => (f.includes(".") ? f.slice(f.lastIndexOf(".")) : "(no extension)")))].join(", ");

  const lines: string[] = [
    `# ${input.projectTitle}`,
    "",
    "## What this does",
    "",
    summarize(input.ideaText),
    "",
    "## Technology used",
    "",
    `${kind.label}.`,
    sortedFiles.length > 0 ? `File types present: ${extSummary || "(none)"}.` : "",
    "",
    "## Prerequisites",
    "",
    ...kind.prerequisites.map((p) => `- ${p}`),
    "",
    "## Installation",
    "",
    "```",
    ...kind.installSteps,
    "```",
    "",
    "## How to run locally",
    "",
    "```",
    ...kind.runSteps,
    "```",
    "",
  ];

  if (kind.testCommand) {
    lines.push("## Tests", "", "```", kind.testCommand, "```", "");
  }
  if (kind.buildCommand) {
    lines.push("## Build", "", "```", kind.buildCommand, "```", "");
  }

  lines.push(
    "## Important files",
    "",
    ...(sortedFiles.length > 0 ? sortedFiles.map((f) => `- ${describeFile(f)}`) : ["(No files have been generated yet.)"]),
    "",
    "---",
    "_This README was generated automatically by Teja's AI Office from this project's real files and request — it is not written by an AI model and costs nothing to produce._",
  );

  return lines.filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n");
}
