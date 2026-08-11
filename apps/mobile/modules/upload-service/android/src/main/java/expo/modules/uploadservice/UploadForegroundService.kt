package expo.modules.uploadservice

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.ServiceCompat

/**
 * Keeps the app's process out of the cached state while an upload runs.
 *
 * On Android 14+ a cached process is frozen 10 seconds after entering that
 * state, which suspends every thread including the JS thread driving the
 * upload loop. A foreground service prevents the process from being cached at
 * all, so the existing in-JS uploader keeps running with the screen off. This
 * service transfers nothing itself; it only holds the process open.
 *
 * The wake lock is a second, separate need: the service stops the process
 * being frozen, but not the SoC suspending once the screen is off. It doubles
 * as the running flag, since the two are the same fact.
 */
open class UploadForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val content = UploadNotifications.contentFrom(intent)
    if (wakeLock == null) {
      try {
        promote(content)
      } catch (e: IllegalStateException) {
        // Android can refuse here as well as at startForegroundService, from
        // Android 15 on once the dataSync budget is spent. This runs after
        // the start call returned to JS, so a throw would crash the process
        // with nobody to catch it. ForegroundServiceStartNotAllowedException
        // (API 31+) extends IllegalStateException, which runs on API 24.
        stopSelf()
        UploadServiceBridge.emitRefused()
        return START_NOT_STICKY
      }
      // PowerManager surfaces this tag in battery blame and `dumpsys power`,
      // so it carries an app-identifying prefix. No timeout: this service owns
      // the lifetime, and a timeout would drop the lock mid-transfer.
      wakeLock =
        (getSystemService(POWER_SERVICE) as PowerManager)
          .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sia:upload")
          .also { it.acquire() }
      UploadServiceBridge.isRunning = true
    } else {
      // A redelivered intent must not take a second wake lock.
      UploadNotifications.notify(this, content)
    }
    // START_NOT_STICKY: a system-initiated restart would recreate the service
    // with no JS context behind it, leaving a wake lock and a progress
    // notification attached to an upload loop that is not running. Restarting
    // is the app's job on its next foreground, or the background-fetch task's.
    return START_NOT_STICKY
  }

  /**
   * Android 15+ (API 35) reclaims the app's `dataSync` budget after 6 hours in
   * a rolling 24h window and calls this. The system kills the process with a
   * RemoteServiceException if the service is still up a few seconds later, so
   * nothing that can block or throw may sit ahead of the stop.
   */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopNow()
    UploadServiceBridge.emitTimeout()
  }

  /**
   * The user swiped the app off recents. A service defaults to
   * `stopWithTask="false"`, so without this it outlives the task, holding a
   * wake lock and an ongoing notification for an upload loop whose host is
   * gone. Swiping away is a stop gesture, so honor it.
   */
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopNow()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    releaseWakeLock()
    UploadServiceBridge.isRunning = false
    UploadServiceBridge.emitStopped()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  // ServiceCompat drops the type below API 29, where it does not exist, so it
  // is passed unconditionally. Open so a test can make Android refuse.
  protected open fun promote(content: UploadNotifications.Content) {
    ServiceCompat.startForeground(
      this,
      UploadNotifications.NOTIFICATION_ID,
      UploadNotifications.build(this, content),
      ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
    )
  }

  // Releases before asking to stop rather than waiting for onDestroy: if the
  // stop is slow or never lands, a released wake lock is the difference
  // between a spent budget and a flat battery. The flag drops here too, since
  // the timeout event goes out before onDestroy and JS reads it to decide
  // whether the service is still up and whether to post an update.
  private fun stopNow() {
    UploadServiceBridge.isRunning = false
    releaseWakeLock()
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun releaseWakeLock() {
    wakeLock?.takeIf { it.isHeld }?.release()
    wakeLock = null
  }
}
