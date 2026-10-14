// Stub for the Android-only `upload-service` module. Off Android the real
// module is a no-op as well, which is what jest's iOS platform expects.
export const START_NOT_ALLOWED = 'start-not-allowed'
export const isUploadServiceRunning = () => false
export const startUploadService = () => {}
export const updateUploadService = () => {}
export const stopUploadService = () => {}
export const addUploadServiceTimeoutListener = () => null
export const addUploadServiceStoppedListener = () => null
export const addUploadServiceRefusedListener = () => null
