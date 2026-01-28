/* eslint-disable import/order */

// @ts-expect-error - @types/react-native doesn't cover this file
import { polyfillGlobal } from 'react-native/Libraries/Utilities/PolyfillFunctions'

// Use a WHATWG-compliant ReadableStream for File.stream().
import { ReadableStream } from 'web-streams-polyfill'

polyfillGlobal('ReadableStream', () => ReadableStream)

import '@azure/core-asynciterator-polyfill'

import '@bacons/text-decoder/install'

import 'react-native-get-random-values'
