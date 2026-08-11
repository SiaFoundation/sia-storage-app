package expo.modules.uploadservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * The ongoing notification a `dataSync` foreground service must show, and the
 * marshalling of its content across the intent that starts the service. Title
 * and text arrive as finished strings from JS.
 */
object UploadNotifications {
  const val CHANNEL_ID = "uploads"
  const val NOTIFICATION_ID = 0x5A17

  data class Content(
    val title: String,
    val text: String,
    val progressCurrent: Int,
    val progressTotal: Int,
  )

  fun Intent.putContent(content: Content): Intent =
    putExtra(EXTRA_TITLE, content.title)
      .putExtra(EXTRA_TEXT, content.text)
      .putExtra(EXTRA_CURRENT, content.progressCurrent)
      .putExtra(EXTRA_TOTAL, content.progressTotal)

  fun contentFrom(intent: Intent?): Content =
    Content(
      title = intent?.getStringExtra(EXTRA_TITLE).orEmpty(),
      text = intent?.getStringExtra(EXTRA_TEXT).orEmpty(),
      progressCurrent = intent?.getIntExtra(EXTRA_CURRENT, 0) ?: 0,
      progressTotal = intent?.getIntExtra(EXTRA_TOTAL, 0) ?: 0,
    )

  /** IMPORTANCE_LOW: this is a status surface for work the user started, not an alert. */
  fun ensureChannel(context: Context, name: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    context.notificationManager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
      },
    )
  }

  fun build(context: Context, content: Content): Notification =
    NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle(content.title)
      .setContentText(content.text)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .apply {
        // No total yet shows an indeterminate bar rather than 0%. The count is
        // clamped to the total, since files can finish after the total was taken.
        val total = content.progressTotal
        if (total <= 0) {
          setProgress(0, 0, true)
        } else {
          setProgress(total, content.progressCurrent.coerceIn(0, total), false)
        }
        launchIntent(context)?.let(::setContentIntent)
      }
      .build()

  fun notify(context: Context, content: Content) {
    context.notificationManager.notify(NOTIFICATION_ID, build(context, content))
  }

  private const val EXTRA_TITLE = "title"
  private const val EXTRA_TEXT = "text"
  private const val EXTRA_CURRENT = "progressCurrent"
  private const val EXTRA_TOTAL = "progressTotal"

  private val Context.notificationManager: NotificationManager
    get() = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  // Reopens the app rather than deep-linking; there is no upload detail screen
  // to land on.
  private fun launchIntent(context: Context): PendingIntent? {
    val intent =
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      } ?: return null
    return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE)
  }
}
