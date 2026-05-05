"use client";
import { useRef, useState } from "react";

type Stage = "idle" | "uploading";

interface UploadFolderProps {
    folder?: string;
    onFileChange?: () => void;
}

async function readAllEntries(
    reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
    const all: FileSystemEntry[] = [];
    while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
            reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        all.push(...batch);
    }
    return all;
}

async function readEntry(entry: FileSystemEntry): Promise<File[]> {
    if (entry.isFile) {
        return new Promise((resolve, reject) => {
            (entry as FileSystemFileEntry).file((file) => {
                Object.defineProperty(file, "webkitRelativePath", {
                    value: entry.fullPath.slice(1),
                    writable: false,
                });
                resolve([file]);
            }, reject);
        });
    }

    if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const entries = await readAllEntries(reader);
        const nested = await Promise.all(entries.map(readEntry));
        return nested.flat();
    }

    return [];
}

async function uploadFile(file: File, folder: string): Promise<void> {
    const relativePath = file.webkitRelativePath || file.name;

    const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            filename: relativePath,
            contentType: file.type || "application/octet-stream",
            folder,
        }),
    });
    const { url } = await res.json();

    await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.onload = () => resolve();
        xhr.onerror = () => reject(new Error(`Failed: ${relativePath}`));
        xhr.send(file);
    });
}

export default function UploadFolder({
    folder = "uploads",
    onFileChange,
}: UploadFolderProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [stage, setStage] = useState<Stage>("idle");
    const [progress, setProgress] = useState(0);
    const [filename, setFilename] = useState("");
    const [message, setMessage] = useState<{
        text: string;
        ok: boolean;
    } | null>(null);
    const [dragging, setDragging] = useState(false);

    async function processFiles(files: File[]) {
        if (!files.length) return;

        setMessage(null);
        setProgress(0);
        setStage("uploading");

        let completed = 0;

        try {
            for (const file of files) {
                setFilename(`${completed + 1} / ${files.length} files`);
                await uploadFile(file, folder);
                completed++;
                setProgress(Math.round((completed / files.length) * 100));
            }

            setMessage({ text: `✓ ${completed} files uploaded`, ok: true });
            onFileChange?.();
        } catch (err) {
            setMessage({
                text: `✗ ${err instanceof Error ? err.message : "Something went wrong"} (${completed}/${files.length} completed)`,
                ok: false,
            });
        } finally {
            setStage("idle");
            setProgress(0);
        }
    }

    async function handleFolderInput(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        await processFiles(files);
    }

    async function handleDrop(e: React.DragEvent) {
        e.preventDefault();
        setDragging(false);
        if (stage !== "idle") return;

        const items = Array.from(e.dataTransfer.items);
        const entries = items
            .map((item) => item.webkitGetAsEntry())
            .filter(Boolean) as FileSystemEntry[];

        const allFiles = (await Promise.all(entries.map(readEntry))).flat();
        if (!allFiles.length) return;

        if (allFiles.length === 1) {
            await processFiles(allFiles);
            return;
        }

        await processFiles(allFiles);
    }

    return (
        <div className="space-y-1">
            <div
                onClick={() => stage === "idle" && inputRef.current?.click()}
                onDragOver={(e) => {
                    e.preventDefault();
                    if (stage === "idle") setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={`flex min-h-[60px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm transition ${
                    dragging
                        ? "bg-white text-gray-900 ring-2 ring-gray-400"
                        : "bg-white/80 text-gray-700 hover:border-gray-400 hover:text-gray-600"
                }`}
            >
                <input
                    ref={inputRef}
                    type="file"
                    className="hidden"
                    {...({
                        webkitdirectory: "true",
                    } as React.InputHTMLAttributes<HTMLInputElement>)}
                    onChange={handleFolderInput}
                />

                {stage === "idle" && (
                    <span>
                        {dragging ? (
                            "Drop to upload"
                        ) : (
                            <>
                                📁 Drag & Drop your folders or <u>Browse</u>
                            </>
                        )}
                    </span>
                )}

                {stage === "uploading" && (
                    <div className="w-full space-y-1">
                        <div className="flex justify-between text-xs">
                            <span>{filename}</span>
                            <span>{progress}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                            <div
                                className="h-full rounded-full bg-gray-400 transition-all duration-200"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <p className="text-xs text-gray-400">
                            Uploading to S3...
                        </p>
                    </div>
                )}
            </div>

            {message && (
                <p
                    className={`text-xs ${message.ok ? "text-green-500" : "text-red-500"}`}
                >
                    {message.text}
                </p>
            )}
        </div>
    );
}
