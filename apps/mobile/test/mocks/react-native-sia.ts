export class Builder {
  connected = jest.fn()
  requestConnection = jest.fn()
  responseUrl = jest.fn(() => '')
  waitForApproval = jest.fn()
  register = jest.fn()
}

export class AppKey {
  private data: ArrayBuffer
  constructor(data: ArrayBuffer) {
    this.data = data
  }
  export_() {
    return this.data
  }
}

export function initSia() {
  return Promise.resolve()
}
export function generateRecoveryPhrase() {
  return 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
}
export function validateRecoveryPhrase() {}
export function setLogger() {}
