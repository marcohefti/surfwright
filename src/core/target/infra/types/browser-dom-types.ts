export type BrowserComputedStyleLike = {
  display?: string;
  visibility?: string;
  opacity?: string;
  getPropertyValue?: (name: string) => string;
};

export type BrowserRectLike = {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  bottom?: number;
};

export type BrowserNodeLike = {
  [key: string]: unknown;
  nodeType?: number;
  tagName?: string;
  id?: string;
  className?: string;
  innerText?: string;
  textContent?: string | null;
  value?: string;
  type?: string;
  href?: string;
  style?: Record<string, unknown>;
  parentElement?: BrowserNodeLike | null;
  previousElementSibling?: BrowserNodeLike | null;
  querySelector?: (query: string) => BrowserNodeLike | null;
  querySelectorAll?: (query: string) => ArrayLike<BrowserNodeLike>;
  matches?: (query: string) => boolean;
  closest?: (query: string) => BrowserNodeLike | null;
  hasAttribute?: (name: string) => boolean;
  getAttribute?: (name: string) => string | null;
  getClientRects?: () => ArrayLike<unknown>;
  getBoundingClientRect?: () => BrowserRectLike | null;
  scrollIntoView?: (options?: unknown) => void;
  click?: () => void;
  focus?: () => void;
  dispatchEvent?: (event: unknown) => boolean;
  isContentEditable?: boolean;
  childIds?: unknown[];
};

export type BrowserDocumentLike = BrowserNodeLike & {
  body?: BrowserNodeLike | null;
  activeElement?: BrowserNodeLike | null;
  scrollingElement?: { scrollHeight?: number } | null;
  readyState?: string;
  visibilityState?: string;
  baseURI?: string;
  addEventListener?: (name: string, listener: (event: unknown) => void, options?: boolean) => void;
};

export type BrowserWindowLike = {
  scrollY?: number;
  innerHeight?: number;
  innerWidth?: number;
  scrollTo?: (x: number, y: number) => void;
};

export type BrowserRuntimeLike = {
  [key: string]: unknown;
  document?: BrowserDocumentLike | null;
  window?: BrowserWindowLike | null;
  getComputedStyle?: (el: unknown) => BrowserComputedStyleLike | null;
  performance?: { now?: () => number } | null;
};
