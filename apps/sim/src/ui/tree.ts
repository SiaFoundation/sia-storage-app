/**
 * Finds elements in an accessibility tree by what a user sees. React Native
 * maps its props differently on each platform: on iOS `testID` becomes an
 * element's `name` and `accessibilityLabel` its `label`, and on Android
 * `testID` becomes `resource-id` and `accessibilityLabel` `content-desc`. A
 * selector names the prop, and matching reads the right attribute for the tree
 * it is given.
 */
import type { PhoneKind } from '../session'

export type Selector = {
  /**
   * Visible text, compared case-insensitively, so it also matches a section
   * header that shows the same words in capitals. Where both are on screen, an
   * element whose text matches in case wins. A row is named by its label.
   */
  text?: string
  /** The element's accessibilityLabel. */
  label?: string
  /** The element's testID. */
  id?: string
  /** A case-insensitive substring of the text or label. */
  contains?: string
}

type Node = {
  text: string
  label: string
  id: string
  visible: boolean
  clickable: boolean
  /**
   * React Native on Android writes an element's accessibilityLabel, some of
   * its states and its accessibilityValue text into one content description,
   * joined by ", ", so a label with a value reads "Status, Uploading".
   */
  labelJoined: boolean
  box: { x: number; y: number; w: number; h: number } | null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

// UiAutomator2 writes a value holding a double quote in single quotes, as in
// text='Create "Trips"', so both quote styles are read.
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1]] = (m[2] ?? m[3]).replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e])
  }
  return out
}

/**
 * XCUITest reports no clickable attribute, so the element types a user can tap
 * stand in for it. A Pressable without an accessibility role is `Other`, and
 * still matches, only below a tappable element with the same text.
 */
const IOS_TAPPABLE_TYPES = [
  'Button',
  'Cell',
  'Link',
  'TextField',
  'SecureTextField',
  'Switch',
  'Tab',
]
const IOS_TAPPABLE = new RegExp(`^<XCUIElementType(${IOS_TAPPABLE_TYPES.join('|')})\\b`)

function iosNode(tag: string): Node {
  const a = attrs(tag)
  const [x, y, w, h] = [a.x, a.y, a.width, a.height].map(Number)
  return {
    text: a.value || a.label || '',
    label: a.label ?? '',
    id: a.name ?? '',
    visible: a.visible !== 'false',
    clickable: IOS_TAPPABLE.test(tag),
    labelJoined: false,
    box: [x, y, w, h].some(Number.isNaN) ? null : { x, y, w, h },
  }
}

function androidNode(tag: string): Node {
  const a = attrs(tag)
  const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(a.bounds ?? '')
  const id = a['resource-id'] ?? ''
  return {
    text: a.text ?? '',
    label: a['content-desc'] ?? '',
    // Native views prefix their ids with the package. A testID arrives bare.
    id: id.includes(':id/') ? id.split(':id/')[1] : id,
    visible: a.displayed !== 'false',
    clickable: a.clickable === 'true',
    labelJoined: true,
    box: b ? { x: +b[1], y: +b[2], w: +b[3] - +b[1], h: +b[4] - +b[2] } : null,
  }
}

function matches(node: Node, sel: Selector): boolean {
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  if (sel.id !== undefined) return node.id === sel.id
  if (sel.label !== undefined)
    return node.label === sel.label || (node.labelJoined && node.label.startsWith(`${sel.label}, `))
  if (sel.text !== undefined) return eq(node.text, sel.text) || eq(node.label, sel.text)
  if (sel.contains !== undefined) {
    const needle = sel.contains.toLowerCase()
    return node.text.toLowerCase().includes(needle) || node.label.toLowerCase().includes(needle)
  }
  return false
}

type Box = NonNullable<Node['box']>

function parse(xml: string, platform: PhoneKind): Node[] {
  return (xml.match(/<[A-Za-z][^>]*>/g) ?? []).map((tag) =>
    platform === 'ios' ? iosNode(tag) : androidNode(tag),
  )
}

/**
 * The best visible element matching `sel`. A clickable element beats one that
 * is not: a dialog's title and its button share their text, and only the
 * button does anything when tapped. Between two that tie, text matching in
 * case beats text matching only without it, so a row's "Developers" wins over
 * the section header "DEVELOPERS" above it.
 */
function findBest(nodes: Node[], sel: Selector): Box | null {
  let best: { score: number; box: Box } | null = null
  for (const node of nodes) {
    if (!node.visible || !node.box || node.box.w <= 0 || node.box.h <= 0) continue
    if (!matches(node, sel)) continue
    const sameCase = sel.text !== undefined && (node.text === sel.text || node.label === sel.text)
    const score = (node.clickable ? 2 : 0) + (sameCase ? 1 : 0)
    if (!best || score > best.score) best = { score, box: node.box }
  }
  return best?.box ?? null
}

function center(b: Box): [number, number] {
  return [Math.round(b.x + b.w / 2), Math.round(b.y + b.h / 2)]
}

/** The center of the best visible element matching `sel`, or null. */
export function findCenter(
  xml: string,
  sel: Selector,
  platform: PhoneKind,
): [number, number] | null {
  const box = findBest(parse(xml, platform), sel)
  return box ? center(box) : null
}

/**
 * Where to tap the best element matching `sel`, or null when none matches.
 * That is its center, except on a backdrop spanning most of the screen, such
 * as a dropdown's "Close menu" or a bottom sheet's "Close sheet", whose center
 * lies under the menu or sheet it closes. A backdrop is tapped at a point that
 * no other control or labelled element contains. The tree's order says
 * nothing reliable about what is drawn over what on Android, where the screen
 * behind a sheet can come after the sheet, so every such element counts,
 * except full-screen layers, which pass touches through.
 */
export function findTapPoint(
  xml: string,
  sel: Selector,
  platform: PhoneKind,
): [number, number] | null {
  const nodes = parse(xml, platform)
  const box = findBest(nodes, sel)
  if (!box) return null
  const screen = nodes.reduce(
    (s, n) => (n.box ? Math.max(s, (n.box.x + n.box.w) * (n.box.y + n.box.h)) : s),
    0,
  )
  if (box.w * box.h < screen / 2) return center(box)
  // Within 1% of the backdrop's edges: a screen's own content is often a
  // pixel short of it.
  const spans = (o: Box) =>
    o.x <= box.x + box.w * 0.01 &&
    o.y <= box.y + box.h * 0.01 &&
    o.x + o.w >= box.x + box.w * 0.99 &&
    o.y + o.h >= box.y + box.h * 0.99
  const controls = nodes
    .filter((n) => n.visible && n.box && n.box !== box && (n.clickable || n.label))
    .map((n) => n.box as Box)
    .filter((o) => !spans(o))
  const free = ([x, y]: [number, number]) =>
    !controls.some((o) => x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h)
  const points: Array<[number, number]> = [center(box)]
  for (let row = 0; row < 5; row++)
    for (let col = 0; col < 5; col++)
      points.push([
        Math.round(box.x + ((col + 0.5) * box.w) / 5),
        Math.round(box.y + ((row + 0.5) * box.h) / 5),
      ])
  return points.find(free) ?? center(box)
}

/** Every visible element with a text, label or test id, for writing selectors. */
export function describeTree(
  xml: string,
  platform: PhoneKind,
): Array<Partial<Record<'text' | 'label' | 'id', string>>> {
  const out: Array<Partial<Record<'text' | 'label' | 'id', string>>> = []
  const seen = new Set<string>()
  for (const tag of xml.match(/<[A-Za-z][^>]*>/g) ?? []) {
    const node = platform === 'ios' ? iosNode(tag) : androidNode(tag)
    if (!node.visible || (!node.text.trim() && !node.label.trim() && !node.id)) continue
    const entry = {
      ...(node.text.trim() ? { text: node.text } : {}),
      ...(node.label.trim() && node.label !== node.text ? { label: node.label } : {}),
      ...(node.id ? { id: node.id } : {}),
    }
    const key = JSON.stringify(entry)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The same selector as a query the platform's driver runs itself, for calls
 * that act on an element rather than a point: an NSPredicate over XCUITest's
 * attributes on iOS, a UiSelector on Android. JSON quoting is valid in both.
 * `tappable` narrows an iOS query to the visible elements of the types a
 * user can tap, as the tree's own match skips hidden ones. A tap on Android
 * goes to a point from the tree instead of through this query.
 */
export function locator(
  sel: Selector,
  platform: PhoneKind,
  tappable = false,
): { using: string; value: string } {
  const q = JSON.stringify
  if (platform === 'ios') {
    if (sel.id !== undefined && !tappable) return { using: 'accessibility id', value: sel.id }
    let match: string
    if (sel.id !== undefined) match = `name == ${q(sel.id)}`
    else if (sel.label !== undefined) match = `label == ${q(sel.label)}`
    else {
      const t = sel.text ?? sel.contains ?? ''
      const op = sel.text !== undefined ? '==[c]' : 'CONTAINS[c]'
      match = `label ${op} ${q(t)} OR value ${op} ${q(t)} OR placeholderValue ${op} ${q(t)}`
    }
    const types = IOS_TAPPABLE_TYPES.map((t) => q(`XCUIElementType${t}`)).join(', ')
    return {
      using: '-ios predicate string',
      value: tappable ? `(${match}) AND type IN {${types}} AND visible == 1` : match,
    }
  }
  if (sel.id !== undefined)
    return { using: '-android uiautomator', value: `new UiSelector().resourceId(${q(sel.id)})` }
  if (sel.label !== undefined) {
    return {
      using: '-android uiautomator',
      value: `new UiSelector().descriptionMatches(${q(`${escapeRegex(sel.label)}(, .*)?`)})`,
    }
  }
  const t = escapeRegex(sel.text ?? sel.contains ?? '')
  const pattern = sel.text !== undefined ? `(?i)${t}` : `(?i).*${t}.*`
  return {
    using: '-android uiautomator',
    value: `new UiSelector().textMatches(${q(pattern)})`,
  }
}

/**
 * The queries that find what `sel` names, in the order to try them. Matching
 * text or contains, the tree checks an element's text and its label, and an
 * iOS predicate can ask for both at once. A UiSelector cannot, and an Android
 * row the app names with an accessibility label shows it as its content
 * description only, so a second query asks for that.
 */
export function locators(
  sel: Selector,
  platform: PhoneKind,
  tappable = false,
): Array<{ using: string; value: string }> {
  const first = locator(sel, platform, tappable)
  if (platform === 'ios' || (sel.text === undefined && sel.contains === undefined)) return [first]
  const value = first.value.replace('.textMatches(', '.descriptionMatches(')
  return [first, { using: first.using, value }]
}
