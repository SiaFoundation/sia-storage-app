import ExpoModulesCore
import UIKit

// Exposes UIApplication.backgroundTimeRemaining to JS so the suspension
// drain loop can use iOS's actual remaining budget instead of a static
// guess. https://developer.apple.com/documentation/uikit/uiapplication/backgroundtimeremaining
//
// Returns DBL_MAX while the app is foregrounded, the live grace
// (~5s natural / ~30s with an active beginBackgroundTask) once
// applicationDidEnterBackground has fired. Documented as main-thread
// only; we hop the main queue synchronously, which is safe from the
// JS thread since we never block it under the main runloop.
public class BackgroundTimeRemainingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackgroundTimeRemaining")

    Function("getSeconds") { () -> Double in
      if Thread.isMainThread {
        return UIApplication.shared.backgroundTimeRemaining
      }
      var seconds: Double = 0
      DispatchQueue.main.sync {
        seconds = UIApplication.shared.backgroundTimeRemaining
      }
      return seconds
    }
  }
}
