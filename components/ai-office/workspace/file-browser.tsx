"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

export interface WorkspaceFileEntry {
  path: string
  sizeBytes: number
  lastModifiedByRoleId: string | null
  html: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/** Read-only file list + syntax-highlighted viewer — no editing capability, per Phase 8 Part M. `html` for each file is pre-rendered server-side (shiki); this component only toggles which one is visible. */
export function FileBrowser({ files }: { files: WorkspaceFileEntry[] }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(files[0]?.path ?? null)
  const selected = files.find((f) => f.path === selectedPath) ?? null

  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">No files yet.</p>
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
      <ul className="flex flex-col gap-1 text-sm">
        {files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              onClick={() => setSelectedPath(file.path)}
              className={cn(
                "flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-muted",
                selectedPath === file.path && "bg-muted font-medium"
              )}
            >
              <span className="truncate font-mono text-xs">{file.path}</span>
              <span className="text-[0.65rem] text-muted-foreground">
                {formatBytes(file.sizeBytes)}
                {file.lastModifiedByRoleId ? ` · ${file.lastModifiedByRoleId}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0 overflow-x-auto rounded-lg border border-border/40 text-xs [&_pre]:p-4 [&_pre]:!bg-transparent">
        {selected ? (
          <div dangerouslySetInnerHTML={{ __html: selected.html }} />
        ) : (
          <p className="p-4 text-muted-foreground">Select a file to view its contents.</p>
        )}
      </div>
    </div>
  )
}
