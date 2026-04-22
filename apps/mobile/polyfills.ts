/* eslint-disable import/order */

// Expo SDK 55 ships a native ReadableStream/WritableStream/TransformStream,
// so we no longer polyfill with web-streams-polyfill (which was ~34% of
// upload CPU via its per-chunk structuredClone).

import '@azure/core-asynciterator-polyfill'

import '@bacons/text-decoder/install'

import 'react-native-get-random-values'
