"use client";

import type { RemoteStorage } from "@/services/remote-storage";
import { downloadWebdavFile, testWebdavConnection, uploadWebdavFile } from "@/services/webdav-sync";
import type { WebdavSyncConfig } from "@/stores/use-config-store";

export class WebDAVRemoteStorage implements RemoteStorage {
    constructor(private config: WebdavSyncConfig) {}

    testConnection() {
        return testWebdavConnection(this.config);
    }

    downloadFile(path: string) {
        return downloadWebdavFile(this.config, path);
    }

    uploadFile(path: string, file: Blob, contentType?: string) {
        return uploadWebdavFile(this.config, path, file, contentType);
    }
}
