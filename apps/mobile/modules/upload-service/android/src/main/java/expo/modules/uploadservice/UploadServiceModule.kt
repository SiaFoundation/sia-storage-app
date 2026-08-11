package expo.modules.uploadservice

import android.content.Intent
import android.os.Bundle
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.uploadservice.UploadNotifications.putContent

/**
 * The only link between the service and the module.
 *
 * A started service and a module instance are created by different parts of
 * the system and hold no reference to each other, so state and events cross
 * here. `isRunning` is written by the service, so it reads false once the
 * service has stopped even when no module was listening for the event.
 */
object UploadServiceBridge {
  @Volatile var timeoutListener: (() -> Unit)? = null

  @Volatile var stoppedListener: (() -> Unit)? = null

  @Volatile var refusedListener: (() -> Unit)? = null

  @Volatile
  var isRunning: Boolean = false
    internal set

  // These run on the service's teardown path, where the React context may
  // already be gone, so a throw there would abort the teardown rather than
  // reach anyone who could act on it.
  internal fun emitTimeout() {
    runCatching { timeoutListener?.invoke() }
  }

  internal fun emitRefused() {
    runCatching { refusedListener?.invoke() }
  }

  internal fun emitStopped() {
    runCatching { stoppedListener?.invoke() }
  }
}

class UploadServiceOptions : Record {
  @Field var title: String = ""

  @Field var text: String = ""

  @Field var progressCurrent: Int = 0

  @Field var progressTotal: Int = 0

  @Field var channelName: String = "Uploads"

  fun toContent() =
    UploadNotifications.Content(title, text, progressCurrent, progressTotal)
}

/**
 * JS control over the upload foreground service.
 *
 * Android 12 and later reject a start from the background with
 * ForegroundServiceStartNotAllowedException, surfaced as `start-not-allowed`,
 * so a caller starts the service only while the app is on screen.
 *
 * The service keeps the process alive, but React Native stops JS timers once
 * the activity pauses unless a headless JS task is running, and the upload
 * loop runs on those timers. So while the service runs, the module also holds
 * a headless task open, `KEEP_ALIVE_TASK`, which does nothing itself.
 */
class UploadServiceModule : Module() {
  // Read and written on the UI thread, where HeadlessJsTaskContext requires
  // a task to be started.
  private var keepAliveTask: Int? = null

  private fun holdTimers() {
    val react = appContext.reactContext as? ReactContext ?: return
    UiThreadUtil.runOnUiThread {
      val tasks = HeadlessJsTaskContext.getInstance(react)
      if (keepAliveTask?.let { tasks.isTaskRunning(it) } == true) return@runOnUiThread
      // No timeout: the task lasts as long as the service, which has its own.
      // The last argument allows the task with the app in the foreground,
      // which is where `start` runs.
      keepAliveTask =
        tasks.startTask(HeadlessJsTaskConfig(KEEP_ALIVE_TASK, Arguments.createMap(), 0, true))
    }
  }

  private fun releaseTimers() {
    val react = appContext.reactContext as? ReactContext ?: return
    UiThreadUtil.runOnUiThread {
      val id = keepAliveTask ?: return@runOnUiThread
      keepAliveTask = null
      HeadlessJsTaskContext.getInstance(react).finishTask(id)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("UploadService")

    Events(TIMEOUT_EVENT, STOPPED_EVENT, REFUSED_EVENT)

    OnCreate {
      UploadServiceBridge.timeoutListener = {
        releaseTimers()
        sendEvent(TIMEOUT_EVENT, Bundle())
      }
      UploadServiceBridge.stoppedListener = {
        releaseTimers()
        sendEvent(STOPPED_EVENT, Bundle())
      }
      UploadServiceBridge.refusedListener = {
        releaseTimers()
        sendEvent(REFUSED_EVENT, Bundle())
      }
    }

    OnDestroy {
      UploadServiceBridge.timeoutListener = null
      UploadServiceBridge.stoppedListener = null
      UploadServiceBridge.refusedListener = null
      releaseTimers()
    }

    Function("isRunning") { UploadServiceBridge.isRunning }

    Function("start") { options: UploadServiceOptions ->
      val context = requireNotNull(appContext.reactContext)
      UploadNotifications.ensureChannel(context, options.channelName)
      val intent =
        Intent(context, UploadForegroundService::class.java).putContent(options.toContent())
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (e: IllegalStateException) {
        // ForegroundServiceStartNotAllowedException (API 31+) extends
        // IllegalStateException. Naming the subclass would put an API-31 type
        // in a catch clause that runs on API 24, so match the base.
        throw CodedException("start-not-allowed", e.message.orEmpty(), e)
      }
      holdTimers()
    }

    Function("update") { options: UploadServiceOptions ->
      if (UploadServiceBridge.isRunning) {
        UploadNotifications.notify(requireNotNull(appContext.reactContext), options.toContent())
      }
    }

    Function("stop") {
      val context = requireNotNull(appContext.reactContext)
      context.stopService(Intent(context, UploadForegroundService::class.java))
      releaseTimers()
    }
  }

  private companion object {
    const val TIMEOUT_EVENT = "onTimeout"
    const val STOPPED_EVENT = "onStopped"
    const val REFUSED_EVENT = "onRefused"
    const val KEEP_ALIVE_TASK = "SiaUploadKeepAlive"
  }
}
