"use client";

export const MANIFEST_FILE_NAME = "manifest.json";

export type RemoteStorage = {
    testConnection(): Promise<void>;
    downloadFile(path: string): Promise<Blob | null>;
    uploadFile(path: string, file: Blob, contentType?: string): Promise<void>;
};
