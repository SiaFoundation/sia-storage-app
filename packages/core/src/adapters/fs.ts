export interface Reader {
  read(): Promise<ArrayBuffer>
}

export interface Writer {
  write(data: ArrayBuffer): Promise<void>
}

export interface FileSystemAdapter {
  readFile(path: string): Promise<ArrayBuffer>
  writeFile(path: string, data: ArrayBuffer): Promise<void>
  deleteFile(path: string): Promise<void>
  fileExists(path: string): Promise<boolean>
  fileSize(path: string): Promise<number>
  listFiles(directory: string): Promise<string[]>
  copyFile(src: string, dst: string): Promise<void>
  createReader(path: string): Reader
}
