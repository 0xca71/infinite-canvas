"use client";

import localforage from "localforage";

import type { RemoteStorage } from "@/services/remote-storage";

const handleStore = localforage.createInstance({ name: "infinite-canvas", storeName: "sync_folder" });
const HANDLE_KEY = "directory_handle";

type PermissionMode = "read" | "readwrite";
type PermissionHandle = FileSystemDirectoryHandle & {
    queryPermission(options: { mode: PermissionMode }): Promise<PermissionState>;
    requestPermission(options: { mode: PermissionMode }): Promise<PermissionState>;
};

type DirectoryPickerWindow = Window & {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

export function isLocalFolderSyncSupported() {
    return typeof window !== "undefined" && typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
}

export async function pickLocalSyncDirectory() {
    if (!isLocalFolderSyncSupported()) throw new Error("当前浏览器不支持本地文件夹同步，请使用 Chrome / Edge 桌面版");
    const handle = await (window as DirectoryPickerWindow).showDirectoryPicker!();
    await handleStore.setItem(HANDLE_KEY, handle);
    return handle;
}

export async function getSavedLocalSyncDirectory() {
    return handleStore.getItem<FileSystemDirectoryHandle>(HANDLE_KEY);
}

export class LocalFolderRemoteStorage implements RemoteStorage {
    constructor(private handle: FileSystemDirectoryHandle) {}

    async testConnection() {
        await ensurePermission(this.handle, "readwrite");
    }

    async downloadFile(path: string) {
        await ensurePermission(this.handle, "read");
        const parts = safePathParts(path);
        const fileName = parts.pop();
        if (!fileName) return null;
        const directory = await getDirectory(this.handle, parts, false);
        if (!directory) return null;
        try {
            return await (await directory.getFileHandle(fileName)).getFile();
        } catch (error) {
            if (isNotFoundError(error)) return null;
            throw error;
        }
    }

    async uploadFile(path: string, file: Blob) {
        if (!file.size) throw new Error("上传文件为空，已取消上传");
        await ensurePermission(this.handle, "readwrite");
        const parts = safePathParts(path);
        const fileName = parts.pop();
        if (!fileName) throw new Error("同步文件路径无效");
        const directory = await getDirectory(this.handle, parts, true);
        const fileHandle = await directory!.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file);
        await writable.close();
    }
}

async function ensurePermission(handle: FileSystemDirectoryHandle, mode: PermissionMode) {
    const permissionHandle = handle as PermissionHandle;
    const options = { mode };
    if ((await permissionHandle.queryPermission(options)) === "granted") return;
    if ((await permissionHandle.requestPermission(options)) === "granted") return;
    throw new Error("本地同步文件夹权限已失效，请重新选择同步文件夹");
}

async function getDirectory(root: FileSystemDirectoryHandle, parts: string[], create: boolean) {
    let current = root;
    for (const part of parts) {
        try {
            current = await current.getDirectoryHandle(part, { create });
        } catch (error) {
            if (!create && isNotFoundError(error)) return null;
            throw error;
        }
    }
    return current;
}

function safePathParts(path: string) {
    const normalized = path.replace(/\\+/g, "/").replace(/^\/+|\/+$/g, "");
    const parts = normalized.split("/").filter(Boolean);
    if (!parts.length || parts.some((part) => part === "." || part === "..")) throw new Error("同步文件路径无效");
    return parts;
}

function isNotFoundError(error: unknown) {
    return error instanceof DOMException && error.name === "NotFoundError";
}
