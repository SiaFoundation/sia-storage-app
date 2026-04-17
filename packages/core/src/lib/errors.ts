/**
 * Engine-neutral AbortError. React Native's Hermes doesn't expose
 * `DOMException` as a global, so constructing one throws ReferenceError;
 * an Error subclass carrying `name='AbortError'` matches the web abort
 * shape without relying on a browser ambient.
 */
export class AbortError extends Error {
  constructor(message = 'The operation was aborted.') {
    super(message)
    this.name = 'AbortError'
  }
}
