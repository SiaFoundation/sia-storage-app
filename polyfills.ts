/* eslint-disable import/order */

// Use a WHATWG-compliant ReadableStream for File.stream().
import { ReadableStream } from 'web-streams-polyfill'

// @ts-expect-error - globalThis.ReadableStream type mismatch with polyfill
globalThis.ReadableStream = ReadableStream

import '@azure/core-asynciterator-polyfill'

import '@bacons/text-decoder/install'

import 'react-native-get-random-values'
