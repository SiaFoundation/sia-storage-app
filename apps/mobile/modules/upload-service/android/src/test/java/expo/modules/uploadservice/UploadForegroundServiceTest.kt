package expo.modules.uploadservice

import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import androidx.test.core.app.ApplicationProvider
import expo.modules.uploadservice.UploadNotifications.putContent
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowPowerManager

/**
 * Drives the real service through Robolectric rather than a fake, so these
 * assertions cover the actual `startForeground` type constant and the actual
 * PowerManager lock.
 *
 * `onTimeout` is API 35 and Robolectric caps at 34, so it is invoked directly.
 * That is what the system does at the budget ceiling anyway; only the trigger
 * is simulated.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class UploadForegroundServiceTest {
  private val context: Context = ApplicationProvider.getApplicationContext()
  private val controller = Robolectric.buildService(UploadForegroundService::class.java)

  private fun startIntent(title: String = "Uploading", current: Int = 0, total: Int = 0) =
    Intent(context, UploadForegroundService::class.java)
      .putContent(UploadNotifications.Content(title, "", current, total))

  private fun start(intent: Intent = startIntent()): UploadForegroundService =
    controller.create().withIntent(intent).startCommand(0, 0).get()

  @After
  fun tearDown() {
    UploadServiceBridge.isRunning = false
    ShadowPowerManager.clearWakeLocks()
  }

  @Test
  fun `starting runs in the foreground as a data sync service`() {
    val service = start()

    assertEquals(
      ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      service.foregroundServiceType,
    )
    assertNotNull(shadowOf(service).lastForegroundNotification)
    assertTrue(UploadServiceBridge.isRunning)
  }

  @Test
  fun `starting holds a partial wake lock`() {
    start()

    assertTrue(ShadowPowerManager.getLatestWakeLock().isHeld)
  }

  @Test
  fun `a redelivered start does not take a second wake lock`() {
    val service = start()
    val first = ShadowPowerManager.getLatestWakeLock()

    service.onStartCommand(startIntent(title = "Still uploading"), 0, 1)

    assertEquals(first, ShadowPowerManager.getLatestWakeLock())
    assertTrue(first.isHeld)
  }

  @Test
  fun `a start tells Android not to restart the service after killing it`() {
    val service = controller.create().get()

    assertEquals(Service.START_NOT_STICKY, service.onStartCommand(startIntent(), 0, 0))
  }

  @Test
  fun `destroying releases the wake lock and clears the running flag`() {
    start()
    controller.destroy()

    assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
    assertFalse(UploadServiceBridge.isRunning)
  }

  @Test
  fun `a spent budget stops the service and releases the wake lock`() {
    val service = start()

    service.onTimeout(0, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)

    assertTrue(shadowOf(service).isStoppedBySelf)
    assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
    assertTrue(shadowOf(service).notificationShouldRemoved)
  }

  @Test
  fun `swiping the app off recents stops the service and releases the wake lock`() {
    val service = start()

    service.onTaskRemoved(startIntent())

    assertTrue(shadowOf(service).isStoppedBySelf)
    assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
  }

  @Test
  fun `destroying after an early stop does not release twice`() {
    val service = start()
    service.onTaskRemoved(startIntent())
    controller.destroy()

    assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
  }

  @Test
  fun `a timeout reaches JS with the service already reported stopped, before the stop event at destroy`() {
    var timeouts = 0
    var stops = 0
    var runningAtTimeout: Boolean? = null
    UploadServiceBridge.timeoutListener = {
      timeouts++
      runningAtTimeout = UploadServiceBridge.isRunning
    }
    UploadServiceBridge.stoppedListener = { stops++ }

    val service = start()
    service.onTimeout(0, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    assertEquals(1, timeouts)
    assertEquals(false, runningAtTimeout)
    assertEquals(0, stops)

    controller.destroy()
    assertEquals(1, stops)

    UploadServiceBridge.timeoutListener = null
    UploadServiceBridge.stoppedListener = null
  }

  @Test
  fun `a start Android refuses stops the service, takes no wake lock and tells JS`() {
    var refusals = 0
    UploadServiceBridge.refusedListener = { refusals++ }

    val service =
      Robolectric.buildService(RefusedService::class.java)
        .create()
        .withIntent(startIntent())
        .startCommand(0, 0)
        .get()

    assertEquals(1, refusals)
    assertTrue(shadowOf(service).isStoppedBySelf)
    assertFalse(UploadServiceBridge.isRunning)
    assertNull(ShadowPowerManager.getLatestWakeLock())
    UploadServiceBridge.refusedListener = null
  }

  @Test
  fun `a throwing JS listener cannot abort teardown`() {
    UploadServiceBridge.timeoutListener = { error("boom") }
    val service = start()

    service.onTimeout(0, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)

    assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
    UploadServiceBridge.timeoutListener = null
  }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class UploadNotificationsTest {
  private val context: Context = ApplicationProvider.getApplicationContext()

  private val manager
    get() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun build(current: Int, total: Int) =
    UploadNotifications.build(context, UploadNotifications.Content("Uploading", "", current, total))

  @Test
  fun `the channel is silent so an ongoing status never alerts`() {
    UploadNotifications.ensureChannel(context, "Uploads")
    UploadNotifications.ensureChannel(context, "Uploads")

    val channel = manager.getNotificationChannel(UploadNotifications.CHANNEL_ID)
    assertEquals(NotificationManager.IMPORTANCE_LOW, channel.importance)
    assertFalse(channel.canShowBadge())
    assertEquals(1, manager.notificationChannels.count { it.id == UploadNotifications.CHANNEL_ID })
  }

  @Test
  fun `the notification is ongoing`() {
    assertNotEquals(0, build(0, 0).flags and Notification.FLAG_ONGOING_EVENT)
  }

  @Test
  fun `a known total renders a determinate bar`() {
    val extras = build(3, 10).extras

    assertEquals(10, extras.getInt(Notification.EXTRA_PROGRESS_MAX))
    assertEquals(3, extras.getInt(Notification.EXTRA_PROGRESS))
    assertFalse(extras.getBoolean(Notification.EXTRA_PROGRESS_INDETERMINATE))
  }

  @Test
  fun `an unknown total spins rather than showing a misleading zero percent`() {
    assertTrue(build(5, 0).extras.getBoolean(Notification.EXTRA_PROGRESS_INDETERMINATE))
    assertTrue(build(5, -1).extras.getBoolean(Notification.EXTRA_PROGRESS_INDETERMINATE))
  }

  @Test
  fun `progress is clamped to the reported total`() {
    assertEquals(4, build(9, 4).extras.getInt(Notification.EXTRA_PROGRESS))
    assertEquals(0, build(-2, 4).extras.getInt(Notification.EXTRA_PROGRESS))
  }

  @Test
  fun `content survives the round trip through the start intent`() {
    val content = UploadNotifications.Content("Uploading", "3 of 10", 3, 10)
    val intent = Intent(context, UploadForegroundService::class.java).putContent(content)

    assertEquals(content, UploadNotifications.contentFrom(intent))
  }

  @Test
  fun `a missing intent yields empty content rather than throwing`() {
    assertEquals(UploadNotifications.Content("", "", 0, 0), UploadNotifications.contentFrom(null))
  }
}

/** Stands in for Android refusing foreground promotion, as it does once the dataSync budget is spent. */
class RefusedService : UploadForegroundService() {
  override fun promote(content: UploadNotifications.Content) {
    throw IllegalStateException("startForeground not allowed")
  }
}
