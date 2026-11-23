/**
 * Every control in both apps has a name a screen reader can say
 * (docs/conventions/code-style.md, Accessibility). Reads the apps' JSX and fails on:
 * - phone: a `Pressable` without `accessibilityRole`, or with neither `accessibilityLabel` nor
 *   anything inside that can hold words (a `Text`, a component of ours, `{children}`); a `Switch`
 *   or `TextInput` without `accessibilityLabel`, unless hidden from screen readers on purpose;
 * - PC: a `button` with no words inside (only an icon, or a symbol such as ×) and no
 *   `aria-label`; an `input`, `textarea` or `select` without `aria-label`, `aria-labelledby`,
 *   an `id` (for a `<label htmlFor>`) or a `label` around it.
 * A `{...props}` spread may carry the name, so such an element passes. Run from avchetan-code/:
 * `pnpm a11y:check`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from '@babel/parser';

const workspace = resolve(import.meta.dirname, '..', '..');

/** Just what this script reads of Babel's AST. */
type Node = { type: string; loc?: { start: { line: number } } } & Record<string, unknown>;
type Attribute = Node & { name?: { name: string }; value?: Node | null };
type Element = Node & {
  openingElement: { name: Node; attributes: Attribute[] };
  children: Node[];
};

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';

function children(node: Node): Node[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (key === 'loc' || key === 'start' || key === 'end') return [];
    if (Array.isArray(value)) return value.filter(isNode);
    return isNode(value) ? [value] : [];
  });
}

function tagName(name: Node): string {
  if (name.type === 'JSXIdentifier') return name.name as string;
  if (name.type === 'JSXMemberExpression') {
    return `${tagName(name.object as Node)}.${(name.property as { name: string }).name}`;
  }
  return '?';
}

const tagOf = (element: Element) => tagName(element.openingElement.name);

function attribute(element: Element, name: string): Attribute | undefined {
  return element.openingElement.attributes.find(
    (attr) => attr.type === 'JSXAttribute' && attr.name?.name === name,
  );
}

const spreads = (element: Element) =>
  element.openingElement.attributes.some((attr) => attr.type === 'JSXSpreadAttribute');

const has = (element: Element, ...names: string[]) =>
  spreads(element) || names.some((name) => attribute(element, name) !== undefined);

/** `accessible={false}`, `importantForAccessibility="no"` and the like. */
function literal(attr: Attribute | undefined): unknown {
  const value = attr?.value;
  if (!value) return attr ? true : undefined;
  if (value.type === 'StringLiteral') return value.value;
  const expression = value.expression as Node | undefined;
  return expression && 'value' in expression ? expression.value : undefined;
}

const WORD = /[\p{L}\p{N}]/u;

function containsJsx(node: Node): boolean {
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true;
  return children(node).some(containsJsx);
}

/** Phone parts that never hold words; any other capitalised tag is ours and may render text. */
const PHONE_WORDLESS = new Set(['View', 'ScrollView', 'Image', 'Ionicons', 'Switch']);

/**
 * Words inside: text with a letter or digit, or `{something}` that isn't markup. On the phone
 * (`phone`), only text inside a `Text` counts, but a component of ours or a bare `{children}`
 * may hold some and is given the benefit of the doubt.
 */
function hasWords(element: Element, phone: boolean): boolean {
  const visit = (node: Node, inText: boolean): boolean => {
    if (node.type === 'JSXElement') {
      const tag = tagOf(node as Element);
      if (tag === 'svg') return false;
      if (phone && tag !== 'Text' && /^[A-Z]/.test(tag) && !PHONE_WORDLESS.has(tag)) return true;
      const nowInText = inText || tag === 'Text';
      return (node as Element).children.some((child) => visit(child, nowInText));
    }
    if (node.type === 'JSXFragment') {
      return (node.children as Node[]).some((child) => visit(child, inText));
    }
    if (node.type === 'JSXText') return inText && WORD.test(node.value as string);
    if (node.type === 'JSXExpressionContainer') {
      const expression = node.expression as Node;
      if (expression.type === 'JSXEmptyExpression') return false;
      if (expression.type === 'StringLiteral')
        return inText && WORD.test(expression.value as string);
      if (!containsJsx(expression)) return inText || phone;
      return children(expression).some((child) => visit(child, inText));
    }
    return children(node).some((child) => visit(child, inText));
  };
  return element.children.some((child) => visit(child, !phone));
}

function phoneProblem(element: Element): string | null {
  const tag = tagOf(element);
  if (tag === 'Pressable' || tag === 'TouchableOpacity') {
    if (literal(attribute(element, 'accessible')) === false || spreads(element)) return null;
    if (!has(element, 'accessibilityRole', 'role')) return `${tag} without accessibilityRole`;
    if (!has(element, 'accessibilityLabel', 'aria-label') && !hasWords(element, true)) {
      return `${tag} with nothing to say: add accessibilityLabel`;
    }
  }
  if (tag === 'Switch' || tag === 'TextInput') {
    const hidden =
      literal(attribute(element, 'accessibilityElementsHidden')) === true ||
      ['no', 'no-hide-descendants'].includes(
        String(literal(attribute(element, 'importantForAccessibility'))),
      );
    if (!hidden && !has(element, 'accessibilityLabel', 'aria-label')) {
      return `${tag} without accessibilityLabel`;
    }
  }
  return null;
}

function pcProblem(element: Element, ancestors: readonly Element[]): string | null {
  const tag = tagOf(element);
  if (tag === 'button' && !has(element, 'aria-label', 'aria-labelledby')) {
    if (!hasWords(element, false)) return 'button with no words: add aria-label';
  }
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    if (literal(attribute(element, 'type')) === 'hidden') return null;
    const labelled = ancestors.some((ancestor) => tagOf(ancestor) === 'label');
    if (!labelled && !has(element, 'aria-label', 'aria-labelledby', 'id')) {
      return `${tag} without a label`;
    }
  }
  return null;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (['node_modules', 'dist', 'android', 'modules'].includes(entry) || entry.startsWith('.')) {
      return [];
    }
    if (statSync(path).isDirectory()) return files(path);
    return entry.endsWith('.tsx') && !entry.endsWith('.test.tsx') ? [path] : [];
  });
}

const APPS = [
  { dirs: ['apps/mobile/app', 'apps/mobile/src'], check: phoneProblem },
  { dirs: ['apps/desktop/src'], check: pcProblem },
];

const problems: string[] = [];
let elements = 0;
for (const app of APPS) {
  for (const path of app.dirs.flatMap((dir) => files(join(workspace, dir)))) {
    const ast = parse(readFileSync(path, 'utf8'), {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    }) as unknown as Node;
    const walk = (node: Node, ancestors: readonly Element[]) => {
      let inside = ancestors;
      if (node.type === 'JSXElement') {
        elements += 1;
        const element = node as Element;
        const problem = app.check(element, ancestors);
        if (problem) {
          const where = `${relative(workspace, path).replaceAll('\\', '/')}:${node.loc?.start.line}`;
          problems.push(`${where}  ${problem}`);
        }
        inside = [...ancestors, element];
      }
      for (const child of children(node)) walk(child, inside);
    };
    walk(ast, []);
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `${problems.join('\n')}\n\n${problems.length} controls a screen reader can't name.\n`,
  );
  process.exit(1);
}
process.stdout.write(`a11y ok: ${elements} elements checked\n`);
