export const PARENT_TAB_BAR_CONTENT_HEIGHT = 62;

const MINIMUM_FIXED_FOOTER_PADDING = 8;
const SCROLL_CONTENT_CLEARANCE = 24;

export function getFixedFooterBottomPadding(bottomInset: number) {
  return Math.max(bottomInset, MINIMUM_FIXED_FOOTER_PADDING);
}

export function getParentTabScrollBottomPadding(bottomInset: number) {
  return PARENT_TAB_BAR_CONTENT_HEIGHT + bottomInset + SCROLL_CONTENT_CLEARANCE;
}
