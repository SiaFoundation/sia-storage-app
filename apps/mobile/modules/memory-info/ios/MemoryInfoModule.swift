import ExpoModulesCore
import os

// Reports how much memory this app can still spend, so transfers size their
// buffers against that rather than against the device's total RAM.
//
// `os_proc_available_memory` also answers zero where the process has no
// limit, as in the simulator, where zero would read as low memory. The
// simulator gets no reading instead, so transfers there take the fixed
// budget.
public class MemoryInfoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MemoryInfo")

    Function("read") { () -> [String: Any]? in
      #if targetEnvironment(simulator)
        return nil
      #else
        return MemoryReading.from(available: os_proc_available_memory())
      #endif
    }
  }
}
