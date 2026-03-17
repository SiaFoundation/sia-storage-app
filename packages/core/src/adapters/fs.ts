export interface Reader {
  read(): Promise<ArrayBuffer>
}

export interface Writer {
  write(data: ArrayBuffer): Promise<void>
}
