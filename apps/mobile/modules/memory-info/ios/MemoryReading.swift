// The reading sent to JS for one `os_proc_available_memory` answer.
//
// iOS has no system-wide available/threshold pair like Android's. Its
// `os_proc_available_memory` is how much more this app may allocate before
// the system stops it for exceeding its limit, which is already what can be
// spent, so the threshold is zero. On a device it answers zero once the app
// has passed its limit, which is reported as low memory.
enum MemoryReading {
  static func from(available: Int) -> [String: Any] {
    return [
      "availableBytes": available,
      "thresholdBytes": 0,
      "lowMemory": available == 0,
    ]
  }
}
