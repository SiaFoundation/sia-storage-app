import { describe, expect, test } from 'bun:test'
import { ownBuildPattern } from './build'

const iosCommand = (derivedData: string) =>
  `/usr/bin/xcodebuild -workspace SiaStorage.xcworkspace -derivedDataPath ${derivedData} build`
const gradleCommand = (jar: string) =>
  `java -classpath ${jar} org.gradle.wrapper.GradleWrapperMain app:assembleDebug`

describe("the pattern that kills this checkout's stale builds", () => {
  test('matches its own build when the checkout path has dots and parentheses', () => {
    const derivedData = '/wt/release.v1 (copy)/apps/mobile/.build-cache/ios-sim/DerivedData'
    expect(new RegExp(ownBuildPattern('ios', derivedData)).test(iosCommand(derivedData))).toBe(true)
    const jar = '/wt/release.v1 (copy)/apps/mobile/android/gradle/wrapper/gradle-wrapper.jar'
    expect(new RegExp(ownBuildPattern('android', jar)).test(gradleCommand(jar))).toBe(true)
  })

  test('does not match a build in a checkout whose path differs only where this one has a dot', () => {
    const ours = '/wt/release.v1/apps/mobile/.build-cache/ios-sim/DerivedData'
    const theirs = '/wt/release-v1/apps/mobile/.build-cache/ios-sim/DerivedData'
    expect(new RegExp(ownBuildPattern('ios', ours)).test(iosCommand(theirs))).toBe(false)
    const jar = (root: string) => `${root}/apps/mobile/android/gradle/wrapper/gradle-wrapper.jar`
    expect(
      new RegExp(ownBuildPattern('android', jar('/wt/release.v1'))).test(
        gradleCommand(jar('/wt/release-v1')),
      ),
    ).toBe(false)
  })
})
